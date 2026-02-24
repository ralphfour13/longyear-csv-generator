import { Decimal } from 'decimal.js';
import type { Order, Transaction } from '../types/journal-entry';

/**
 * Order-Centric Fetcher Service
 *
 * Fetches orders directly by capture date, independent of payouts.
 * This enables capturing ALL payment methods including:
 * - Cash payments
 * - Gift card only payments
 * - Store credit payments
 * - Manual charges (Charge gateway)
 * - Split payments (full amounts)
 */

/**
 * Rate limiting utility - delays execution to stay under Shopify's 4 calls/second limit
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Retry configuration for API calls
 */
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 500; // Start with 500ms delay

/**
 * Fetch orders by capture date range using dual-query strategy
 *
 * Uses BOTH created_at and updated_at queries to ensure comprehensive coverage:
 * - Query 1 (created_at): Catches orders created near target date (uses full buffer)
 * - Query 2 (updated_at): Catches orders with recent updates/edits/refunds (tighter window)
 * - Results are combined and deduplicated by order ID
 *
 * This fixes edge cases like order #80819 where:
 * - Created: 2026-01-18 (Jan 18)
 * - Captured: 2026-01-18 (Jan 18)
 * - Updated: 2026-01-21 (Jan 21) - outside single-query window
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param startDate - Start date for created_at buffer (YYYY-MM-DD format, typically targetDate - 2 days)
 * @param endDate - End date for created_at buffer (YYYY-MM-DD format, typically targetDate + 2 days)
 * @returns Array of orders that had captures in this date range
 */
export async function fetchOrdersByCaptureDateRange(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Order[]> {
  const orderMap = new Map<string, Order>(); // Deduplicate by order ID
  const baseUrl = `https://${shop}/admin/api/2024-10/orders.json`;

  // Calculate the midpoint (target date) from the provided range
  const startTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();
  const midpointTime = (startTime + endTime) / 2;
  const midpointDate = new Date(midpointTime);
  const targetDateStr = midpointDate.toISOString().split('T')[0];

  // Query 1: created_at with full buffer (use provided range)
  const createdStartDateTime = `${startDate}T00:00:00Z`;
  const createdEndDateTime = `${endDate}T23:59:59Z`;

  // Query 2: updated_at with ±1 day from target (tighter window)
  const updatedStartDate = addDays(targetDateStr, -1);
  const updatedEndDate = addDays(targetDateStr, 1);
  const updatedStartDateTime = `${updatedStartDate}T00:00:00Z`;
  const updatedEndDateTime = `${updatedEndDate}T23:59:59Z`;

  console.log(`Fetching orders with activity between ${startDate} and ${endDate}`);

  // QUERY 1: Fetch by created_at (for orders created near target date)
  await fetchOrdersByDate(
    baseUrl,
    shop,
    accessToken,
    'created_at_min',
    'created_at_max',
    createdStartDateTime,
    createdEndDateTime,
    orderMap
  );

  // QUERY 2: Fetch by updated_at (for orders updated near target date)
  await fetchOrdersByDate(
    baseUrl,
    shop,
    accessToken,
    'updated_at_min',
    'updated_at_max',
    updatedStartDateTime,
    updatedEndDateTime,
    orderMap
  );

  const orders = Array.from(orderMap.values());
  console.log(`Fetched ${orders.length} total orders with activity in date range`);

  return orders;
}

/**
 * Helper function to fetch orders by a specific date parameter and add to map
 *
 * @param baseUrl - Base API URL
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param minParam - Minimum date parameter name (e.g., 'created_at_min')
 * @param maxParam - Maximum date parameter name (e.g., 'created_at_max')
 * @param startDateTime - Start datetime ISO string
 * @param endDateTime - End datetime ISO string
 * @param orderMap - Map to store orders (deduplicated by ID)
 */
async function fetchOrdersByDate(
  baseUrl: string,
  shop: string,
  accessToken: string,
  minParam: string,
  maxParam: string,
  startDateTime: string,
  endDateTime: string,
  orderMap: Map<string, Order>
): Promise<void> {
  let hasNextPage = true;
  let pageInfo: string | null = null;
  let fetchedCount = 0;

  while (hasNextPage) {
    // When using page_info for pagination, Shopify requires ONLY page_info parameter
    // No other query parameters (date filters, status, limit) can be included
    const params = pageInfo
      ? new URLSearchParams({ page_info: pageInfo })
      : new URLSearchParams({
          [minParam]: startDateTime,
          [maxParam]: endDateTime,
          status: 'any',
          limit: '250',
        });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch orders: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.orders && Array.isArray(data.orders)) {
        // Fetch transactions for each order and add to map (deduplicate)
        for (let i = 0; i < data.orders.length; i++) {
          const orderData = data.orders[i];

          // Skip if already in map (deduplicate)
          if (orderMap.has(orderData.id.toString())) {
            continue;
          }

          const order = await parseOrderWithTransactions(
            shop,
            accessToken,
            orderData
          );

          orderMap.set(order.id, order);
          fetchedCount++;

          // Rate limiting: Wait 250ms between calls
          if (i < data.orders.length - 1) {
            await sleep(250);
          }
        }

        // Check for pagination
        const linkHeader = response.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const match = linkHeader.match(/page_info=([^&>]+)/);
          if (match) {
            pageInfo = match[1];
          } else {
            hasNextPage = false;
          }
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error(`Error fetching orders by ${minParam}:`, error);
      throw error;
    }
  }

  // Only log if we actually fetched new orders (not duplicates)
  if (fetchedCount > 0) {
    console.log(`  + ${fetchedCount} orders from ${minParam.replace('_min', '')} query`);
  }
}

