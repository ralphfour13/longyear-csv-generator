import { Decimal } from 'decimal.js';

// Retry configuration for rate limit handling
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 500; // 500ms → 1000ms → 2000ms → 4000ms → 8000ms

// Helper function for delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTransactionsForEnrichment(
  shop: string,
  accessToken: string,
  orderId: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions.json`;

  let response: Response | null = null;

  // Retry loop for handling rate limits
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      // Handle 429 rate limit errors with retry
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `Rate limit hit on transactions endpoint for order ${orderId}. ` +
            `Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
          );
          await sleep(delay);
          continue; // Retry the request
        } else {
          const errorText = await response.text();
          console.warn(
            `Failed to fetch transactions for order ${orderId} after ${MAX_RETRIES} retries. ` +
            `Returning empty array.`
          );
          return []; // Return empty array instead of throwing
        }
      }

      // Handle 404 as valid case (order has no transactions)
      if (response.status === 404) {
        console.warn(`No transactions found for order ${orderId}`);
        return [];
      }

      // If request succeeded, break out of retry loop
      if (response.ok) {
        const data = await response.json();
        return data.transactions || [];
      }

      // For other non-retriable errors, log and return empty array
      const errorText = await response.text();
      console.error(
        `Failed to fetch transactions for order ${orderId}: ` +
        `${response.status} ${response.statusText} - ${errorText}`
      );
      return []; // Return empty array rather than throwing

    } catch (error) {
      // If this is the last attempt, return empty array
      if (attempt === MAX_RETRIES) {
        console.error(`Error fetching transactions for order ${orderId}:`, error);
        return [];
      }

      // For network errors or other exceptions, retry with backoff
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      console.log(
        `Error fetching transactions for order ${orderId}. ` +
        `Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
      );
      await sleep(delay);
    }
  }

  // Fallback (should not reach here)
  return [];
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

  let response: Response | null = null;
  let orderData: any = null;

  // Retry loop for handling rate limits
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      // Handle 429 rate limit errors with retry
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `Rate limit hit on enrichment endpoint for order ${orderId}. ` +
            `Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
          );
          await sleep(delay);
          continue; // Retry the request
        } else {
          const errorText = await response.text();
          throw new Error(
            `Failed to enrich order ${orderId} after ${MAX_RETRIES} retries: ` +
            `${response.status} ${response.statusText} - ${errorText}`
          );
        }
      }

      // Handle 404 as valid case (order not found)
      if (response.status === 404) {
        console.warn(`Order ${orderId} not found for enrichment`);
        return null;
      }

      // If request succeeded, break out of retry loop
      if (response.ok) {
        const data = await response.json();
        if (!data.order) {
          return null;
        }
        orderData = data.order;
        break; // Success - exit retry loop
      }

      // For other non-retriable errors, throw immediately
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch order for enrichment: ` +
        `${response.status} ${response.statusText} - ${errorText}`
      );

    } catch (error) {
      // If this is the last attempt or not a retryable error, throw
      if (attempt === MAX_RETRIES ||
          !(error instanceof Error) ||
          !error.message.includes('429')) {
        console.error(`Error enriching order ${orderId}:`, error);
        throw error;
      }

      // For 429 errors on early attempts, retry with backoff
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      console.log(
        `Error enriching order ${orderId}. ` +
        `Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
      );
      await sleep(delay);
    }
  }

  // If we exhausted retries without success, throw error
  if (!orderData) {
    throw new Error(`Failed to enrich order ${orderId} after all retry attempts`);
  }

  // Fetch transactions separately (now with retry logic!)
  const transactionData = await fetchTransactionsForEnrichment(shop, accessToken, orderId);

  // Extract and parse order data (same as before)
  const tags = orderData.tags || '';
  const taxLines = parseTaxBreakdown(orderData.tax_lines || []);
  const shippingAddress = parseShippingAddress(orderData.shipping_address);
  const transactions = parseTransactions(transactionData);
  const paymentBreakdown = calculatePaymentBreakdown(transactions);
  const fulfillmentStatus = orderData.fulfillment_status || 'unfulfilled';
  const financialStatus = orderData.financial_status || 'pending';
  const totalShippingPrice = new Decimal(
    orderData.total_shipping_price_set?.shop_money?.amount ||
    orderData.total_shipping_price ||
    0
  );
  const currentTotalPrice = new Decimal(
    orderData.current_total_price ||
    orderData.total_price ||
    0
  );
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
}

/**
 * Parse tax breakdown from Shopify tax_lines
 * Returns up to 5 tax lines for display
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
