import { Decimal } from 'decimal.js';
import type {
  Order,
  JournalEntry,
  EnrichedTransaction,
  Transaction,
} from '../types/journal-entry';
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

/**
 * Order-Centric Reconciliation Result
 */
export interface OrderCentricReconciliationResult {
  journalEntries: JournalEntry[];
  enrichedTransactions: EnrichedTransaction[];
  balanced: boolean;
  errors: string[];
  warnings: string[];
  orderCount: number;
  captureCount: number;
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
  targetDate: string
): Promise<OrderCentricReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const journalEntries: JournalEntry[] = [];
  const enrichedTransactions: EnrichedTransaction[] = [];

  console.log(`\n=== Order-Centric Reconciliation for ${targetDate} ===`);

  try {
    // Fetch orders with activity in the date range (±1 day buffer)
    const startDate = addDays(targetDate, -1);
    const endDate = addDays(targetDate, 1);

    console.log(`Fetching orders between ${startDate} and ${endDate}...`);
    const orders = await fetchOrdersByCaptureDateRange(
      shop,
      accessToken,
      startDate,
      endDate
    );

    console.log(`Found ${orders.length} orders with activity in date range`);
    console.log(`Order names: ${orders.slice(0, 10).map(o => o.name).join(', ')}${orders.length > 10 ? '...' : ''}`);

    let ordersProcessed = 0;
    let capturesProcessed = 0;
    const processedOrderIds = new Set<string>();

    // Process each order
    for (const order of orders) {
      try {
        console.log(`\n--- Evaluating order ${order.name} (ID: ${order.id}) ---`);

        // REFUND-ONLY ORDERS: Handle standalone refunds (where original sale was on prior date)
        // Check this BEFORE capture logic to catch refund-only transactions
        const allCaptureTransactions = order.transactions?.filter(
          (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
        ) || [];

        console.log(`  Capture transactions found: ${allCaptureTransactions.length}`);

        if (allCaptureTransactions.length === 0) {
          // No captures - check if this is a refund-only order
          const refundTransactions = filterRefundTransactions(order, targetDate);
          if (refundTransactions.length > 0) {
            console.log(
              `  ✓ Processing refund-only order ${order.name} with ${refundTransactions.length} refund(s)`
            );

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
            console.log(`  ✗ SKIP: No captures and no refunds on target date`);
          }
          // Skip to next order (either processed refunds or nothing to do)
          continue;
        }

        // LAST-CAPTURE-DATE RULE: Order posts on the date of its LAST captured payment
        // This ensures split-payment orders post as a complete unit (all legs balance)
        const lastCaptureDate = getOrderCaptureDate(order);

        console.log(`  Last capture date: ${lastCaptureDate}, Target date: ${targetDate}`);

        if (!lastCaptureDate) {
          // Should not happen since we checked for captures above, but safety check
          console.log(`  ✗ SKIP: Could not determine last capture date`);
          continue;
        }

        if (lastCaptureDate !== targetDate) {
          // This order's last capture is on a different date, skip for now
          // It will be processed when we run reconciliation for that date
          console.log(`  ✗ SKIP: Last capture date (${lastCaptureDate}) doesn't match target (${targetDate})`);
          continue;
        }

        // Use ALL capture transactions (already filtered above)
        // This ensures we include all payment legs when the order posts
        const captureTransactions = allCaptureTransactions;

        // Check if we've already processed this order
        if (processedOrderIds.has(order.id)) {
          console.log(`  ✗ SKIP: Already processed this order`);
          continue;
        }

        // Log timezone-aware capture information for debugging
        const firstCapture = captureTransactions[0];
        const firstCaptureUTC = new Date(firstCapture.processedAt).toISOString();
        const firstCapturePacific = new Date(firstCapture.processedAt).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'short',
          timeStyle: 'short',
        });

        console.log(
          `  ✓ PROCESSING order ${order.name} with ${captureTransactions.length} capture(s) ` +
          `(last capture: ${lastCaptureDate}, first capture UTC: ${firstCaptureUTC}, Pacific: ${firstCapturePacific})`
        );

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
      orderCount: 0,
      captureCount: 0,
    };
  }
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
  console.log(`  Processing ${refundTransactions.length} refund(s) for order ${order.name}`);

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
