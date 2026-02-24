import { Decimal } from 'decimal.js';
import type { Order, JournalEntry, Transaction } from '../types/journal-entry';
import type { PaymentMethodBreakdown } from './payment-method-analyzer.server';
import { getAccountMappings } from './storage.server';
import { calculateOrderCogs } from './cogs/cogs-calculator.server';
import { createCogsJournalEntries, createCogsRefundEntries } from './cogs/cogs-journal-generator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';

/**
 * Order-Centric Journal Entry Generator
 *
 * Generates journal entries from orders using payment method breakdowns.
 * Each order can have multiple payment methods (split payments).
 *
 * Entry structure:
 * - Debit: One entry per payment method (e.g., Card, Gift Card, Cash)
 * - Credit: Single block for sales/tax/shipping
 * - Debit: Discounts (if any) for visibility
 * - NEW: COGS entries (if Cin7 enabled)
 *
 * Example split payment (Card $7.03 + Gift Card $20.00 = $27.03 total):
 * SO-81302: Order #81302
 *   1250-00 (AR - Card)        +7.03 Dr
 *   2320-00 (Gift Card)       +20.00 Dr
 *   4000-00 (Sales)           -25.20 Cr
 *   2200-00 (Tax)              -1.83 Cr
 *   4000-00 (COGS)            +15.37 Dr  [NEW]
 *   1310-00 (Inventory)       -15.37 Cr  [NEW]
 *
 * Total: 0.00 ✓ Balanced
 */

/**
 * Create journal entries for an order
 *
 * @param shop - Shop domain (for account mappings)
 * @param order - Order with transaction details
 * @param paymentBreakdowns - Payment method breakdowns
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @returns Array of journal entries
 */
export async function createOrderJournalEntries(
  shop: string,
  order: Order,
  paymentBreakdowns: PaymentMethodBreakdown[],
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const reference = `SO-${order.name}`;
  const accountMappings = await getAccountMappings(shop);

  // DEBITS: One entry per payment method
  for (const breakdown of paymentBreakdowns) {
    entries.push({
      date: targetDate,
      reference,
      account: breakdown.account,
      accountName: breakdown.accountName,
      debit: breakdown.amount,
      credit: new Decimal(0),
      memo: `${breakdown.accountName} - Order ${order.name}`,
    });
  }

  // Calculate GROSS sales (before discounts)
  const discountAmount = order.currentTotalDiscounts || order.totalDiscounts || new Decimal(0);

  let grossSales: Decimal;
  if (order.currentSubtotalPrice) {
    // For edited orders: NET + Discount = GROSS
    grossSales = order.currentSubtotalPrice.plus(discountAmount);
  } else {
    // For standard orders: sum line item prices (GROSS per item)
    grossSales = order.lineItems.reduce(
      (sum, item) => sum.plus(item.price.times(item.quantity)),
      new Decimal(0)
    );
  }

  // CREDIT: Sales Revenue (GROSS - full catalog price before discounts)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.sales_revenue.accountCode,
    accountName: accountMappings.sales_revenue.accountName,
    debit: new Decimal(0),
    credit: grossSales,
    memo: `Sales - Order ${order.name}`,
  });

  // DEBIT: Discounts (if any)
  if (discountAmount.greaterThan(0)) {
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.discounts.accountCode,
      accountName: accountMappings.discounts.accountName,
      debit: discountAmount,
      credit: new Decimal(0),
      memo: `Discount - Order ${order.name}`,
    });
  }

  // CREDIT: Sales Tax (only if > 0)
  const taxAmount = order.totalTax;
  if (taxAmount && taxAmount.greaterThan(0)) {
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.sales_tax.accountCode,
      accountName: accountMappings.sales_tax.accountName,
      debit: new Decimal(0),
      credit: taxAmount,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // CREDIT: Shipping Revenue (only if > 0)
  const shippingAmount = order.totalShipping;
  if (shippingAmount && shippingAmount.greaterThan(0)) {
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.shipping_revenue.accountCode,
      accountName: accountMappings.shipping_revenue.accountName,
      debit: new Decimal(0),
      credit: shippingAmount,
      memo: `Shipping - Order ${order.name}`,
    });
  }

  // NEW: Add COGS entries (if Cin7 enabled)
  try {
    const cin7Enabled = await isCin7Enabled(shop);
    if (cin7Enabled) {
      const cogsCalculation = await calculateOrderCogs(shop, order);

      if (cogsCalculation.totalCogs.greaterThan(0)) {
        const cogsEntries = await createCogsJournalEntries(
          shop,
          order.name,
          cogsCalculation,
          targetDate
        );
        entries.push(...cogsEntries);
      }

      // Log warnings if any
      if (cogsCalculation.warnings.length > 0) {
        for (const warning of cogsCalculation.warnings) {
          console.warn(warning);
        }
      }
    }
  } catch (error) {
    console.error(`Failed to calculate COGS for ${order.name}:`, error);
    // Non-blocking: Continue without COGS entries
  }

  return entries;
}

/**
 * Create journal entries for refunds
 *
 * Refunds reverse the original order entries.
 * Uses the refund transaction's processedAt date.
 *
 * @param shop - Shop domain (for account mappings)
 * @param order - Order being refunded
 * @param refundTransactions - Refund transactions for target date
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @returns Array of journal entries
 */
