import { Decimal } from 'decimal.js';

/**
 * Uncaptured Authorization Report
 *
 * Finds orders with CC authorizations that were never captured.
 * These represent revenue that was authorized but never collected,
 * typically from split-tender orders (gift card + credit card).
 *
 * Performance strategy:
 * 1. Fetch all orders since start date (paginated, no transaction calls)
 * 2. Pre-filter to orders with multiple payment gateways (split-tender candidates)
 * 3. Only fetch transactions for the filtered subset
 * 4. Check each for auth-without-capture pattern
 */

export interface UncapturedAuthOrder {
  name: string;
  id: string;
  createdAt: string;
  orderTotal: string;
  uncapturedAmount: string;
  capturedAmount: string;
  gateway: string;
  financialStatus: string;
  paymentMethods: string;
  adminUrl: string;
}

export interface UncapturedAuthReport {
  orders: UncapturedAuthOrder[];
  totalUncaptured: string;
  totalCaptured: string;
  orderCount: number;
  sinceDate: string;
  totalOrdersScanned: number;
  splitTenderCandidates: number;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  accessToken: string
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
        console.log(`[UncapturedAuth] Rate limited. Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
    }

    if (response.ok) return response;

    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  throw new Error('Failed after all retry attempts');
}

interface OrderSummary {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: string;
  financialStatus: string;
  paymentGatewayNames: string[];
}

/**
 * Fetch all orders since a start date (lightweight — no transaction calls)
 */
async function fetchOrdersSince(
  shop: string,
  accessToken: string,
  sinceDate: string
): Promise<OrderSummary[]> {
  const baseUrl = `https://${shop}/admin/api/2024-10/orders.json`;
  const orders: OrderSummary[] = [];
  let hasNextPage = true;
  let pageInfo: string | null = null;

  while (hasNextPage) {
    const params: URLSearchParams = pageInfo
      ? new URLSearchParams({ page_info: pageInfo })
      : new URLSearchParams({
          created_at_min: `${sinceDate}T00:00:00Z`,
          status: 'any',
          limit: '250',
          fields: 'id,name,created_at,total_price,financial_status,payment_gateway_names',
        });

    const url = `${baseUrl}?${params.toString()}`;
    const response = await fetchWithRetry(url, accessToken);
    const data = await response.json();

    if (data.orders && Array.isArray(data.orders)) {
      for (const o of data.orders) {
        orders.push({
          id: o.id.toString(),
          name: o.name,
          createdAt: o.created_at,
          totalPrice: o.total_price,
          financialStatus: o.financial_status,
          paymentGatewayNames: o.payment_gateway_names || [],
        });
      }
    }

    // Pagination
    const linkHeader = response.headers.get('Link');
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      const nextUrl = nextMatch ? nextMatch[1] : null;
      const match = nextUrl ? nextUrl.match(/page_info=([^&>]+)/) : null;
      if (match) {
        pageInfo = match[1];
        await sleep(500);
      } else {
        hasNextPage = false;
      }
    } else {
      hasNextPage = false;
    }
  }

  return orders;
}

interface TransactionData {
  kind: string;
  gateway: string;
  amount: string;
  status: string;
}

/**
 * Fetch transactions for a single order
 */
