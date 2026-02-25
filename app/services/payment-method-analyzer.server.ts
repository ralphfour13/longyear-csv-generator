import { Decimal } from 'decimal.js';
import type { Order, Transaction } from '../types/journal-entry';
import { getAccountMappings } from './storage.server';

/**
 * Payment Method Analyzer
 *
 * Analyzes order payment transactions to determine payment methods
 * and map them to the appropriate GL accounts.
 *
 * Supports:
 * - Card payments (Shopify Payments) → 1250-00 AR Clearing
 * - Gift cards → 2320-00 Gift Card Liability
 * - Store credit → 2340-00 Store Credit Liability
 * - Cash → 1061-00 Cash Register
 * - Manual charges (Charge gateway) → 1310-00 COGS/Expense
 * - Checks → 1051-00 Undeposited Funds
 */

/**
 * Payment Method Breakdown
 * Represents a single payment method used in an order
 */
export interface PaymentMethodBreakdown {
  gateway: string; // e.g., "shopify_payments", "gift_card", "cash"
  paymentMethod?: string; // Additional payment method info if available
  amount: Decimal; // Amount charged via this payment method
  account: string; // GL account code to debit (e.g., "1250-00")
  accountName: string; // GL account name
  transaction: Transaction; // Original transaction for reference
}

/**
 * Analyze order payments and break down by payment method
 *
 * @param shop - Shop domain (for fetching account mappings)
 * @param order - Order with transactions
 * @param captureTransactions - Filtered capture transactions for target date
 * @returns Array of payment method breakdowns
 */
export async function analyzeOrderPayments(
  shop: string,
  order: Order,
  captureTransactions: Transaction[]
): Promise<PaymentMethodBreakdown[]> {
  if (captureTransactions.length === 0) {
    return [];
  }

  const accountMappings = await getAccountMappings(shop);
  const breakdowns: PaymentMethodBreakdown[] = [];

  for (const txn of captureTransactions) {
    const { account, accountName } = mapGatewayToAccount(txn.gateway, accountMappings);

    breakdowns.push({
      gateway: txn.gateway,
      paymentMethod: extractPaymentMethod(txn),
      amount: txn.amount,
      account,
      accountName,
      transaction: txn,
    });
  }

  return breakdowns;
}

/**
 * Map gateway string to GL account
 *
 * @param gateway - Gateway identifier (e.g., "shopify_payments", "gift_card")
 * @param accountMappings - Account mappings configuration
 * @returns Account code and name
 */
function mapGatewayToAccount(
  gateway: string,
  accountMappings: any
): { account: string; accountName: string } {
  // Normalize gateway string
  const normalizedGateway = gateway.toLowerCase();

  // Map gateways to account mappings
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
      // Manual charges go to COGS/Expense (e.g., travel giveaways)
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
      // Unknown gateway - log warning and default to clearing account
      console.warn(`Unknown payment gateway: ${gateway} for order ${gateway}. Defaulting to clearing account.`);
      return {
        account: accountMappings.clearing_account.accountCode,
        accountName: `${accountMappings.clearing_account.accountName} (${gateway})`,
      };
  }
}

/**
 * Extract payment method details from transaction
 * (e.g., last 4 digits of card, card brand)
 *
 * @param txn - Transaction
 * @returns Payment method string or undefined
 */
function extractPaymentMethod(txn: Transaction): string | undefined {
  // TODO: Extract payment_details if available in transaction object
  // For now, just return the gateway name
  return txn.gateway;
}

/**
 * Validate that payment breakdowns sum to order total
 *
 * @param order - Order
 * @param paymentBreakdowns - Payment method breakdowns
 * @returns Validation errors (empty array if valid)
 */
export function validatePaymentTotal(
  order: Order,
  paymentBreakdowns: PaymentMethodBreakdown[]
): string[] {
  const errors: string[] = [];

  // Sum all payment amounts
  const totalPayments = paymentBreakdowns.reduce(
    (sum, breakdown) => sum.plus(breakdown.amount),
    new Decimal(0)
  );

  // For refunded orders, use original total (before refund)
  // For active orders, use current total (reflects edits)
  let orderTotal: Decimal;
  if (order.financialStatus === 'refunded' ||
      order.financialStatus === 'partially_refunded') {
    // Use original total for refunded orders
    orderTotal = order.totalPrice;
  } else {
    // Use current total for active orders (reflects post-purchase edits)
    orderTotal = order.currentTotalPrice || order.totalPrice;
  }

  // Check if totals match (allow 1 cent rounding difference)
  const diff = totalPayments.minus(orderTotal).abs();
  const isValid = diff.lessThanOrEqualTo(new Decimal('0.01'));

  if (!isValid) {
    errors.push(
      `Payment total mismatch for order ${order.name}: ` +
      `Payments=${totalPayments.toFixed(2)}, ` +
      `OrderTotal=${orderTotal.toFixed(2)}, ` +
      `Diff=${diff.toFixed(2)}`
    );
  }

  // Warn if no payments found
  if (paymentBreakdowns.length === 0) {
    errors.push(`No payment breakdowns found for order ${order.name}`);
  }

  return errors;
}

/**
 * Get payment method summary for an order
 * Useful for reporting and debugging
 *
 * @param paymentBreakdowns - Payment method breakdowns
 * @returns Human-readable summary string
 */
export function getPaymentMethodSummary(
  paymentBreakdowns: PaymentMethodBreakdown[]
): string {
  if (paymentBreakdowns.length === 0) {
    return 'No payments';
  }

  if (paymentBreakdowns.length === 1) {
    const breakdown = paymentBreakdowns[0];
    return `${breakdown.accountName}: $${breakdown.amount.toFixed(2)}`;
  }

  // Multiple payment methods (split payment)
  const summary = paymentBreakdowns
    .map((breakdown) => `${breakdown.accountName}: $${breakdown.amount.toFixed(2)}`)
    .join(' + ');

  return `Split Payment: ${summary}`;
}
