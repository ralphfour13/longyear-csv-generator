import { Decimal } from 'decimal.js';
import type { EnrichedTransaction, OrderLineItem } from '../types/journal-entry';

/**
 * Daily Reconciliation Report Row
 * Simple one-row-per-order format for quick verification
 */
interface DailyReconciliationRow {
  orderNumber: string;
  originalSubtotal: string; // Subtotal before discounts
  discount: string; // Total discount amount
  netSubtotal: string; // Subtotal after discounts (what's used for sales)
  tax: string;
  shipping: string;
  area: string;
  notes: string;
  tender: string;
  // Payment breakdown columns (NEW)
  paymentCash: string;
  paymentCard: string;
  paymentGiftCard: string;
  paymentStoreCredit: string;
  paymentCheck: string;
  paymentOther: string;
  paymentTotal: string;
  // Gift card info
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
): string {
  const rows: DailyReconciliationRow[] = [];

  // Group transactions by order
  const orderGroups = groupByOrder(enrichedTransactions);

  // Process each order (one row per order, or two rows for refunded orders)
  for (const [, transactions] of orderGroups.entries()) {
    if (transactions.length === 0 || !transactions[0].order) continue;

    const orderRows = transformToReconciliationRow(transactions);
    rows.push(...orderRows);
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
 * Transform order transactions to reconciliation row(s)
 * Returns array to support multiple rows for refunded orders
 */
function transformToReconciliationRow(
  transactions: EnrichedTransaction[]
): DailyReconciliationRow[] {
  if (transactions.length === 0 || !transactions[0].order || !transactions[0].enrichedData) {
    return [];
  }

  const order = transactions[0].order;
  const enrichedData = transactions[0].enrichedData;

  // Calculate sales - Use ORIGINAL values for ACTUAL refunded orders, CURRENT for partial captures
  //
  // KEY DISTINCTION:
  // - PARTIAL CAPTURE: Items removed BEFORE payment → use currentSubtotalPrice
  //   (Customer never paid for removed items)
  // - CANCEL-TYPE REFUND: Items cancelled BEFORE payment → use currentSubtotalPrice
  //   (Same as partial capture - customer never paid for cancelled items)
  // - ACTUAL REFUND: Items returned AFTER payment → use subtotalPrice (original)
  //   (Customer DID pay, refund entry reverses it separately)
  //
  // This matches the journal entry logic for consistency
  // Use hasActualRefunds flag (calculated from refunds array with restock_type check)
  const orderHasActualRefunds = order.hasActualRefunds ?? false;
  const isPartialCapture = !orderHasActualRefunds &&
    order.currentSubtotalPrice !== undefined &&
    order.currentSubtotalPrice.lt(order.subtotalPrice);

  let sales: Decimal;
  if (isPartialCapture && order.currentSubtotalPrice !== undefined) {
    sales = order.currentSubtotalPrice;
  } else {
    sales = order.subtotalPrice;
  }

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

  // Calculate discount information for transparency
  const originalSubtotal = order.subtotalPrice;
  const discount = order.totalDiscounts || new Decimal(0);
  const netSubtotal = sales; // Already calculated as NET above

  // Calculate payment breakdown
  const paymentBreakdown = enrichedData.paymentBreakdown;
  const paymentTotal = Object.values(paymentBreakdown).reduce(
    (sum, amount) => sum.plus(amount),
    new Decimal(0)
  );

  // Calculate tax - use original for ACTUAL refunded orders, current for partial captures
  // This matches the journal entry logic for consistency
  //
  // KEY DISTINCTION:
  // - PARTIAL CAPTURE / CANCEL-TYPE: Items removed BEFORE payment → use currentTotalTax
  //   (Customer never paid for removed items)
  // - ACTUAL REFUND: Items returned AFTER payment → use totalTax (original)
  //   (Customer DID pay, refund entry reverses it separately)
  const taxAmount = isPartialCapture
    ? (order.currentTotalTax ?? order.totalTax ?? new Decimal(0))
    : (order.totalTax ?? new Decimal(0));

  // If refunded, create original sale row
  if (order.financialStatus === 'refunded') {
    rows.push({
      orderNumber: order.name,
      originalSubtotal: originalSubtotal.neg().toFixed(2),
      discount: discount.neg().toFixed(2),
      netSubtotal: netSubtotal.neg().toFixed(2), // Negative for refund
      tax: taxAmount.neg().toFixed(2),
      shipping: (order.totalShipping && order.totalShipping.gt(0)) ? order.totalShipping.neg().toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      paymentCash: paymentBreakdown.cash.neg().toFixed(2),
      paymentCard: paymentBreakdown.card.neg().toFixed(2),
      paymentGiftCard: paymentBreakdown.giftCard.neg().toFixed(2),
      paymentStoreCredit: paymentBreakdown.storeCredit.neg().toFixed(2),
      paymentCheck: paymentBreakdown.check.neg().toFixed(2),
      paymentOther: paymentBreakdown.charge.neg().toFixed(2),
      paymentTotal: paymentTotal.neg().toFixed(2),
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });

    // Add back the original sale
    rows.push({
      orderNumber: order.name,
      originalSubtotal: originalSubtotal.toFixed(2),
      discount: discount.toFixed(2),
      netSubtotal: netSubtotal.toFixed(2),
      tax: taxAmount.toFixed(2),
      shipping: (order.totalShipping && order.totalShipping.gt(0)) ? order.totalShipping.toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      paymentCash: paymentBreakdown.cash.toFixed(2),
      paymentCard: paymentBreakdown.card.toFixed(2),
      paymentGiftCard: paymentBreakdown.giftCard.toFixed(2),
      paymentStoreCredit: paymentBreakdown.storeCredit.toFixed(2),
      paymentCheck: paymentBreakdown.check.toFixed(2),
      paymentOther: paymentBreakdown.charge.toFixed(2),
      paymentTotal: paymentTotal.toFixed(2),
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });
  } else {
    // Normal order or partial capture
    rows.push({
      orderNumber: order.name,
      originalSubtotal: originalSubtotal.toFixed(2),
      discount: discount.toFixed(2),
      netSubtotal: netSubtotal.toFixed(2),
      tax: taxAmount.toFixed(2),
      shipping: (order.totalShipping && order.totalShipping.gt(0)) ? order.totalShipping.toFixed(2) : '',
      area,
      notes: notes || '',
      tender,
      paymentCash: paymentBreakdown.cash.toFixed(2),
      paymentCard: paymentBreakdown.card.toFixed(2),
      paymentGiftCard: paymentBreakdown.giftCard.toFixed(2),
      paymentStoreCredit: paymentBreakdown.storeCredit.toFixed(2),
      paymentCheck: paymentBreakdown.check.toFixed(2),
      paymentOther: paymentBreakdown.charge.toFixed(2),
      paymentTotal: paymentTotal.toFixed(2),
      giftCardSold: giftCardInfo.sold,
      giftCardUsed: giftCardInfo.used,
    });
  }

  // Return all rows (1 for normal orders, 2 for refunded orders)
  return rows;
}

/**
 * Determine order area (POS vs Canadian Catalog)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determineArea(order: any, enrichedData: any): string {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateNotes(order: any, enrichedData: any): string {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function analyzeGiftCards(order: any, paymentBreakdown: any): { sold: string; used: string } {
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
 * Escape a field for CSV format
 * Wraps fields containing commas, quotes, or newlines in double quotes
 * Escapes internal quotes by doubling them
 */
function escapeCSVField(field: string): string {
  if (!field) return '';

  // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }

  return field;
}

/**
 * Generate CSV string from rows
 */
function generateCSV(rows: DailyReconciliationRow[]): string {
  const lines: string[] = [];

  // Header row - includes discount transparency and payment breakdown columns
  const headers = [
    '',
    'original subtotal',
    'discount',
    'net subtotal',
    'tax',
    'shipping',
    'area',
    'notes',
    'tender',
    // Payment breakdown columns (NEW)
    'payment cash',
    'payment card',
    'payment gift card',
    'payment store credit',
    'payment check',
    'payment other',
    'payment total',
    // Gift card info
    'gift card sold',
    'gift card used',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.orderNumber,
      row.originalSubtotal,
      row.discount,
      row.netSubtotal,
      row.tax,
      row.shipping,
      row.area,
      row.notes,
      row.tender,
      // Payment breakdown (NEW)
      row.paymentCash,
      row.paymentCard,
      row.paymentGiftCard,
      row.paymentStoreCredit,
      row.paymentCheck,
      row.paymentOther,
      row.paymentTotal,
      // Gift card info
      row.giftCardSold,
      row.giftCardUsed,
    ];
    lines.push(fields.map(escapeCSVField).join(','));
  }

  // Calculate summary totals
  const totalOriginalSubtotal = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.originalSubtotal || 0)),
    new Decimal(0)
  );
  const totalDiscount = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.discount || 0)),
    new Decimal(0)
  );
  const totalNetSubtotal = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.netSubtotal || 0)),
    new Decimal(0)
  );
  const totalTax = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.tax || 0)),
    new Decimal(0)
  );
  const totalShipping = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.shipping || 0)),
    new Decimal(0)
  );

  // Add summary row
  const summaryFields = [
    `SUMMARY (${rows.length} orders)`,
    totalOriginalSubtotal.toFixed(2),
    totalDiscount.toFixed(2),
    totalNetSubtotal.toFixed(2),
    totalTax.toFixed(2),
    totalShipping.toFixed(2),
    '', // area
    '', // notes
    '', // tender
    '', // gift card sold
    '', // gift card used
  ];
  lines.push(summaryFields.map(escapeCSVField).join(','));

  return lines.join('\n');
}