async function fetchTransactions(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<TransactionData[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions.json`;
  const response = await fetchWithRetry(url, accessToken);
  const data = await response.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.transactions || []).map((t: any) => ({
    kind: t.kind,
    gateway: t.gateway,
    amount: t.amount,
    status: t.status,
  }));
}

/**
 * Check if an order has uncaptured CC authorizations
 */
function findUncapturedAuths(
  transactions: TransactionData[]
): Array<{ gateway: string; amount: string }> {
  return transactions
    .filter(txn => {
      if (txn.kind !== 'authorization' || txn.status !== 'success') return false;
      const hasCapture = transactions.some(
        t => (t.kind === 'capture' || t.kind === 'sale') &&
             t.status === 'success' && t.gateway === txn.gateway
      );
      return !hasCapture;
    })
    .map(txn => ({ gateway: txn.gateway, amount: txn.amount }));
}

/**
 * Calculate total captured amount from transactions
 */
function calculateCapturedAmount(transactions: TransactionData[]): Decimal {
  return transactions
    .filter(t => (t.kind === 'capture' || t.kind === 'sale') && t.status === 'success')
    .reduce((sum, t) => sum.plus(new Decimal(t.amount)), new Decimal(0));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProgressCallback = (progress: Record<string, any>) => Promise<void>;

/**
 * Generate the uncaptured authorization report
 */
export async function generateUncapturedAuthReport(
  shop: string,
  accessToken: string,
  sinceDate: string,
  onProgress?: ProgressCallback,
): Promise<UncapturedAuthReport> {
  console.log(`[UncapturedAuth] Fetching orders since ${sinceDate}...`);

  // Step 1: Fetch all orders (lightweight, no transactions)
  const allOrders = await fetchOrdersSince(shop, accessToken, sinceDate);
  console.log(`[UncapturedAuth] Found ${allOrders.length} total orders since ${sinceDate}`);

  if (onProgress) {
    await onProgress({
      phase: 'fetching',
      phaseLabel: 'Filtering orders',
      currentActivity: `Found ${allOrders.length} orders. Filtering split-tender candidates...`,
      overallPercentage: 45,
    });
  }

  // Step 2: Pre-filter to split-tender candidates
  // Orders with multiple payment gateways are candidates for uncaptured auths
  const candidates = allOrders.filter(o => {
    const gateways = o.paymentGatewayNames;
    if (gateways.length < 2) return false;
    // Must have a CC gateway (shopify_payments) plus at least one other
    return gateways.some(g => g === 'shopify_payments');
  });
  console.log(`[UncapturedAuth] ${candidates.length} split-tender candidates to check`);

  if (onProgress) {
    await onProgress({
      phase: 'reconciling',
      phaseLabel: 'Analyzing transactions',
      currentActivity: `Checking ${candidates.length} split-tender candidates...`,
      ordersFound: candidates.length,
      ordersProcessed: 0,
      overallPercentage: 50,
    });
  }

  // Step 3: Fetch transactions for candidates and check for uncaptured auths
  const results: UncapturedAuthOrder[] = [];
  let totalUncaptured = new Decimal(0);
  let totalCaptured = new Decimal(0);

  for (let i = 0; i < candidates.length; i++) {
    const order = candidates[i];

    if (i > 0 && i % 50 === 0) {
      console.log(`[UncapturedAuth] Checked ${i}/${candidates.length} candidates, found ${results.length} so far`);
    }

    if (onProgress) {
      const pct = 50 + Math.round((i / candidates.length) * 49);
      await onProgress({
        phase: 'reconciling',
        phaseLabel: 'Analyzing transactions',
        currentActivity: `Checking candidate ${i + 1} of ${candidates.length}...`,
        ordersFound: candidates.length,
        ordersProcessed: i,
        overallPercentage: pct,
      });
    }

    const transactions = await fetchTransactions(shop, accessToken, order.id);
    await sleep(250); // Rate limiting

    const uncaptured = findUncapturedAuths(transactions);
    if (uncaptured.length === 0) continue;

    const uncapturedTotal = uncaptured.reduce(
      (sum, u) => sum.plus(new Decimal(u.amount)), new Decimal(0)
    );
    const capturedAmount = calculateCapturedAmount(transactions);

    totalUncaptured = totalUncaptured.plus(uncapturedTotal);
    totalCaptured = totalCaptured.plus(capturedAmount);

    results.push({
      name: order.name,
      id: order.id,
      createdAt: order.createdAt,
      orderTotal: order.totalPrice,
      uncapturedAmount: uncapturedTotal.toFixed(2),
      capturedAmount: capturedAmount.toFixed(2),
      gateway: uncaptured.map(u => u.gateway).join(', '),
      financialStatus: order.financialStatus,
      paymentMethods: order.paymentGatewayNames.join(' + '),
      adminUrl: `https://${shop}/admin/orders/${order.id}`,
    });
  }

  console.log(`[UncapturedAuth] Complete: ${results.length} orders with $${totalUncaptured.toFixed(2)} uncaptured`);

  return {
    orders: results.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    totalUncaptured: totalUncaptured.toFixed(2),
    totalCaptured: totalCaptured.toFixed(2),
    orderCount: results.length,
    sinceDate,
    totalOrdersScanned: allOrders.length,
    splitTenderCandidates: candidates.length,
  };
}

/**
 * Convert report to CSV string
 */
export function reportToCsv(report: UncapturedAuthReport): string {
  const header = 'Order,Date,Order Total,Captured,Uncaptured,Gateway,Status,Payment Methods,Admin URL';
  const rows = report.orders.map(o =>
    `${o.name},${o.createdAt.split('T')[0]},${o.orderTotal},${o.capturedAmount},${o.uncapturedAmount},${o.gateway},${o.financialStatus},"${o.paymentMethods}",${o.adminUrl}`
  );
  const summary = `\nTotal Uncaptured:,$${report.totalUncaptured}\nAffected Orders:,${report.orderCount}\nOrders Scanned:,${report.totalOrdersScanned}\nSplit-Tender Candidates:,${report.splitTenderCandidates}`;

  return [header, ...rows, summary].join('\n');
}