/**
 * Parse order and fetch its transactions
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderData - Raw order data from Shopify API
 * @returns Parsed order with transactions included
 */
async function parseOrderWithTransactions(
  shop: string,
  accessToken: string,
  orderData: any
): Promise<Order> {
  // Parse basic order data
  const order = parseOrder(orderData);

  // Fetch transactions for this order
  const transactions = await fetchOrderTransactions(shop, accessToken, order.id);
  order.transactions = transactions;

  return order;
}

/**
 * Parse Shopify order API response into our Order type
 */
function parseOrder(orderData: any): Order {
  // Parse line items
  const lineItems = (orderData.line_items || []).map((item: any) => ({
    id: item.id.toString(),
    productId: item.product_id?.toString() || '',
    variantId: item.variant_id?.toString() || '',
    title: item.title,
    quantity: item.quantity,
    price: new Decimal(item.price),
    totalDiscount: new Decimal(item.total_discount || 0),
    taxable: item.taxable,
    taxes: (item.tax_lines || []).map((tax: any) => ({
      title: tax.title,
      rate: parseFloat(tax.rate),
      price: new Decimal(tax.price),
    })),
  }));

  // Calculate shipping total
  const shippingLines = orderData.shipping_lines || [];
  const totalShipping = shippingLines.reduce(
    (sum: Decimal, line: any) => sum.plus(new Decimal(line.price || 0)),
    new Decimal(0)
  );

  return {
    id: orderData.id.toString(),
    orderNumber: orderData.order_number,
    name: orderData.name,
    createdAt: orderData.created_at,
    totalPrice: new Decimal(orderData.total_price),
    subtotalPrice: new Decimal(orderData.subtotal_price),
    currentSubtotalPrice: orderData.current_subtotal_price
      ? new Decimal(orderData.current_subtotal_price)
      : undefined,
    currentTotalDiscounts: orderData.current_total_discounts
      ? new Decimal(orderData.current_total_discounts)
      : undefined,
    currentTotalPrice: orderData.current_total_price
      ? new Decimal(orderData.current_total_price)
      : undefined,
    totalTax: new Decimal(orderData.total_tax || 0),
    totalShipping,
    totalDiscounts: new Decimal(orderData.total_discounts || 0),
    currency: orderData.currency,
    financialStatus: orderData.financial_status,
    lineItems,
    transactions: [], // Will be populated separately
  };
}

/**
 * Fetch transactions for a specific order with retry logic
 */
