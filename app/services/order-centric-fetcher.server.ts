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
 * Fetch orders by capture date range
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param startDate - Start date (YYYY-MM-DD format)
 * @param endDate - End date (YYYY-MM-DD format)
 * @returns Array of orders that had captures in this date range
 */
export async function fetchOrdersByCaptureDateRange(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Order[]> {
  const orders: Order[] = [];
  let hasNextPage = true;
  let pageInfo: string | null = null;

  const baseUrl = `https://${shop}/admin/api/2024-10/orders.json`;

  // Convert YYYY-MM-DD to ISO 8601 with full day range
  // Using updated_at to ensure we catch all orders that might have been
  // processed, edited, or have transactions within our date range
  const startDateTime = `${startDate}T00:00:00Z`;
  const endDateTime = `${endDate}T23:59:59Z`;

  console.log(`Fetching orders with activity between ${startDateTime} and ${endDateTime}`);

  while (hasNextPage) {
    const params = new URLSearchParams({
      updated_at_min: startDateTime,
      updated_at_max: endDateTime,
      status: 'any', // Include all order statuses
      limit: '250',
    });

    if (pageInfo) {
      params.set('page_info', pageInfo);
    }

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
        // Fetch transactions for each order and parse
        for (const orderData of data.orders) {
          const order = await parseOrderWithTransactions(
            shop,
            accessToken,
            orderData
          );
          orders.push(order);
        }

        // Check for Link header for pagination
        const linkHeader = response.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          // Extract page_info from Link header
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
      console.error('Error fetching orders by capture date range:', error);
      throw error;
    }
  }

  console.log(`Fetched ${orders.length} total orders with activity in date range`);

  return orders;
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
 * Fetch transactions for a specific order
 */
async function fetchOrderTransactions(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<Transaction[]> {
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
    console.error(`Error fetching transactions for order ${orderId}:`, error);
    throw error;
  }
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

  return formatDateOnly(latestCapture.processedAt);
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
