import { Decimal } from 'decimal.js';
import type { Order } from '../../types/journal-entry';

/**
 * Enriched order data for Daily Sales Report
 * Contains additional fields beyond standard Order interface
 */
export interface EnrichedOrderData {
  tags: string;
  taxLines: TaxLine[];
  shippingAddress: ShippingAddress;
  transactions: OrderTransaction[];
  paymentBreakdown: PaymentBreakdown;
  fulfillmentStatus: string;
  financialStatus: string;
  totalShippingPrice: Decimal;
  currentTotalPrice: Decimal;
  totalRefunded: Decimal;
}

export interface TaxLine {
  title: string;
  rate: string; // Formatted as percentage (e.g., "8.5%")
  price: Decimal;
}

export interface ShippingAddress {
  address1: string;
  address2: string;
  zip: string;
  city: string;
}

export interface OrderTransaction {
  kind: string; // "sale", "capture", "refund", etc.
  processedAt: string; // ISO timestamp
  amount: Decimal;
  gateway: string; // "shopify_payments", "cash", "gift_card", etc.
  paymentMethod?: string; // "visa", "mastercard", etc. (from payment_details)
}

export interface PaymentBreakdown {
  cash: Decimal;
  charge: Decimal; // Travel Give Aways (Charge gateway)
  giftCard: Decimal;
  storeCredit: Decimal;
  check: Decimal;
  card: Decimal; // shopify_payments with card
}

/**
 * Fetch transactions for an order from Shopify Admin API
 *
 * Note: The /orders/{id}.json endpoint does NOT include transactions by default.
 * We must fetch them separately from /orders/{id}/transactions.json
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderId - Order ID to fetch transactions for
 * @returns Array of transactions or empty array if none found
 */