async function fetchOrderTransactions(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<Transaction[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions.json`;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      // Handle 429 rate limit errors with retry
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          // Calculate exponential backoff delay: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `Rate limit hit for order ${orderId}. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
          );
          await sleep(delay);
          continue; // Retry the request
        } else {
          const errorText = await response.text();
          throw new Error(
            `Failed to fetch transactions after ${MAX_RETRIES} retries: ${response.status} ${response.statusText} - ${errorText}`
          );
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch transactions: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.transactions && Array.isArray(data.transactions)) {
        return data.transactions.map((txn: any) => parseTransaction(txn));
      }

      return [];
    } catch (error) {
      // If this is the last attempt or not a retryable error, throw
      if (attempt === MAX_RETRIES || !(error instanceof Error) || !error.message.includes('429')) {
        console.error(`Error fetching transactions for order ${orderId}:`, error);
        throw error;
      }
      // For network errors on early attempts, retry with backoff
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      console.log(
        `Error fetching transactions for order ${orderId}. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
      );
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs a return
  return [];
}

/**
 * Parse transaction data from Shopify API
 */
function parseTransaction(txnData: any): Transaction {
  const fees = parseFees(txnData);

  return {
    id: txnData.id.toString(),
    orderId: txnData.order_id?.toString() || '',
    kind: txnData.kind,
    gateway: txnData.gateway,
    status: txnData.status,
    amount: new Decimal(txnData.amount),
    currency: txnData.currency,
    processedAt: txnData.processed_at,
    fees,
  };
}

/**
 * Parse fee details from transaction
 */
function parseFees(txnData: any): any[] {
  const fees: any[] = [];

  if (txnData.receipt && typeof txnData.receipt === 'object') {
    const receipt = txnData.receipt;

    if (receipt.shopify_fee) {
      fees.push({
        type: 'shopify_fee',
        amount: new Decimal(receipt.shopify_fee),
        currency: txnData.currency,
      });
    }

    if (receipt.processing_fee || receipt.gateway_fee) {
      fees.push({
        type: 'gateway_fee',
        amount: new Decimal(receipt.processing_fee || receipt.gateway_fee),
        currency: txnData.currency,
      });
    }

    if (receipt.chargeback_fee) {
      fees.push({
        type: 'chargeback_fee',
        amount: new Decimal(receipt.chargeback_fee),
        currency: txnData.currency,
      });
    }
  }

  if (txnData.payment_details && typeof txnData.payment_details === 'object') {
    const details = txnData.payment_details;

    if (details.shopify_payments_fee) {
      fees.push({
        type: 'shopify_fee',
        amount: new Decimal(details.shopify_payments_fee),
        currency: txnData.currency,
      });
    }

    if (details.gateway_fee) {
      fees.push({
        type: 'gateway_fee',
        amount: new Decimal(details.gateway_fee),
        currency: txnData.currency,
      });
    }
  }

  return fees;
}

/**
 * Filter order transactions by capture/sale date
 *
 * Returns only transactions where kind = 'capture' or 'sale'
 * AND processedAt date matches targetDate
 *
 * @param order - Order with transactions
 * @param targetDate - Target date (YYYY-MM-DD format)
 * @returns Array of capture transactions matching the target date
 */
export function filterOrderTransactionsByDate(
  order: Order,
  targetDate: string
): Transaction[] {
  if (!order.transactions || order.transactions.length === 0) {
    return [];
  }

  return order.transactions.filter((txn) => {
    // Only include capture or sale transactions
    if (txn.kind !== 'capture' && txn.kind !== 'sale') {
      return false;
    }

    // Only include successful transactions
    if (txn.status !== 'success') {
      return false;
    }

    // Check if processedAt date matches target date
    const txnDate = formatDateOnly(txn.processedAt);
    return txnDate === targetDate;
  });
}

/**
 * Get the capture date for an order (latest capture/sale transaction date)
 *
 * @param order - Order with transactions
 * @returns Latest capture date (YYYY-MM-DD format) or null if no captures
 */
export function getOrderCaptureDate(order: Order): string | null {
  if (!order.transactions || order.transactions.length === 0) {
    return null;
  }

  // Find all successful capture/sale transactions
  const captureTransactions = order.transactions.filter(
    (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
  );

  if (captureTransactions.length === 0) {
    return null;
  }

  // Get the latest capture date
  const latestCapture = captureTransactions.reduce((latest, txn) => {
    const txnDate = new Date(txn.processedAt);
    const latestDate = new Date(latest.processedAt);
    return txnDate > latestDate ? txn : latest;
  });

  const captureDate = formatDateOnly(latestCapture.processedAt);

  return captureDate;
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
