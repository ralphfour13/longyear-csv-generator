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

    let ordersProcessed = 0;
    let capturesProcessed = 0;
    const processedOrderIds = new Set<string>();

    // Process each order
    for (const order of orders) {
      try {
        // Filter transactions to only those captured on target date
        const captureTransactions = filterOrderTransactionsByDate(order, targetDate);

        if (captureTransactions.length === 0) {
          // No captures on target date, skip this order
          continue;
        }

        // Check if we've already processed this order
        if (processedOrderIds.has(order.id)) {
          console.log(`Skipping duplicate order ${order.name} (already processed)`);
          continue;
        }

        console.log(
          `Processing order ${order.name} with ${captureTransactions.length} capture(s) on ${targetDate}`
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

    // Calculate totals and validate balance
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
      console.log(`✓ Journal entries balanced: ${totalDebit.toFixed(2)}`);
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
 */
function formatDateOnly(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
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
