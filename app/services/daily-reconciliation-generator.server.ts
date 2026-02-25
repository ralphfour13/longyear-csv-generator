import { Decimal } from 'decimal.js';
import type { EnrichedTransaction, Order, OrderLineItem } from '../types/journal-entry';

/**
 * Daily Reconciliation Report Row
 * Simple one-row-per-order format for quick verification
 */
interface DailyReconciliationRow {
  orderNumber: string;
  sales: string;
  tax: string;
  shipping: string;
  area: string;
  notes: string;
  tender: string;
  giftCardSold: string;
  giftCardUsed: string;
}

/**
 * Generate Daily Reconciliation Report CSV
 *
 * Simplified format for quick reconciliation:
 * - One row per order (not per transaction)
 * - Shows key financial data
 * - Highlights special conditions (fishing licenses, discounts, split payments)
 *
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @param targetDate - Target date for filtering (YYYY-MM-DD)
 * @returns CSV string
 */
export function generateDailyReconciliationReport(
  enrichedTransactions: EnrichedTransaction[],
  targetDate: string
): string {
  const rows: DailyReconciliationRow[] = [];

  // Group transactions by order
  const orderGroups = groupByOrder(enrichedTransactions);

  // Process each order (one row per order)
  for (const [orderId, transactions] of orderGroups.entries()) {
    if (transactions.length === 0 || !transactions[0].order) continue;

    const row = transformToReconciliationRow(transactions);
    if (row) {
      rows.push(row);
    }
  }

  // Sort by order number
  rows.sort((a, b) => {
    const aNum = parseInt(a.orderNumber.replace('#', ''));
    const bNum = parseInt(b.orderNumber.replace('#', ''));
    return aNum - bNum;
  });

  // Generate CSV
  return generateCSV(rows);
}

/**
 * Group enriched transactions by order ID
 */
function groupByOrder(
  enrichedTransactions: EnrichedTransaction[]
): Map<string, EnrichedTransaction[]> {
  const groups = new Map<string, EnrichedTransaction[]>();

  for (const txn of enrichedTransactions) {
    if (txn.order) {
      const orderId = txn.order.id;
      if (!groups.has(orderId)) {
        groups.set(orderId, []);
      }
      groups.get(orderId)!.push(txn);
    }
  }

  return groups;
}

/**
 * Transform order transactions to reconciliation row
 */
function transformToReconciliationRow(
  transactions: EnrichedTransaction[]
): DailyReconciliationRow | null {
  if (transactions.length === 0 || !transactions[0].order || !transactions[0].enrichedData) {
    return null;
  }

  const order = transactions[0].order;
  const enrichedData = transactions[0].enrichedData;

  // Determine if this is a refunded order
  const isRefunded =
    order.financialStatus === 'refunded' ||
    order.financialStatus === 'partially_refunded';

  // Calculate sales (use original subtotal for refunded orders)
  let sales: Decimal;
  if (isRefunded) {
    sales = order.subtotalPrice;
  } else if (order.currentSubtotalPrice) {
    sales = order.currentSubtotalPrice;
  } else {
    sales = order.totalPrice
      .minus(order.totalTax || new Decimal(0))
      .minus(order.totalShipping || new Decimal(0));
  }

  // Check if this is a refund row (negative sales)
  const hasRefundTransaction = transactions.some(
    (t) => t.balanceTransaction?.type === 'refund'
  );

  // For fully refunded orders, create two rows: original sale and refund
  const rows: DailyReconciliationRow[] = [];

  // Determine area (POS vs Canadian Catalog)
  const area = determineArea(order, enrichedData);

  // Determine tender (payment method)
  const tender = determineTender(enrichedData.paymentBreakdown);

  // Analyze notes (fishing licenses, discounts, split tender)
  const notes = generateNotes(order, enrichedData);

  // Check for gift cards
  const giftCardInfo = analyzeGiftCards(order, enrichedData.paymentBreakdown);

  // If refunded, create original sale row
  if (order.financialStatus === 'refunded') {
    rows.push({
      orderNumber: order.name,
      sales: sales.neg().toFixed(2), // Negative for refund
      tax: order.totalTax.neg().toFixed(2),
      shipping: order.totalShipping.gt(0) ? order.totalShipping.neg().toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });

    // Add back the original sale
    rows.push({
      orderNumber: order.name,
      sales: sales.toFixed(2),
      tax: order.totalTax.toFixed(2),
      shipping: order.totalShipping.gt(0) ? order.totalShipping.toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });
  } else {
    // Normal order
    rows.push({
      orderNumber: order.name,
      sales: sales.toFixed(2),
      tax: order.totalTax.toFixed(2),
      shipping: order.totalShipping.gt(0) ? order.totalShipping.toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });
  }

  // Return first row (caller will process all rows if needed)
  return rows[0];
}

