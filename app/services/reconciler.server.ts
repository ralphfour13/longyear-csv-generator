import { Decimal } from 'decimal.js';
import type {
  Payout,
  BalanceTransaction,
  Order,
  ReconciliationResult,
  JournalEntry,
} from '../types/journal-entry';
import { fetchBalanceTransactions } from './shopify/balance-transaction-fetcher.server';
import { fetchOrderById } from './shopify/order-fetcher.server';
import { fetchOrderTransactions } from './shopify/transaction-fetcher.server';

/**
 * Payout-First Reconciliation Engine
 *
 * This is the core reconciliation logic that:
 * 1. Starts with the payout (what hit the bank - the anchor)
 * 2. Works backwards through balance transactions
 * 3. Fetches order details for each transaction
 * 4. Builds journal entries that reconcile to the exact payout amount
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param payout - The payout to reconcile
 * @returns Reconciliation result with journal entries and validation
 */
export async function reconcilePayout(
  shop: string,
  accessToken: string,
  payout: Payout
): Promise<ReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const journalEntries: JournalEntry[] = [];

  try {
    // Step 1: Fetch all balance transactions for this payout
    console.log(`Fetching balance transactions for payout ${payout.id}...`);
    const balanceTransactions = await fetchBalanceTransactions(
      shop,
      accessToken,
      payout.id
    );

    console.log(`Found ${balanceTransactions.length} balance transactions`);

    // Step 2: For each balance transaction, fetch order details and build entries
    for (const balanceTxn of balanceTransactions) {
      try {
        await processBalanceTransaction(
          shop,
          accessToken,
          balanceTxn,
          journalEntries,
          warnings
        );
      } catch (error) {
        errors.push(
          `Failed to process balance transaction ${balanceTxn.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Step 3: Add payout cash entry (final debit to bank account)
    journalEntries.push({
      date: formatDate(payout.date),
      reference: `PO-${payout.id}`,
      account: '1000-00', // Will be mapped to actual account later
      accountName: 'Cash - Shopify Account',
      debit: payout.amount,
      credit: new Decimal(0),
      memo: `Shopify Payout ${payout.id}`,
    });

    // Step 4: Calculate totals and validate balance
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

    // Step 5: Validate that total credits from clearing equal payout amount
    const clearingTotal = journalEntries
      .filter((entry) => entry.account === '1250-00' && entry.credit.greaterThan(0))
      .reduce((sum, entry) => sum.plus(entry.credit), new Decimal(0));

    if (!clearingTotal.equals(payout.amount)) {
      warnings.push(
        `Clearing account credits (${clearingTotal.toFixed(2)}) do not equal payout amount (${payout.amount.toFixed(2)})`
      );
    }

    return {
      payout,
      journalEntries,
      totalDebit,
      totalCredit,
      balanced,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );

    return {
      payout,
      journalEntries,
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      balanced: false,
      errors,
      warnings,
    };
  }
}

/**
 * Process a single balance transaction and create journal entries
 */
async function processBalanceTransaction(
  shop: string,
  accessToken: string,
  balanceTxn: BalanceTransaction,
  journalEntries: JournalEntry[],
  warnings: string[]
): Promise<void> {
  const txnDate = formatDate(balanceTxn.processedAt);

  // Handle different transaction types
  switch (balanceTxn.type) {
    case 'charge': {
      // This is a sale - fetch order details
      if (balanceTxn.sourceOrderId) {
        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          // Create entries for the order
          createOrderEntries(order, balanceTxn, journalEntries);

          // Create entries for fees
          createFeeEntries(balanceTxn, txnDate, journalEntries);
        } else {
          warnings.push(
            `Order ${balanceTxn.sourceOrderId} not found for balance transaction ${balanceTxn.id}`
          );

          // Create generic entry even if order not found
          journalEntries.push({
            date: txnDate,
            reference: `CHG-${balanceTxn.id}`,
            account: '1250-00',
            accountName: 'Shopify Clearing Account',
            debit: balanceTxn.gross,
            credit: new Decimal(0),
            memo: `Charge - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          journalEntries.push({
            date: txnDate,
            reference: `CHG-${balanceTxn.id}`,
            account: '4000-00',
            accountName: 'Sales Revenue',
            debit: new Decimal(0),
            credit: balanceTxn.gross,
            memo: `Sale - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });
        }
      }
      break;
    }

    case 'refund': {
      // Refund transaction
      if (balanceTxn.sourceOrderId) {
        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          createRefundEntries(order, balanceTxn, txnDate, journalEntries);
        } else {
          // Generic refund entry
          journalEntries.push({
            date: txnDate,
            reference: `RF-${balanceTxn.id}`,
            account: '4900-00',
            accountName: 'Sales Returns & Refunds',
            debit: balanceTxn.gross.abs(),
            credit: new Decimal(0),
            memo: `Refund - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          journalEntries.push({
            date: txnDate,
            reference: `RF-${balanceTxn.id}`,
            account: '1250-00',
            accountName: 'Shopify Clearing Account',
            debit: new Decimal(0),
            credit: balanceTxn.gross.abs(),
            memo: `Refund Clearing - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });
        }
      }
      break;
    }

    case 'adjustment':
    case 'reserve': {
      // Adjustment or reserve entry
      journalEntries.push({
        date: txnDate,
        reference: `ADJ-${balanceTxn.id}`,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: balanceTxn.net.greaterThan(0) ? balanceTxn.net : new Decimal(0),
        credit: balanceTxn.net.lessThan(0) ? balanceTxn.net.abs() : new Decimal(0),
        memo: `${balanceTxn.type} - ${balanceTxn.sourceType || 'Unknown'}`,
      });
      break;
    }

    default: {
      warnings.push(`Unknown transaction type: ${balanceTxn.type} (ID: ${balanceTxn.id})`);
    }
  }
}

/**
 * Create journal entries for an order (sales revenue)
 */
function createOrderEntries(
  order: Order,
  balanceTxn: BalanceTransaction,
  journalEntries: JournalEntry[]
): void {
  const orderDate = formatDate(order.createdAt);
  const reference = `SO-${order.name}`;

  // Debit: Clearing account (gross amount)
  journalEntries.push({
    date: orderDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: balanceTxn.gross,
    credit: new Decimal(0),
    memo: `Order ${order.name}`,
  });

  // Credit: Sales Revenue (subtotal - discounts)
  const netSales = order.subtotalPrice.minus(order.totalDiscounts);
  if (netSales.greaterThan(0)) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4000-00',
      accountName: 'Sales Revenue',
      debit: new Decimal(0),
      credit: netSales,
      memo: `Sales - Order ${order.name}`,
    });
  }

  // Credit: Sales Tax
  if (order.totalTax.greaterThan(0)) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '2200-00',
      accountName: 'Sales Tax Payable',
      debit: new Decimal(0),
      credit: order.totalTax,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // Credit: Shipping Revenue
  if (order.totalShipping.greaterThan(0)) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4100-00',
      accountName: 'Shipping Revenue',
      debit: new Decimal(0),
      credit: order.totalShipping,
      memo: `Shipping - Order ${order.name}`,
    });
  }
}

/**
 * Create journal entries for fees
 */
function createFeeEntries(
  balanceTxn: BalanceTransaction,
  txnDate: string,
  journalEntries: JournalEntry[]
): void {
  if (balanceTxn.fee.greaterThan(0) && balanceTxn.feeBreakdown) {
    const reference = `FEE-${balanceTxn.id}`;

    // Shopify fees
    if (balanceTxn.feeBreakdown.shopifyFee.greaterThan(0)) {
      journalEntries.push({
        date: txnDate,
        reference,
        account: '6110-00',
        accountName: 'Shopify Transaction Fees',
        debit: balanceTxn.feeBreakdown.shopifyFee,
        credit: new Decimal(0),
        memo: 'Shopify Transaction Fee',
      });

      journalEntries.push({
        date: txnDate,
        reference,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.feeBreakdown.shopifyFee,
        memo: 'Fee Deduction',
      });
    }

    // Gateway fees
    if (balanceTxn.feeBreakdown.gatewayFee.greaterThan(0)) {
      journalEntries.push({
        date: txnDate,
        reference,
        account: '6100-00',
        accountName: 'Payment Processing Fees',
        debit: balanceTxn.feeBreakdown.gatewayFee,
        credit: new Decimal(0),
        memo: 'Payment Gateway Fee',
      });

      journalEntries.push({
        date: txnDate,
        reference,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.feeBreakdown.gatewayFee,
        memo: 'Fee Deduction',
      });
    }
  }
}

/**
 * Create journal entries for refunds
 */
function createRefundEntries(
  order: Order,
  balanceTxn: BalanceTransaction,
  txnDate: string,
  journalEntries: JournalEntry[]
): void {
  const reference = `RF-${order.name}`;
  const refundAmount = balanceTxn.gross.abs();

  // Debit: Sales Returns & Refunds
  journalEntries.push({
    date: txnDate,
    reference,
    account: '4900-00',
    accountName: 'Sales Returns & Refunds',
    debit: refundAmount,
    credit: new Decimal(0),
    memo: `Refund - Order ${order.name}`,
  });

  // Credit: Clearing Account
  journalEntries.push({
    date: txnDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: new Decimal(0),
    credit: refundAmount,
    memo: `Refund Clearing - Order ${order.name}`,
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
