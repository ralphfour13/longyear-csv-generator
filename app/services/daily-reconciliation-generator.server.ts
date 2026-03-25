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
  if (transactions.length === 0 || !transactions[0].order) {
    return [];
  }

  const order = transactions[0].order;
  const enrichedData = transactions[0].enrichedData;

  // Handle missing enrichedData (enrichment failure resilience)
  // Derive defaults from order data so the order still appears in reports
  const effectiveEnrichedData = enrichedData || {
    tags: '',
    shippingAddress: { country: '' },
    paymentBreakdown: {
      cash: new Decimal(0),
      card: new Decimal(0),
      giftCard: new Decimal(0),
      storeCredit: new Decimal(0),
      check: new Decimal(0),
      charge: new Decimal(0),
    },
  };

  // REFUND-ONLY CHECK: If all transactions are refunds (no charges posted on this date),
  // show only the refund amounts, not the full original order.
  // This handles orders like #80504, #80549 where the original sale was on a prior date
  // and only a refund posted on the target date.
  const hasChargeOnDate = transactions.some(t => t.balanceTransaction.type === 'charge');
  const hasRefundOnDate = transactions.some(t => t.balanceTransaction.type === 'refund');
  const isRefundOnlyOnDate = !hasChargeOnDate && hasRefundOnDate;

  if (isRefundOnlyOnDate) {
    const area = determineArea(order, effectiveEnrichedData);
    const tender = determineTender(effectiveEnrichedData.paymentBreakdown);
    const zeroDec = new Decimal(0).toFixed(2);

    // USE JE SUMMARY for refund-only rows to match JE exactly (split sales vs tax)
    const refundJe = transactions.find(t => t.jeSummary)?.jeSummary;
    console.log(`📊 DR ${order.name} (refund-only): jeSummary=${refundJe ? 'present' : 'MISSING'}, txns=${transactions.length}`);
    const refundSales = refundJe ? refundJe.netSales : (() => {
      const total = transactions
        .filter(t => t.balanceTransaction.type === 'refund')
        .reduce((sum, t) => sum.plus(t.balanceTransaction.net), new Decimal(0));
      return total.neg();
    })();
    const refundTax = refundJe ? refundJe.tax : new Decimal(0);
    const refundShipping = refundJe ? refundJe.shipping : new Decimal(0);
    const refundTotal = refundJe ? refundJe.totalPayment : refundSales;

    return [{
      orderNumber: order.name,
      originalSubtotal: '',
      discount: '',
      netSubtotal: refundSales.toFixed(2),
      tax: refundTax.isZero() ? '' : refundTax.toFixed(2),
      shipping: refundShipping.isZero() ? '' : refundShipping.toFixed(2),
      area,
      notes: 'refund only',
      tender,
      paymentCash: (tender === 'CASH' || tender === 'cash') ? refundTotal.toFixed(2) : zeroDec,
      paymentCard: tender === 'cc' ? refundTotal.toFixed(2) : zeroDec,
      paymentGiftCard: tender === 'gift card' ? refundTotal.toFixed(2) : zeroDec,
      paymentStoreCredit: tender === 'store credit' ? refundTotal.toFixed(2) : zeroDec,
      paymentCheck: tender === 'check' ? refundTotal.toFixed(2) : zeroDec,
      paymentOther: tender === 'charge' ? refundTotal.toFixed(2) : zeroDec,
      paymentTotal: refundTotal.toFixed(2),
      giftCardSold: '',
      giftCardUsed: '',
    }];
  }

  // Determine if this order has actual refunds (money returned AFTER payment)
  // vs partial capture (items removed BEFORE payment)
  // This flag is already set in the reconciler
  const orderHasActualRefunds = order.hasActualRefunds || false;

  // Check if totals are reduced (for partial capture detection)
  const hasReducedSubtotal = order.currentSubtotalPrice !== undefined &&
    order.currentSubtotalPrice.lt(order.subtotalPrice);

  // Calculate sales - use original subtotalPrice for orders with actual refunds
  // Only use currentSubtotalPrice for partial captures (items removed BEFORE payment)
  const useCurrentAmounts = hasReducedSubtotal && !orderHasActualRefunds;
  const sales = (useCurrentAmounts && order.currentSubtotalPrice !== undefined)
    ? order.currentSubtotalPrice
    : order.subtotalPrice;

  // For fully refunded orders, create two rows: original sale and refund
  const rows: DailyReconciliationRow[] = [];

  // Determine area (POS vs Canadian Catalog)
  const area = determineArea(order, effectiveEnrichedData);

  // Determine tender (payment method)
  const tender = determineTender(effectiveEnrichedData.paymentBreakdown);

  // Analyze notes (fishing licenses, discounts, split tender)
  const notes = generateNotes(order, effectiveEnrichedData);

  // Check for gift cards
  const giftCardInfo = analyzeGiftCards(order, effectiveEnrichedData.paymentBreakdown);

  // Calculate discount information for transparency
  const originalSubtotal = order.subtotalPrice;
  const discount = order.totalDiscounts || new Decimal(0);

  // Calculate payment breakdown
  const paymentBreakdown = effectiveEnrichedData.paymentBreakdown;

  // USE JE SUMMARY as source of truth for sales, tax, shipping, total.
  // This ensures the DR matches the JE exactly — no independent calculation that can diverge.
  const je = transactions[0].jeSummary;
  console.log(`📊 DR ${order.name}: jeSummary=${je ? 'present' : 'MISSING'}, ` +
    `transactions=${transactions.length}, types=${transactions.map(t => t.balanceTransaction.type).join(',')}`);
  if (je) {
    console.log(`  netSales=${je.netSales.toFixed(2)}, tax=${je.tax.toFixed(2)}, ` +
      `shipping=${je.shipping.toFixed(2)}, totalPayment=${je.totalPayment.toFixed(2)}`);
  }
  // For refund-only orders that were handled above, jeSummary may not apply here.
  // For sale+refund on same order, combine all transaction jeSummaries.
  const combinedJe = je ? (() => {
    let netSales = je.netSales;
    let tax = je.tax;
    let shipping = je.shipping;
    let total = je.totalPayment;
    // If there are multiple enriched transactions for this order (e.g., sale + refund),
    // combine their summaries
    for (let i = 1; i < transactions.length; i++) {
      const other = transactions[i].jeSummary;
      if (other) {
        netSales = netSales.plus(other.netSales);
        tax = tax.plus(other.tax);
        shipping = shipping.plus(other.shipping);
        total = total.plus(other.totalPayment);
      }
    }
    return { netSales, tax, shipping, total };
  })() : null;

  const netSubtotal = combinedJe ? combinedJe.netSales.abs() : sales;
  const taxAmount = combinedJe ? combinedJe.tax.abs() : (order.totalTax ?? new Decimal(0));
  const shippingAmount = combinedJe ? combinedJe.shipping.abs() : (order.totalShipping || new Decimal(0));
  const paymentTotal = combinedJe ? combinedJe.total : order.totalPrice;

  // If refunded, create original sale row
  if (order.financialStatus === 'refunded') {
    rows.push({
      orderNumber: order.name,
      originalSubtotal: originalSubtotal.neg().toFixed(2),
      discount: discount.neg().toFixed(2),
      netSubtotal: netSubtotal.neg().toFixed(2), // Negative for refund
      tax: taxAmount.neg().toFixed(2),
      shipping: shippingAmount.gt(0) ? shippingAmount.neg().toFixed(2) : '',
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
      shipping: shippingAmount.gt(0) ? shippingAmount.toFixed(2) : '',
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
      shipping: shippingAmount.gt(0) ? shippingAmount.toFixed(2) : '',
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

  // Check for multi-capture split
  if (order.isMultiCaptureSplit) {
    notes.push('split capture');
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

  // Calculate fishing license total from notes column
  let fishingLicenseTotal = new Decimal(0);
  for (const row of rows) {
    if (row.notes) {
      const fishingMatch = row.notes.match(/([\d.]+)\s*fishing licenses/);
      if (fishingMatch) {
        fishingLicenseTotal = fishingLicenseTotal.plus(new Decimal(fishingMatch[1]));
      }
    }
  }

  // Calculate payment method totals
  const totalPaymentCash = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentCash || 0)), new Decimal(0));
  const totalPaymentCard = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentCard || 0)), new Decimal(0));
  const totalPaymentGiftCard = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentGiftCard || 0)), new Decimal(0));
  const totalPaymentStoreCredit = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentStoreCredit || 0)), new Decimal(0));
  const totalPaymentCheck = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentCheck || 0)), new Decimal(0));
  const totalPaymentOther = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentOther || 0)), new Decimal(0));
  const totalPaymentTotal = rows.reduce((sum, row) => sum.plus(new Decimal(row.paymentTotal || 0)), new Decimal(0));

  // Add summary row
  const fishingNote = fishingLicenseTotal.greaterThan(0)
    ? `FISHING LICENSES SOLD: $${fishingLicenseTotal.toFixed(2)}`
    : '';

  const summaryFields = [
    `SUMMARY (${rows.length} orders)`,
    totalOriginalSubtotal.toFixed(2),
    totalDiscount.toFixed(2),
    totalNetSubtotal.toFixed(2),
    totalTax.toFixed(2),
    totalShipping.toFixed(2),
    '', // area
    fishingNote, // notes - fishing license summary
    '', // tender
    totalPaymentCash.toFixed(2),
    totalPaymentCard.toFixed(2),
    totalPaymentGiftCard.toFixed(2),
    totalPaymentStoreCredit.toFixed(2),
    totalPaymentCheck.toFixed(2),
    totalPaymentOther.toFixed(2),
    totalPaymentTotal.toFixed(2),
    '', // gift card sold
    '', // gift card used
  ];
  lines.push(summaryFields.map(escapeCSVField).join(','));

  return lines.join('\n');
}
