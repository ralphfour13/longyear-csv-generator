import { Decimal } from 'decimal.js';
import type {
  Order,
  JournalEntry,
  EnrichedTransaction,
  Transaction,
  OrderCentricReconciliationResult,
} from '../types/journal-entry';
import type { CogsCalculation } from '../types/cin7';
import {
  fetchOrdersByCaptureDateRange,
  getOrderCaptureDate,
} from './order-centric-fetcher.server';
import {
  analyzeOrderPayments,
  validatePaymentTotal,
} from './payment-method-analyzer.server';
import {
  createOrderJournalEntries,
  createRefundJournalEntries,
  createFeeEntries,
  validateOrderEntries,
} from './order-centric-journal-generator.server';
import { enrichOrderData } from './enrichment/order-enrichment.server';
import { calculateOrderCogsWithService } from './cogs/cogs-calculator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';
import { Cin7ProductService } from './cin7/cin7-product-service.server';

// Helper function for rate limiting delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log order reconciliation values for debugging
 * Shows original vs current values to help diagnose partial capture/refund issues
 */
function logOrderReconciliationValues(order: Order, usedValues: { sales: Decimal; tax: Decimal }): void {
  const hasCurrentValues = order.currentSubtotalPrice !== undefined || order.currentTotalTax !== undefined;

  console.log(`📊 Order ${order.name} Reconciliation Values:`);
  console.log(`  Original: subtotal=$${order.subtotalPrice.toFixed(2)}, tax=$${(order.totalTax || new Decimal(0)).toFixed(2)}, total=$${order.totalPrice.toFixed(2)}`);

  if (hasCurrentValues) {
    console.log(`  Current:  subtotal=$${order.currentSubtotalPrice?.toFixed(2) ?? 'N/A'}, tax=$${order.currentTotalTax?.toFixed(2) ?? 'N/A'}, total=$${order.currentTotalPrice?.toFixed(2) ?? 'N/A'}`);
  }

  console.log(`  Used:     sales=$${usedValues.sales.toFixed(2)}, tax=$${usedValues.tax.toFixed(2)}`);
  console.log(`  Financial Status: ${order.financialStatus}`);
}

/**
 * Reconcile orders by capture date
 *
 * This is the main entry point for order-centric reconciliation.
 * Fetches all orders with activity in the date range, filters by capture date,
 * analyzes payment methods, and generates journal entries.
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param targetDate - Target date (YYYY-MM-DD format)
 * @returns Reconciliation result with journal entries and enriched transactions
 */