export async function createRefundJournalEntries(
  shop: string,
  order: Order,
  refundTransactions: Transaction[],
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const accountMappings = await getAccountMappings(shop);

  for (const refundTxn of refundTransactions) {
    const reference = `RF-${order.name}`;
    const refundAmount = refundTxn.amount.abs();

    // DEBIT: Sales Returns & Refunds
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.refunds_given.accountCode,
      accountName: accountMappings.refunds_given.accountName,
      debit: refundAmount,
      credit: new Decimal(0),
      memo: `Refund - Order ${order.name}`,
    });

    // CREDIT: Payment method account (reverse original debit)
    // Determine which payment method to credit based on refund gateway
    const { account, accountName } = await getRefundAccount(
      shop,
      refundTxn.gateway,
      accountMappings
    );

    entries.push({
      date: targetDate,
      reference,
      account,
      accountName,
      debit: new Decimal(0),
      credit: refundAmount,
      memo: `Refund ${accountName} - Order ${order.name}`,
    });
  }

  // NEW: Add reverse COGS entries (if Cin7 enabled)
  try {
    const cin7Enabled = await isCin7Enabled(shop);
    if (cin7Enabled) {
      const cogsCalculation = await calculateOrderCogs(shop, order);

      if (cogsCalculation.totalCogs.greaterThan(0)) {
        const cogsRefundEntries = await createCogsRefundEntries(
          shop,
          order.name,
          cogsCalculation,
          targetDate
        );
        entries.push(...cogsRefundEntries);
      }

      // Log warnings if any
      if (cogsCalculation.warnings.length > 0) {
        for (const warning of cogsCalculation.warnings) {
          console.warn(warning);
        }
      }
    }
  } catch (error) {
    console.error(`Failed to reverse COGS for ${order.name}:`, error);
    // Non-blocking: Continue without COGS entries
  }

  return entries;
}

/**
 * Get the account to credit for a refund based on gateway
 */
async function getRefundAccount(
  shop: string,
  gateway: string,
  accountMappings: any
): Promise<{ account: string; accountName: string }> {
  const normalizedGateway = gateway.toLowerCase();

  switch (normalizedGateway) {
    case 'shopify_payments':
      return {
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
      };

    case 'gift_card':
      return {
        account: accountMappings.gift_card_liability.accountCode,
        accountName: accountMappings.gift_card_liability.accountName,
      };

    case 'shopify_store_credit':
    case 'store_credit':
      return {
        account: accountMappings.store_credit_liability.accountCode,
        accountName: accountMappings.store_credit_liability.accountName,
      };

    case 'cash':
      return {
        account: accountMappings.cash_register.accountCode,
        accountName: accountMappings.cash_register.accountName,
      };

    case 'charge':
      return {
        account: accountMappings.cogs_inventory_writeoff.accountCode,
        accountName: accountMappings.cogs_inventory_writeoff.accountName,
      };

    case 'check':
    case 'cheque':
      return {
        account: accountMappings.undeposited_funds.accountCode,
        accountName: accountMappings.undeposited_funds.accountName,
      };

    default:
      console.warn(`Unknown refund gateway: ${gateway}. Defaulting to clearing account.`);
      return {
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
      };
  }
}

/**
 * Validate that journal entries balance for a given reference
 *
 * @param entries - Journal entries to validate
 * @param reference - Reference to validate (e.g., "SO-1001")
 * @returns Array of validation errors (empty if balanced)
 */
export function validateOrderEntries(
  entries: JournalEntry[],
  reference: string
): string[] {
  const errors: string[] = [];

  // Filter entries for this reference
  const refEntries = entries.filter((entry) => entry.reference === reference);

  if (refEntries.length === 0) {
    errors.push(`No entries found for reference ${reference}`);
    return errors;
  }

  // Calculate totals
  const totalDebits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );

  const totalCredits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  // Check if balanced (allow 1 cent rounding difference)
  const diff = totalDebits.minus(totalCredits).abs();
  const isBalanced = diff.lessThanOrEqualTo(new Decimal('0.01'));

  if (!isBalanced) {
    errors.push(
      `Reference ${reference} does not balance: ` +
      `Debits=${totalDebits.toFixed(2)}, ` +
      `Credits=${totalCredits.toFixed(2)}, ` +
      `Diff=${diff.toFixed(2)}`
    );
  }

  return errors;
}

/**
 * Create journal entries for fees
 * (Unchanged from payout-centric system)
 */
export async function createFeeEntries(
  shop: string,
  transaction: Transaction,
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const accountMappings = await getAccountMappings(shop);

  if (transaction.fees.length === 0) {
    return entries;
  }

  const reference = `FEE-${transaction.id}`;

  for (const fee of transaction.fees) {
    if (fee.amount.greaterThan(0)) {
      // Determine fee account based on type
      let feeAccount: string;
      let feeAccountName: string;

      if (fee.type === 'shopify_fee') {
        feeAccount = accountMappings.shopify_fees.accountCode;
        feeAccountName = accountMappings.shopify_fees.accountName;
      } else {
        feeAccount = accountMappings.payment_processing_fees.accountCode;
        feeAccountName = accountMappings.payment_processing_fees.accountName;
      }

      // DEBIT: Fee expense
      entries.push({
        date: targetDate,
        reference,
        account: feeAccount,
        accountName: feeAccountName,
        debit: fee.amount,
        credit: new Decimal(0),
        memo: `${fee.type.replace('_', ' ')} - Transaction ${transaction.id}`,
      });

      // CREDIT: Clearing account (fee deduction)
      entries.push({
        date: targetDate,
        reference,
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
        debit: new Decimal(0),
        credit: fee.amount,
        memo: 'Fee Deduction',
      });
    }
  }

  return entries;
}
