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
  filterOrderTransactionsByDate,
  getOrderCaptureDate,
} from './order-centric-fetcher.server';
import {
  analyzeOrderPayments,
  validatePaymentTotal,
  getPaymentMethodSummary,
} from './payment-method-analyzer.server';
import {
  createOrderJournalEntries,
  createRefundJournalEntries,
  createFeeEntries,
  validateOrderEntries,
} from './order-centric-journal-generator.server';
import { enrichOrderData } from './enrichment/order-enrichment.server';
import { calculateOrderCogs } from './cogs/cogs-calculator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';

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
  targetDate: string
): Promise<OrderCentricReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cogsWarnings: string[] = [];
  const journalEntries: JournalEntry[] = [];
  const enrichedTransactions: EnrichedTransaction[] = [];

  console.log(`\n=== Order-Centric Reconciliation for ${targetDate} ===`);

  try {
    // Fetch orders with activity in the date range (±2 day buffer for created_at query)
    // The fetcher uses dual-query strategy:
    // - created_at: Uses full ±2 day buffer to catch orders created near target date
    // - updated_at: Uses ±1 day buffer to catch recently modified orders
    const startDate = addDays(targetDate, -2);
    const endDate = addDays(targetDate, 2);

    console.log(`Fetching orders between ${startDate} and ${endDate}...`);
    const orders = await fetchOrdersByCaptureDateRange(
      shop,
      accessToken,
      startDate,
      endDate
    );

    console.log(`Found ${orders.length} orders with activity in date range`);

    let ordersProcessed = 0;
    let capturesProcessed = 0;
    const processedOrderIds = new Set<string>();

    // Process each order
    for (const order of orders) {
      try {
        // DIAGNOSTIC: Log gift card order details for investigation
        if (order.name === '#80386' || order.name === '#80423') {
          console.log(
            `🎁 Gift Card Order ${order.name}:\n` +
            `  Financial Status: ${order.financialStatus}\n` +
            `  Total Price: $${order.totalPrice.toFixed(2)}\n` +
            `  Line Items: ${order.lineItems.map(i => i.title).join(', ')}\n` +
            `  Transactions: ${JSON.stringify(order.transactions?.map(t => ({
              kind: t.kind,
              status: t.status,
              gateway: t.gateway,
              amount: t.amount.toFixed(2)
            })), null, 2)}`
          );
        }

        // REFUND-ONLY ORDERS: Handle standalone refunds (where original sale was on prior date)
        // Check this BEFORE capture logic to catch refund-only transactions
        const allCaptureTransactions = order.transactions?.filter(
          (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
        ) || [];

        if (allCaptureTransactions.length === 0) {
          // No captures - check if this is a refund-only order
          const refundTransactions = filterRefundTransactions(order, targetDate);
          if (refundTransactions.length > 0) {
            console.log(`Processing refund-only order ${order.name} (${refundTransactions.length} refund(s))`);

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
          } else {
            // DIAGNOSTIC: Log when orders are skipped due to no transactions
            console.log(
              `⏭️  Skipping order ${order.name}: No capture/sale/refund transactions found ` +
              `(Financial: ${order.financialStatus}, Total: $${order.totalPrice.toFixed(2)})`
            );
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

        console.log(`Processing order ${order.name} (${captureTransactions.length} capture(s))`);

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

    console.log(`\nProcessed ${ordersProcessed} orders with ${capturesProcessed} captures`);

    // VALIDATION: Verify each SO- reference balances (per-order balance check)
    console.log('\nValidating per-order balance...');
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
      } else {
        console.log(`✓ ${reference} balanced: ${refDebits.toFixed(2)}`);
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
    } else {
      console.log(`✓ Overall journal entries balanced: ${totalDebit.toFixed(2)}`);
    }

    return {
      journalEntries,
      enrichedTransactions,
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
 * @param shop - Shop domain
 * @param orders - Array of orders
 * @returns Map of order ID to COGS calculation
 */
export async function collectCogsData(
  shop: string,
  orders: Order[]
): Promise<Map<string, CogsCalculation>> {
  const cogsDataMap = new Map<string, CogsCalculation>();

  // Check if Cin7 is enabled
  const cin7Enabled = await isCin7Enabled(shop);
  if (!cin7Enabled) {
    return cogsDataMap;
  }

  console.log(`📦 Collecting COGS data for ${orders.length} orders...`);

  // OPTIMIZATION: Collect all unique SKUs across all orders first
  const uniqueSkus = new Set<string>();
  for (const order of orders) {
    for (const lineItem of order.lineItems) {
      if (lineItem.sku) {
        uniqueSkus.add(lineItem.sku);
      }
    }
  }

  console.log(`📊 Found ${uniqueSkus.length} unique SKUs across ${orders.length} orders`);

  // Pre-fetch all costs in one batch (with rate limiting and caching)
  const skuArray = Array.from(uniqueSkus);
  const cin7Service = new (await import('./cin7/cin7-product-service.server')).Cin7ProductService(shop);
  await cin7Service.initialize();

  console.log(`🔄 Fetching costs for ${skuArray.length} unique SKUs (cached hits will be instant)...`);
  await cin7Service.batchGetCosts(skuArray);
  console.log(`✅ Cost pre-fetch complete`);

  // Now calculate COGS for each order (costs are cached, so this is fast)
  let ordersProcessed = 0;
  for (const order of orders) {
    try {
      const cogsCalculation = await calculateOrderCogs(shop, order);
      cogsDataMap.set(order.id, cogsCalculation);
      ordersProcessed++;

      // Log progress every 50 orders
      if (ordersProcessed % 50 === 0) {
        console.log(`  Processed COGS for ${ordersProcessed}/${orders.length} orders...`);
      }
    } catch (error) {
      console.error(`Failed to calculate COGS for order ${order.name}:`, error);
    }
  }

  console.log(`✅ COGS collection complete: ${ordersProcessed} orders processed`);

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

  // Log payment method summary
  const paymentSummary = getPaymentMethodSummary(paymentBreakdowns);
  console.log(`  Payment methods: ${paymentSummary}`);

  // Create journal entries
  const formattedDate = formatDate(targetDate);
  const entries = await createOrderJournalEntries(
    shop,
    order,
    paymentBreakdowns,
    formattedDate
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
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
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
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
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