export async function reconcileOrdersByDate(
  shop: string,
  accessToken: string,
  targetDate: string,
  jobId?: string  // Optional job ID for progress tracking
): Promise<OrderCentricReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cogsWarnings: string[] = [];
  const journalEntries: JournalEntry[] = [];
  const enrichedTransactions: EnrichedTransaction[] = [];

  try {
    // Fetch orders with activity in the date range (-7/+1 day buffer for created_at query)
    // The fetcher uses dual-query strategy:
    // - created_at: Uses -7/+1 day buffer to catch orders created up to a week before capture
    // - updated_at: Uses ±1 day buffer to catch recently modified orders (unchanged)
    // Orders can't be created in the future, so +1 day is sufficient forward buffer
    const startDate = addDays(targetDate, -7);
    const endDate = addDays(targetDate, 1);

    const orders = await fetchOrdersByCaptureDateRange(
      shop,
      accessToken,
      startDate,
      endDate,
      jobId  // Pass jobId for progress tracking
    );

    let ordersProcessed = 0;
    let capturesProcessed = 0;
    const processedOrderIds = new Set<string>();

    // Process each order
    for (const order of orders) {
      try {
        // REFUND-ONLY ORDERS: Handle standalone refunds (where original sale was on prior date)
        // Check this BEFORE capture logic to catch refund-only transactions
        const allCaptureTransactions = order.transactions?.filter(
          (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
        ) || [];

        if (allCaptureTransactions.length === 0) {
          // No captures - check if this is a refund-only order
          const refundTransactions = filterRefundTransactions(order, targetDate);
          if (refundTransactions.length > 0) {
            await processOrderRefunds(
              shop,
              accessToken,
              order,
              refundTransactions,
              targetDate,
              journalEntries,
              enrichedTransactions,
              warnings
            );

            processedOrderIds.add(order.id);
            ordersProcessed++;
          }
          // Skip to next order (either processed refunds or nothing to do)
          continue;
        }

        // LAST-CAPTURE-DATE RULE: Order posts on the date of its LAST captured payment
        // This ensures split-payment orders post as a complete unit (all legs balance)
        const lastCaptureDate = getOrderCaptureDate(order);

        if (!lastCaptureDate) {
          // Should not happen since we checked for captures above, but safety check
          continue;
        }

        if (lastCaptureDate !== targetDate) {
          // This order's last capture is on a different date, skip for now
          // It will be processed when we run reconciliation for that date
          continue;
        }

        // Use ALL capture transactions (already filtered above)
        // This ensures we include all payment legs when the order posts
        const captureTransactions = allCaptureTransactions;

        // Check if we've already processed this order
        if (processedOrderIds.has(order.id)) {
          continue;
        }

        // Process captures
        await processOrderCaptures(
          shop,
          accessToken,
          order,
          captureTransactions,
          targetDate,
          journalEntries,
          enrichedTransactions,
          warnings,
          errors
        );

        // Process refunds (if any on target date)
        const refundTransactions = filterRefundTransactions(order, targetDate);
        if (refundTransactions.length > 0) {
          await processOrderRefunds(
            shop,
            accessToken,
            order,
            refundTransactions,
            targetDate,
            journalEntries,
            enrichedTransactions,
            warnings
          );
        }

        // Mark order as processed
        processedOrderIds.add(order.id);
        ordersProcessed++;
        capturesProcessed += captureTransactions.length;
      } catch (error) {
        errors.push(
          `Failed to process order ${order.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // VALIDATION: Verify each SO- reference balances (per-order balance check)
    const soReferences = new Set(
      journalEntries
        .filter((entry) => entry.reference.startsWith('SO-'))
        .map((entry) => entry.reference)
    );

    for (const reference of soReferences) {
      const refEntries = journalEntries.filter((entry) => entry.reference === reference);
      const refDebits = refEntries.reduce((sum, entry) => sum.plus(entry.debit), new Decimal(0));
      const refCredits = refEntries.reduce((sum, entry) => sum.plus(entry.credit), new Decimal(0));
      const refDiff = refDebits.minus(refCredits).abs();

      if (refDiff.greaterThan(new Decimal('0.01'))) {
        errors.push(
          `❌ ${reference} does NOT balance: Debits=${refDebits.toFixed(2)}, ` +
          `Credits=${refCredits.toFixed(2)}, Diff=${refDebits.minus(refCredits).toFixed(2)}`
        );
      }
    }

    // Calculate totals and validate overall balance
    const totalDebit = journalEntries.reduce(
      (sum, entry) => sum.plus(entry.debit),
      new Decimal(0)
    );
    const totalCredit = journalEntries.reduce(
      (sum, entry) => sum.plus(entry.credit),
      new Decimal(0)
    );

    const balanced = totalDebit.equals(totalCredit);

    if (!balanced) {
      const difference = totalDebit.minus(totalCredit);
      errors.push(
        `Journal entries do not balance. Difference: ${difference.toFixed(2)} ` +
          `(Debit: ${totalDebit.toFixed(2)}, Credit: ${totalCredit.toFixed(2)})`
      );
    }

    return {
      journalEntries,
      enrichedTransactions,
      orders, // Return fetched orders to avoid duplicate fetching
      processedOrderIds, // Return orders that generated journal entries
      balanced,
      errors,
      warnings,
      cogsWarnings,
      orderCount: ordersProcessed,
      captureCount: capturesProcessed,
    };
  } catch (error) {
    errors.push(
      `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );

    return {
      journalEntries,
      enrichedTransactions,
      orders: [], // Return empty array on error
      processedOrderIds: new Set<string>(), // Return empty set on error
      balanced: false,
      errors,
      warnings,
      cogsWarnings,
      orderCount: 0,
      captureCount: 0,
    };
  }
}

/**
 * Collect COGS data for orders
 * Used to generate COGS detail CSV file
 *
 * NEW: Now uses fulfillment-based calculation to exclude removed items
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token (for fulfillment filtering)
 * @param orders - Array of orders
 * @returns Map of order ID to COGS calculation
 */
export async function collectCogsData(
  shop: string,
  accessToken: string,
  orders: Order[]
): Promise<Map<string, CogsCalculation>> {
  const cogsDataMap = new Map<string, CogsCalculation>();

  // Check if Cin7 is enabled
  const cin7Enabled = await isCin7Enabled(shop);
  if (!cin7Enabled) {
    return cogsDataMap;
  }

  // OPTIMIZATION (Phase 2): Initialize Cin7 service ONCE for all orders
  const cin7Service = new Cin7ProductService(shop);
  await cin7Service.initialize();

  // OPTIMIZATION: Collect all unique SKUs across all orders first
  const uniqueSkus = new Set<string>();
  for (const order of orders) {
    for (const lineItem of order.lineItems) {
      if (lineItem.sku) {
        uniqueSkus.add(lineItem.sku);
      }
    }
  }

  // Pre-fetch all costs in one batch (with rate limiting and caching)
  const skuArray = Array.from(uniqueSkus);
  await cin7Service.batchGetCosts(skuArray);

  // Now calculate COGS for each order (costs are cached, so this is fast)
  // OPTIMIZATION (Phase 2): Reuse same cin7Service instance for all orders
  // NEW: Pass shop and accessToken to enable fulfillment-based filtering
  for (const order of orders) {
    try {
      const cogsCalculation = await calculateOrderCogsWithService(
        cin7Service,
        order,
        shop,
        accessToken,
        true // Use fulfillments to exclude removed items
      );
      cogsDataMap.set(order.id, cogsCalculation);
    } catch (error) {
      console.error(`Failed to calculate COGS for order ${order.name}:`, error);
    }
  }

  return cogsDataMap;
}

/**
 * Process order captures and create journal entries
 */
async function processOrderCaptures(
  shop: string,
  accessToken: string,
  order: Order,
  captureTransactions: Transaction[],
  targetDate: string,
  journalEntries: JournalEntry[],
  enrichedTransactions: EnrichedTransaction[],
  warnings: string[],
  errors: string[]
): Promise<void> {
  // Analyze payment methods
  const paymentBreakdowns = await analyzeOrderPayments(
    shop,
    order,
    captureTransactions
  );

  // Validate payment totals
  const paymentErrors = validatePaymentTotal(order, paymentBreakdowns);
  if (paymentErrors.length > 0) {
    errors.push(...paymentErrors);
  }

  // Log reconciliation values for debugging (helps diagnose partial capture/refund issues)
  const usedSales = order.currentSubtotalPrice !== undefined && order.currentSubtotalPrice.gte(0)
    ? order.currentSubtotalPrice
    : order.subtotalPrice;
  const usedTax = order.currentTotalTax !== undefined
    ? order.currentTotalTax
    : (order.totalTax || new Decimal(0));
  logOrderReconciliationValues(order, { sales: usedSales, tax: usedTax });

  // Create journal entries
  const formattedDate = formatDate(targetDate);
  const entries = await createOrderJournalEntries(
    shop,
    order,
    paymentBreakdowns,
    formattedDate,
    accessToken // NEW: Pass accessToken for COGS fulfillment filtering
  );

  journalEntries.push(...entries);

  // Validate entries balance
  const reference = `SO-${order.name}`;
  const validationErrors = validateOrderEntries(entries, reference);
  if (validationErrors.length > 0) {
    errors.push(...validationErrors);
  }

  // Create fee entries for each capture transaction
  for (const txn of captureTransactions) {
    if (txn.fees.length > 0) {
      const feeEntries = await createFeeEntries(shop, txn, formattedDate);
      journalEntries.push(...feeEntries);
    }
  }

  // Enrich order data for reporting
  try {
    const enrichedData = await enrichOrderData(shop, accessToken, order.id);

    enrichedTransactions.push({
      balanceTransaction: {
        id: captureTransactions[0].id, // Use first capture for reference
        type: 'charge',
        sourceOrderId: order.id,
        processedAt: captureTransactions[0].processedAt,
        net: captureTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
        fee: new Decimal(0), // Fees tracked separately
        gross: captureTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
      },
      order: {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        subtotalPrice: order.subtotalPrice,
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        currentSubtotalPrice: order.currentSubtotalPrice,
        currentTotalTax: order.currentTotalTax,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
        lineItems: order.lineItems,
      },
      enrichedData: enrichedData || undefined,
      payout: {
        id: 'Direct Payment', // Order-centric: no payout reference
        date: targetDate,
        amount: new Decimal(0), // Not applicable for order-centric
      },
    });
  } catch (enrichError) {
    console.error(`Failed to enrich order ${order.name}:`, enrichError);
    warnings.push(`Failed to enrich order ${order.name} for export`);
  }

  // Rate limiting delay: prevents rapid sequential enrichment calls
  // when processing multiple orders (500ms = 2 calls/second max)
  await sleep(500);
}

/**
 * Process order refunds and create journal entries
 */
async function processOrderRefunds(
  shop: string,
  accessToken: string,
  order: Order,
  refundTransactions: Transaction[],
  targetDate: string,
  journalEntries: JournalEntry[],
  enrichedTransactions: EnrichedTransaction[],
  warnings: string[]
): Promise<void> {
  const formattedDate = formatDate(targetDate);
  const entries = await createRefundJournalEntries(
    shop,
    order,
    refundTransactions,
    formattedDate
  );

  journalEntries.push(...entries);

  // Enrich order data for refund reporting
  try {
    const enrichedData = await enrichOrderData(shop, accessToken, order.id);

    enrichedTransactions.push({
      balanceTransaction: {
        id: refundTransactions[0].id,
        type: 'refund',
        sourceOrderId: order.id,
        processedAt: refundTransactions[0].processedAt,
        net: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
        fee: new Decimal(0),
        gross: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
      },
      order: {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        subtotalPrice: order.subtotalPrice,
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        currentSubtotalPrice: order.currentSubtotalPrice,
        currentTotalTax: order.currentTotalTax,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
        lineItems: order.lineItems,
      },
      enrichedData: enrichedData || undefined,
      payout: {
        id: 'Direct Payment',
        date: targetDate,
        amount: new Decimal(0),
      },
    });
  } catch (enrichError) {
    console.error(`Failed to enrich refund order ${order.name}:`, enrichError);
    warnings.push(`Failed to enrich refund order ${order.name} for export`);
  }

  // Rate limiting delay: prevents rapid sequential enrichment calls
  // when processing multiple orders (500ms = 2 calls/second max)
  await sleep(500);
}

/**
 * Filter refund transactions by date
 */
function filterRefundTransactions(order: Order, targetDate: string): Transaction[] {
  if (!order.transactions || order.transactions.length === 0) {
    return [];
  }

  return order.transactions.filter((txn) => {
    // Only include refund transactions
    if (txn.kind !== 'refund') {
      return false;
    }

    // Only include successful refunds
    if (txn.status !== 'success') {
      return false;
    }

    // Check if processedAt date matches target date
    const txnDate = formatDateOnly(txn.processedAt);
    return txnDate === targetDate;
  });
}

/**
 * Format date for journal entries (MM/DD/YYYY)
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Extract date-only portion from ISO timestamp (YYYY-MM-DD)
 *
 * CRITICAL: Converts UTC timestamp to store's local timezone (Pacific)
 * before extracting the date. This ensures orders captured in the evening
 * Pacific time don't appear on the next day's journal entry.
 *
 * Example:
 * - UTC: 2026-01-29 01:00:00 UTC
 * - Pacific: 2026-01-28 17:00:00 PST
 * - Returns: "2026-01-28" (correct date for journal entry)
 */
function formatDateOnly(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  // Convert to Pacific timezone (America/Los_Angeles)
  // This handles both PST (-0800) and PDT (-0700) automatically
  const pacificDateString = date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse MM/DD/YYYY format to YYYY-MM-DD
  const [month, day, year] = pacificDateString.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Add days to a date string (YYYY-MM-DD format)
 */
function addDays(dateString: string, days: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
