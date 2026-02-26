import { Decimal } from 'decimal.js';
import type { Order, JournalEntry, Transaction } from '../types/journal-entry';
import type { PaymentMethodBreakdown } from './payment-method-analyzer.server';
import { getAccountMappings } from './storage.server';
import { calculateOrderCogs } from './cogs/cogs-calculator.server';
import { createCogsJournalEntries } from './cogs/cogs-journal-generator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';

/**
 * Order-Centric Journal Entry Generator
 *
 * Generates journal entries from orders using payment method breakdowns.
 * Each order can have multiple payment methods (split payments).
 *
 * Entry structure:
 * - Debit: One entry per payment method (e.g., Card, Gift Card, Cash)
 * - Credit: Sales Revenue (NET - post-discount amount)
 * - Credit: Sales Tax
 * - Credit: Shipping Revenue
 * - Debit/Credit: COGS entries (if Cin7 enabled)
 *
 * Example split payment (Card $7.03 + Gift Card $20.00 = $27.03 total):
 * SO-81302: Order #81302
 *   1250-00 (AR - Card)        +7.03 Dr
 *   2320-00 (Gift Card)       +20.00 Dr
 *   4000-00 (Sales)           -25.20 Cr  [NET amount, post-discount]
 *   2200-00 (Tax)              -1.83 Cr
 *   4000-00 (COGS)            +15.37 Dr
 *   1310-00 (Inventory)       -15.37 Cr
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
 * @param accessToken - Shopify access token (optional, for COGS fulfillment filtering)
 * @returns Array of journal entries
 */