/**
 * Determine order area (POS vs Canadian Catalog)
 */
function determineArea(order: Order, enrichedData: any): string {
  // Check tags for POS indicator
  const tags = enrichedData.tags?.toLowerCase() || '';
  if (tags.includes('pos') || tags.includes('point of sale')) {
    return 'pos';
  }

  // Check if order source indicates catalog
  // Canadian catalog orders typically have shipping to Canada
  const shippingCountry = enrichedData.shippingAddress?.country || '';
  if (shippingCountry === 'CA' || shippingCountry === 'Canada') {
    return 'ca cat';
  }

  // Default to POS if no clear indicator
  return 'pos';
}

/**
 * Determine tender (payment method)
 */
function determineTender(paymentBreakdown: any): string {
  if (!paymentBreakdown) return 'cc';

  // Check payment methods in priority order
  if (paymentBreakdown.cash && paymentBreakdown.cash.gt(0)) {
    return paymentBreakdown.cash.eq(paymentBreakdown.card) ? 'cash' : 'CASH';
  }

  if (paymentBreakdown.check && paymentBreakdown.check.gt(0)) {
    return 'check';
  }

  if (paymentBreakdown.giftCard && paymentBreakdown.giftCard.gt(0)) {
    return 'gift card';
  }

  if (paymentBreakdown.storeCredit && paymentBreakdown.storeCredit.gt(0)) {
    return 'store credit';
  }

  // Default to credit card
  return 'cc';
}

/**
 * Generate notes for special conditions
 */
function generateNotes(order: Order, enrichedData: any): string {
  const notes: string[] = [];

  // Check for fishing licenses in line items
  const fishingLicenses = order.lineItems.filter((item: OrderLineItem) =>
    item.title?.toLowerCase().includes('fishing') ||
    item.title?.toLowerCase().includes('license')
  );

  if (fishingLicenses.length > 0) {
    const totalLicenses = fishingLicenses.reduce(
      (sum: Decimal, item: OrderLineItem) =>
        sum.plus(item.price.times(item.quantity)),
      new Decimal(0)
    );
    notes.push(`${totalLicenses.toFixed(2)} fishing licenses`);
  }

  // Check for discounts
  if (order.totalDiscounts && order.totalDiscounts.gt(0)) {
    notes.push(`discount ${order.totalDiscounts.toFixed(2)}`);
  }

  // Check for split payment (multiple payment methods)
  const paymentBreakdown = enrichedData.paymentBreakdown;
  const paymentMethods = [
    paymentBreakdown.cash,
    paymentBreakdown.card,
    paymentBreakdown.giftCard,
    paymentBreakdown.storeCredit,
    paymentBreakdown.check,
  ].filter((amount: Decimal) => amount && amount.gt(0));

  if (paymentMethods.length > 1) {
    // Find the smaller payment amount for split tender note
    const amounts = paymentMethods.map((d: Decimal) => d.toNumber()).sort((a: number, b: number) => a - b);
    notes.push(`split tender ${amounts[0].toFixed(2)}`);
  }

  return notes.join(', ');
}

/**
 * Analyze gift card usage
 */
function analyzeGiftCards(order: Order, paymentBreakdown: any): { sold: string; used: string } {
  let sold = '';
  let used = '';

  // Check if gift cards were purchased (in line items)
  const giftCardItems = order.lineItems.filter((item: OrderLineItem) =>
    item.title?.toLowerCase().includes('gift card') ||
    item.sku?.toLowerCase().includes('giftcard')
  );

  if (giftCardItems.length > 0) {
    const totalSold = giftCardItems.reduce(
      (sum: Decimal, item: OrderLineItem) =>
        sum.plus(item.price.times(item.quantity)),
      new Decimal(0)
    );
    sold = totalSold.toFixed(0); // No decimals for gift cards
  }

  // Check if gift cards were used as payment
  if (paymentBreakdown?.giftCard && paymentBreakdown.giftCard.gt(0)) {
    used = paymentBreakdown.giftCard.toFixed(0);
  }

  return { sold, used };
}

/**
 * Generate CSV string from rows
 */
function generateCSV(rows: DailyReconciliationRow[]): string {
  const lines: string[] = [];

  // Header row
  const headers = [
    '',
    'sales',
    'tax',
    'shipping',
    'area',
    'notes',
    'tender',
    'gift card sold',
    'gift card used',
  ];
  lines.push(headers.join('\t')); // Tab-separated for better alignment

  // Data rows
  for (const row of rows) {
    const fields = [
      row.orderNumber,
      row.sales,
      row.tax,
      row.shipping,
      row.area,
      row.notes,
      row.tender,
      row.giftCardSold,
      row.giftCardUsed,
    ];
    lines.push(fields.join('\t'));
  }

  return lines.join('\n');
}
