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
 * CRITICAL: Each SO- reference MUST balance internally (debits = credits)
 * AR debit MUST equal the sum of Sales + Tax + Shipping credits
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
    console.log(`Fetching balance transactions for payout ${payout.id}...`);
    const balanceTransactions = await fetchBalanceTransactions(
      shop,
      accessToken,
      payout.id
    );

    console.log(`Found ${balanceTransactions.length} balance transactions`);

    for (const balanceTxn of balanceTransactions) {
      try {
        await processBalanceTransaction(
          shop,
          accessToken,
          balanceTxn,
          journalEntries,
          warnings,
          errors
        );
      } catch (error) {
        errors.push(
          `Failed to process balance transaction ${balanceTxn.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Add payout cash entry (final debit to bank account)
    journalEntries.push({
      date: formatDate(payout.date),
      reference: `PO-${payout.id}`,
      account: '1000-00',
      accountName: 'Cash - Shopify Account',
      debit: payout.amount,
      credit: new Decimal(0),
      memo: `Shopify Payout ${payout.id}`,
    });

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
    }

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
  warnings: string[],
  errors: string[]
): Promise<void> {
  const txnDate = formatDate(balanceTxn.processedAt);

  switch (balanceTxn.type) {
    case 'charge': {
      if (balanceTxn.sourceOrderId) {
        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          createOrderEntries(order, balanceTxn, journalEntries, errors);
          createFeeEntries(balanceTxn, txnDate, journalEntries);
        } else {
          warnings.push(
            `Order ${balanceTxn.sourceOrderId} not found for balance transaction ${balanceTxn.id}`
          );

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
      if (balanceTxn.sourceOrderId) {
        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          createRefundEntries(order, balanceTxn, txnDate, journalEntries);
        } else {
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

    case 'payout': {
      // Payout transaction within balance transactions (clearing to bank)
      // This represents the final settlement from clearing account to bank
      journalEntries.push({
        date: txnDate,
        reference: `PO-${balanceTxn.id}`,
        account: '1000-00',
        accountName: 'Cash - Shopify Account',
        debit: balanceTxn.net.abs(),
        credit: new Decimal(0),
        memo: `Bank Deposit - Payout`,
      });

      journalEntries.push({
        date: txnDate,
        reference: `PO-${balanceTxn.id}`,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.net.abs(),
        memo: `Clear to Bank`,
      });
      break;
    }

    case 'adjustment':
    case 'reserve': {
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
 *
 * APPROACH: GROSS Sales with separate discount line
 * - Sales = GROSS revenue (catalog price × quantity)
 * - Discount = Separate debit line (4050-00) for visibility
 * - Tax and Shipping = Always included
 * - Invariant: AR + Discount = Sales + Tax + Shipping
 */
function createOrderEntries(
  order: Order,
  balanceTxn: BalanceTransaction,
  journalEntries: JournalEntry[],
  errors: string[]
): void {
  const orderDate = formatDate(order.createdAt);
  const reference = `SO-${order.name}`;

  // AR Debit: What customer actually paid
  const arAmount = balanceTxn.gross;

  journalEntries.push({
    date: orderDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: arAmount,
    credit: new Decimal(0),
    memo: `Order ${order.name}`,
  });

  // Calculate GROSS sales using CURRENT subtotal (handles edited orders)
  // Use current_subtotal_price if available (reflects edits/removals)
  // Otherwise calculate from line items
  const grossSales = order.currentSubtotalPrice || order.lineItems.reduce(
    (sum, item) => sum.plus(item.price.times(item.quantity)),
    new Decimal(0)
  );

  console.log(`Order ${order.name}: Gross sales = ${grossSales.toFixed(2)} (${order.currentSubtotalPrice ? 'from current_subtotal_price' : 'calculated from line items'})`);

  // Credit: Sales Revenue (GROSS - full catalog price)
  journalEntries.push({
    date: orderDate,
    reference,
    account: '4000-00',
    accountName: 'Sales Revenue',
    debit: new Decimal(0),
    credit: grossSales,
    memo: `Sales - Order ${order.name}`,
  });

  // Debit: Discounts (if any) - use CURRENT discounts for edited orders
  const discountAmount = order.currentTotalDiscounts || order.totalDiscounts;
  if (discountAmount && discountAmount.greaterThan(0)) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4050-00',
      accountName: 'Discounts Given',
      debit: discountAmount,
      credit: new Decimal(0),
      memo: `Discount - Order ${order.name}`,
    });
  }

  // Credit: Sales Tax (only if > 0, zero is valid for out-of-state)
  const taxAmount = order.totalTax;
  const hasTax = taxAmount && taxAmount.greaterThan(0);

  if (hasTax) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '2200-00',
      accountName: 'Sales Tax Payable',
      debit: new Decimal(0),
      credit: taxAmount,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // Credit: Shipping Revenue (only if > 0, zero is valid for POS/pickup)
  const shippingAmount = order.totalShipping;
  const hasShipping = shippingAmount && shippingAmount.greaterThan(0);

  if (hasShipping) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4100-00',
      accountName: 'Shipping Revenue',
      debit: new Decimal(0),
      credit: shippingAmount,
      memo: `Shipping - Order ${order.name}`,
    });
  }

  // VALIDATION: AR + Discount = Sales + Tax + Shipping
  const totalDebits = arAmount.plus(discountAmount || new Decimal(0));
  const totalCredits = grossSales
    .plus(taxAmount || new Decimal(0))
    .plus(shippingAmount || new Decimal(0));

  // Check if balanced
  const isBalanced = totalDebits.equals(totalCredits);

  if (!isBalanced) {
    const diff = totalDebits.minus(totalCredits);

    // Build detailed error message
    let errorMsg = `Order ${order.name} IMBALANCE: ` +
      `Debits(AR+Disc)=${totalDebits.toFixed(2)}, ` +
      `Credits(S+T+Sh)=${totalCredits.toFixed(2)} (diff=${diff.toFixed(2)}). ` +
      `[GrossSales=${grossSales.toFixed(2)}, Discount=${(discountAmount || new Decimal(0)).toFixed(2)}, ` +
      `Tax=${(taxAmount || new Decimal(0)).toFixed(2)}, Ship=${(shippingAmount || new Decimal(0)).toFixed(2)}]`;

    // Add context about missing amounts
    if (!hasTax) {
      errorMsg += ' [No tax - may be out-of-state order]';
    }
    if (!hasShipping) {
      errorMsg += ' [No shipping - may be POS/pickup order]';
    }

    errors.push(errorMsg);
  } else {
    // Log successful balance with context
    let successMsg = `Order ${order.name} ✓ Balanced: ${arAmount.toFixed(2)}`;
    if (!hasTax) {
      console.log(`${successMsg} [Out-of-state - no tax]`);
    }
    if (!hasShipping) {
      console.log(`${successMsg} [POS/Pickup - no shipping]`);
    }
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