export async function createOrderJournalEntries(
  shop: string,
  order: Order,
  paymentBreakdowns: PaymentMethodBreakdown[],
  targetDate: string,
  accessToken?: string
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

  // Calculate NET sales (post-discount)
  // CRITICAL: For refunded orders, use ORIGINAL subtotal (not current)
  let netSales: Decimal;

  // Check if order has been refunded
  const isRefunded =
    order.financialStatus === 'refunded' ||
    order.financialStatus === 'partially_refunded';

  if (isRefunded) {
    // For refunded orders: Use ORIGINAL subtotal (before refunds)
    // This ensures SO- entry reflects the original captured transaction
    // The RF- entry will handle the refund reversal separately
    netSales = order.subtotalPrice;

    console.log(
      `ℹ️  Order ${order.name} (${order.financialStatus}): ` +
      `Using ORIGINAL subtotal $${netSales.toFixed(2)} ` +
      `(current would be $${order.currentSubtotalPrice?.toFixed(2) || 'N/A'})`
    );
  } else if (order.currentSubtotalPrice) {
    // For non-refunded orders: currentSubtotalPrice is NET (after discounts)
    netSales = order.currentSubtotalPrice;
  } else {
    // Fallback: Calculate NET from total payment minus tax and shipping
    // NET Sales = Total Payment - Tax - Shipping
    netSales = order.totalPrice
      .minus(order.totalTax || new Decimal(0))
      .minus(order.totalShipping || new Decimal(0));
  }

  // CREDIT: Sales Revenue (NET - post-discount amount)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.sales_revenue.accountCode,
    accountName: accountMappings.sales_revenue.accountName,
    debit: new Decimal(0),
    credit: netSales,
    memo: `Sales - Order ${order.name}`,
  });

  // NO DISCOUNT ENTRY - discounts are already reflected in NET sales amount

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

  // Add COGS entries (if Cin7 enabled and order has line items)
  try {
    const cin7Enabled = await isCin7Enabled(shop);
    if (cin7Enabled && order.lineItems.length > 0) {
      // NEW: Pass accessToken to enable fulfillment-based filtering
      const cogsCalculation = await calculateOrderCogs(shop, order, accessToken, true);

      // Always create COGS entries if order has products, even if calculation is $0
      // This ensures journal completeness and highlights missing COGS data
      if (cogsCalculation.totalCogs.greaterThan(0)) {
        const cogsEntries = await createCogsJournalEntries(
          shop,
          order.name,
          cogsCalculation,
          targetDate
        );
        entries.push(...cogsEntries);
      } else if (order.lineItems.length > 0) {
        // Log warning if order has products but COGS is $0
        console.warn(
          `⚠️ Order ${order.name} has ${order.lineItems.length} line items but COGS is $0. ` +
          `Check Cin7 product cost data.`
        );
      }

      // Log all COGS warnings
      if (cogsCalculation.warnings.length > 0) {
        for (const warning of cogsCalculation.warnings) {
          console.warn(warning);
        }
      }
    }
  } catch (error) {
    // Critical error: COGS calculation failed completely
    console.error(
      `❌ Failed to calculate COGS for ${order.name}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Still continue - journal will be incomplete but won't block export
    // Operator should review warnings and investigate missing COGS
  }

  return entries;
}

/**
 * Create journal entries for refunds
 *
 * Refunds reverse the original order entries.
 * Uses the refund transaction's processedAt date.
 *
 * Entry structure:
 * - RF- entries: Credit payment account (refund payment going out)
 * - SO- reversal entries: Debit sales revenue, tax, and shipping (reverse original credits)
 *
 * Example refund ($620.98 total: $579.00 sales + $41.98 tax):
 * RF-#80427: Refund - Order #80427
 *   1061.000 (Credit Card)     -620.98 Cr  [Refund payment out]
 * SO-#80427: Reversals
 *   3000.000 (Sales)           +579.00 Dr  [Reverse original sales credit]
 *   2110.000 (Tax)              +41.98 Dr  [Reverse original tax credit]
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
    const refundAmount = refundTxn.amount.abs();

    // RF- ENTRY: Payment reversal (credit payment account)
    const { account, accountName } = await getRefundAccount(
      shop,
      refundTxn.gateway,
      accountMappings
    );

    entries.push({
      date: targetDate,
      reference: `RF-${order.name}`,
      account,
      accountName,
      debit: new Decimal(0),
      credit: refundAmount,
      memo: `Refund ${accountName} - Order ${order.name}`,
    });

    // SO- REVERSAL ENTRIES: Reverse revenue and tax PROPORTIONALLY
    // Calculate amounts from order
    const netSales = calculateNetSalesForRefund(order);
    const taxAmount = order.totalTax || new Decimal(0);
    const shippingAmount = order.totalShipping || new Decimal(0);

    // Calculate refund ratio (what % of order is being refunded)
    const orderTotal = order.totalPrice;
    const refundRatio = refundAmount.dividedBy(orderTotal);

    // Calculate proportional amounts based on refund ratio
    const refundedSales = netSales.times(refundRatio);
    const refundedTax = taxAmount.times(refundRatio);
    const refundedShipping = shippingAmount.times(refundRatio);

    console.log(
      `Refund ${order.name}: $${refundAmount.toFixed(2)} / $${orderTotal.toFixed(2)} = ` +
      `${refundRatio.times(100).toFixed(2)}% ` +
      `(Sales: $${refundedSales.toFixed(2)}, Tax: $${refundedTax.toFixed(2)}, ` +
      `Shipping: $${refundedShipping.toFixed(2)})`
    );

    // DEBIT: Sales Revenue (reverse proportional credit)
    if (refundedSales.greaterThan(0)) {
      entries.push({
        date: targetDate,
        reference: `SO-${order.name}`,
        account: accountMappings.sales_revenue.accountCode,
        accountName: accountMappings.sales_revenue.accountName,
        debit: refundedSales,
        credit: new Decimal(0),
        memo: `Sales Refund - Order ${order.name}`,
      });
    }

    // DEBIT: Sales Tax (reverse proportional credit)
    if (refundedTax.greaterThan(0)) {
      entries.push({
        date: targetDate,
        reference: `SO-${order.name}`,
        account: accountMappings.sales_tax.accountCode,
        accountName: accountMappings.sales_tax.accountName,
        debit: refundedTax,
        credit: new Decimal(0),
        memo: `Sales Tax Refund - Order ${order.name}`,
      });
    }

    // DEBIT: Shipping Revenue (reverse proportional credit, if applicable)
    if (refundedShipping.greaterThan(0)) {
      entries.push({
        date: targetDate,
        reference: `SO-${order.name}`,
        account: accountMappings.shipping_revenue.accountCode,
        accountName: accountMappings.shipping_revenue.accountName,
        debit: refundedShipping,
        credit: new Decimal(0),
        memo: `Shipping Refund - Order ${order.name}`,
      });
    }
  }

  // NOTE: COGS entries are NOT reversed for refunds
  // When items are refunded, the COGS remains recognized (expense already incurred)
  // Inventory doesn't necessarily return (could be damaged, restocking fee, etc.)
  // Only the revenue side (sales and payment) is reversed

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
 * Calculate net sales amount for refund reversal
 * Must match the original SO- entry calculation from createOrderJournalEntries()
 *
 * @param order - Order being refunded
 * @returns Net sales amount (post-discount)
 */
function calculateNetSalesForRefund(order: Order): Decimal {
  // Check if order has been refunded
  const isRefunded =
    order.financialStatus === 'refunded' ||
    order.financialStatus === 'partially_refunded';

  if (isRefunded) {
    // For refunded orders: Use ORIGINAL subtotal (before refunds)
    // This ensures reversal matches the original SO- entry
    return order.subtotalPrice;
  } else if (order.currentSubtotalPrice) {
    // For non-refunded orders: currentSubtotalPrice is NET (after discounts)
    return order.currentSubtotalPrice;
  } else {
    // Fallback: Calculate NET from total payment minus tax and shipping
    // NET Sales = Total Payment - Tax - Shipping
    return order.totalPrice
      .minus(order.totalTax || new Decimal(0))
      .minus(order.totalShipping || new Decimal(0));
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