async function fetchTransactionsForEnrichment(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<any[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions.json`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`No transactions found for order ${orderId}`);
        return [];
      }
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch transactions for order ${orderId}: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    return data.transactions || [];
  } catch (error) {
    console.error(`Error fetching transactions for order ${orderId}:`, error);
    // Return empty array rather than throwing - we can still enrich other fields
    return [];
  }
}

/**
 * Enrich order data with additional fields for Daily Sales Report
 *
 * Fetches from Shopify Admin API:
 * - order.tags
 * - order.transactions (fetched separately via transactions endpoint)
 * - order.tax_lines
 * - order.shipping_address
 * - order.fulfillment_status
 * - order.financial_status
 * - order.total_shipping_price_set
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderId - Order ID to enrich
 * @returns Enriched order data or null if order not found
 */
export async function enrichOrderData(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<EnrichedOrderData | null> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}.json`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Order ${orderId} not found for enrichment`);
        return null;
      }
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch order for enrichment: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();

    if (!data.order) {
      return null;
    }

    const orderData = data.order;

    // Fetch transactions separately
    // NOTE: The /orders/{id}.json endpoint does NOT include transactions!
    // We must fetch them from /orders/{id}/transactions.json
    const transactionData = await fetchTransactionsForEnrichment(shop, accessToken, orderId);

    // Extract tags
    const tags = orderData.tags || '';

    // Parse tax lines (up to 3)
    const taxLines = parseTaxBreakdown(orderData.tax_lines || []);

    // Extract shipping address
    const shippingAddress = parseShippingAddress(orderData.shipping_address);

    // Parse transactions (from separate fetch, NOT from orderData)
    const transactions = parseTransactions(transactionData);

    // Calculate payment breakdown (now has actual transaction data!)
    const paymentBreakdown = calculatePaymentBreakdown(transactions);

    // Extract status fields
    const fulfillmentStatus = orderData.fulfillment_status || 'unfulfilled';
    const financialStatus = orderData.financial_status || 'pending';

    // Extract shipping price
    const totalShippingPrice = new Decimal(
      orderData.total_shipping_price_set?.shop_money?.amount ||
      orderData.total_shipping_price ||
      0
    );

    // Extract current total price (after edits/refunds)
    const currentTotalPrice = new Decimal(
      orderData.current_total_price ||
      orderData.total_price ||
      0
    );

    // Calculate total refunded
    const totalRefunded = new Decimal(
      orderData.total_refunded ||
      0
    );

    return {
      tags,
      taxLines,
      shippingAddress,
      transactions,
      paymentBreakdown,
      fulfillmentStatus,
      financialStatus,
      totalShippingPrice,
      currentTotalPrice,
      totalRefunded,
    };
  } catch (error) {
    console.error(`Error enriching order ${orderId}:`, error);
    throw error;
  }
}

/**
 * Parse tax breakdown from Shopify tax_lines
 * Returns up to 5 tax lines for display
 */
export function parseTaxBreakdown(taxLines: any[]): TaxLine[] {
  const parsed: TaxLine[] = [];

  // Take up to 5 tax lines
  const limitedTaxLines = taxLines.slice(0, 5);

  for (const taxLine of limitedTaxLines) {
    parsed.push({
      title: taxLine.title || 'Tax',
      rate: formatTaxRate(taxLine.rate),
      price: new Decimal(taxLine.price || 0),
    });
  }

  return parsed;
}

/**
 * Format tax rate as percentage string
 * Shopify provides rate as decimal (e.g., 0.085 for 8.5%)
 */
function formatTaxRate(rate: number | string): string {
  const rateNum = typeof rate === 'string' ? parseFloat(rate) : rate;
  const percentage = (rateNum * 100).toFixed(2);
  return `${percentage}%`;
}

/**
 * Parse shipping address from Shopify order
 */
function parseShippingAddress(address: any): ShippingAddress {
  if (!address) {
    return {
      address1: '',
      address2: '',
      zip: '',
      city: '',
    };
  }

  return {
    address1: address.address1 || '',
    address2: address.address2 || '',
    zip: address.zip || '',
    city: address.city || '',
  };
}

/**
 * Parse order transactions from Shopify
 * Includes both payment captures and refunds
 */
function parseTransactions(transactions: any[]): OrderTransaction[] {
  return transactions.map((txn) => ({
    kind: txn.kind || 'unknown',
    processedAt: txn.processed_at || txn.created_at || '',
    amount: new Decimal(txn.amount || 0),
    gateway: txn.gateway || 'unknown',
    paymentMethod: txn.payment_details?.credit_card_company?.toLowerCase() || undefined,
  }));
}

/**
 * Calculate payment breakdown from order transactions
 *
 * Maps gateway/payment_method to payment columns with GL accounts:
 * - "cash" gateway → CASH column (GL: 1051-00 - Cash on Hand)
 * - "shopify_payments" with card → card field (GL: 1061-00 - Shopify Payments)
 * - "Charge" gateway → CHARGE column (GL: 9999-00 placeholder - Travel Give Aways)
 * - "gift_card" gateway → GIFT CARD column (GL: 2320-00 - Gift Card Liability)
 * - "shopify_store_credit" gateway → STORE CREDIT column (GL: 2320-00 - Gift Card Liability)
 * - "check" gateway → CHECK column (GL: 1051-00 - Cash on Hand)
 *
 * Note: GL accounts are for reference only - this report shows payment method
 * distribution. The actual GL entries are in the Journal Entry Summary file.
 *
 * @param transactions - Array of order transactions
 * @returns Payment breakdown by method
 */
export function calculatePaymentBreakdown(transactions: OrderTransaction[]): PaymentBreakdown {
  const breakdown: PaymentBreakdown = {
    cash: new Decimal(0),
    charge: new Decimal(0),
    giftCard: new Decimal(0),
    storeCredit: new Decimal(0),
    check: new Decimal(0),
    card: new Decimal(0),
  };

  // Only consider successful captures/sales (not refunds, not authorizations)
  const captureTransactions = transactions.filter(
    (txn) => txn.kind === 'sale' || txn.kind === 'capture'
  );

  for (const txn of captureTransactions) {
    // Normalize gateway: lowercase and replace spaces with underscores
    // Shopify returns "gift card" but we need "gift_card" for matching
    const gateway = txn.gateway.toLowerCase().replace(/\s+/g, '_');

    if (gateway === 'cash') {
      breakdown.cash = breakdown.cash.plus(txn.amount);
    } else if (gateway === 'charge') {
      // Travel Give Aways - inventory write-offs
      breakdown.charge = breakdown.charge.plus(txn.amount);
    } else if (gateway === 'gift_card') {
      breakdown.giftCard = breakdown.giftCard.plus(txn.amount);
    } else if (gateway === 'shopify_store_credit') {
      breakdown.storeCredit = breakdown.storeCredit.plus(txn.amount);
    } else if (gateway === 'check') {
      breakdown.check = breakdown.check.plus(txn.amount);
    } else if (gateway === 'shopify_payments' && txn.paymentMethod) {
      // Card payment through Shopify Payments
      breakdown.card = breakdown.card.plus(txn.amount);
    } else if (gateway === 'shopify_payments') {
      // Fallback: Shopify Payments without payment_method (treat as card)
      breakdown.card = breakdown.card.plus(txn.amount);
    }
    // Note: Unknown gateways are silently ignored
    // Consider logging or adding to "other" category if needed
  }

  return breakdown;
}

/**
 * Determine the report date for an order
 *
 * Logic:
 * 1. Look at ALL transactions for the order
 * 2. Find the LATEST capture/sale date
 * 3. That's the order's report date
 *
 * For split payments, all amounts report on the latest capture date.
 *
 * @param transactions - Array of order transactions
 * @returns Latest capture date (YYYY-MM-DD) or empty string if no captures
 */
export function determineReportDate(transactions: OrderTransaction[]): string {
  // Filter to captures/sales only
  const captureTransactions = transactions.filter(
    (txn) => txn.kind === 'sale' || txn.kind === 'capture'
  );

  if (captureTransactions.length === 0) {
    return '';
  }

  // Find latest capture date
  let latestDate = '';
  let latestTimestamp = 0;

  for (const txn of captureTransactions) {
    const timestamp = new Date(txn.processedAt).getTime();
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestDate = txn.processedAt;
    }
  }

  // Format as YYYY-MM-DD
  if (latestDate) {
    const date = new Date(latestDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}
