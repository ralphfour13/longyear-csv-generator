import { Decimal } from 'decimal.js';
import type { EnrichedTransaction } from '../types/journal-entry';
import type { SalesTaxReportRow, SalesTaxOrderSummary, ShopAddress } from '../types/sales-tax';

/**
 * Generate Sales Tax Report CSV from enriched transactions
 *
 * Filters to POS + CA-shipped orders, then produces a per-order CSV
 * with tax jurisdiction breakdowns for CDTFA filing.
 *
 * @param enrichedTransactions - All enriched transactions collected day-by-day
 * @param periodLabel - e.g., "January 2026" or "Q1 2026"
 * @param shopAddress - Store address for POS orders
 * @returns CSV string
 */
export function generateSalesTaxReport(
  enrichedTransactions: EnrichedTransaction[],
  shopAddress: ShopAddress,
): string {
  // Group transactions by order
  const orderGroups = groupByOrder(enrichedTransactions);

  // Build order summaries, filtering to POS + CA only
  const orderSummaries: SalesTaxOrderSummary[] = [];

  for (const [, transactions] of orderGroups.entries()) {
    const summary = buildOrderSummary(transactions, shopAddress);
    if (summary) {
      orderSummaries.push(summary);
    }
  }

  // Sort by capture date, then order number
  orderSummaries.sort((a, b) => {
    const dateCompare = a.captureDate.localeCompare(b.captureDate);
    if (dateCompare !== 0) return dateCompare;
    return a.orderNumber.localeCompare(b.orderNumber);
  });

  // Convert to report rows
  const rows: SalesTaxReportRow[] = orderSummaries.map(summaryToRow);

  // Generate CSV
  return generateCSV(rows);
}

/**
 * Group enriched transactions by order ID
 */
function groupByOrder(
  enrichedTransactions: EnrichedTransaction[],
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
 * Build a SalesTaxOrderSummary from grouped transactions.
 * Returns null if the order doesn't qualify (not POS and not shipped to CA).
 */
function buildOrderSummary(
  transactions: EnrichedTransaction[],
  shopAddress: ShopAddress,
): SalesTaxOrderSummary | null {
  // Use the first transaction with enriched data for order info
  const primaryTxn = transactions.find(t => t.enrichedData) || transactions[0];
  if (!primaryTxn?.order) return null;

  const order = primaryTxn.order;
  const enrichedData = primaryTxn.enrichedData;
  const sourceName = enrichedData?.sourceName || '';

  // Determine ship-to address
  const provinceCode = enrichedData?.shippingAddress?.provinceCode || '';
  let shipToCity = enrichedData?.shippingAddress?.city || '';
  let shipToState = provinceCode;

  // Filter: POS orders OR online orders shipped to CA
  const isPOS = sourceName === 'pos';
  const isCAShipped = provinceCode.toUpperCase() === 'CA';

  if (!isPOS && !isCAShipped) {
    return null; // Not relevant for CA sales tax
  }

  // For POS orders with no shipping address, use shop address
  if (isPOS && !shipToCity) {
    shipToCity = shopAddress.city;
    shipToState = shopAddress.provinceCode;
  }

  // USE JE SUMMARY as source of truth for tax, shipping, and totals.
  // Combine all jeSummaries for this order (capture + refund) so partial
  // cancellations and same-day refunds are reflected correctly.
  const combinedJe = (() => {
    const first = transactions[0]?.jeSummary;
    if (!first) return null;
    let netSales = first.netSales;
    let tax = first.tax;
    let shipping = first.shipping;
    let giftCardLiability = first.giftCardLiability;
    for (let i = 1; i < transactions.length; i++) {
      const other = transactions[i].jeSummary;
      if (other) {
        netSales = netSales.plus(other.netSales);
        tax = tax.plus(other.tax);
        shipping = shipping.plus(other.shipping);
        giftCardLiability = giftCardLiability.plus(other.giftCardLiability);
      }
    }
    return { netSales, tax, shipping, giftCardLiability };
  })();

  // Tax and shipping from jeSummary (with fallbacks to original order values)
  const totalTaxCollected = combinedJe ? combinedJe.tax.abs() : (() => {
    const taxLines = enrichedData?.taxLines || [];
    return taxLines.reduce((sum, tl) => sum.plus(tl.price), new Decimal(0));
  })();
  const shippingCharged = combinedJe ? combinedJe.shipping.abs() : order.totalShipping;

  // Gift card liability (only when positive = GC product sold)
  const giftCardSoldAmount = combinedJe?.giftCardLiability.gt(0)
    ? combinedJe.giftCardLiability
    : new Decimal(0);

  // Discount amount from jeSummary: grossSales - netSales - giftCardSold
  // When jeSummary is available, derive discount so grossSales - discount = netSales + giftCardSold
  const discountAmount = combinedJe
    ? order.subtotalPrice.plus(order.totalDiscounts).minus(combinedJe.netSales.abs()).minus(giftCardSoldAmount)
    : order.totalDiscounts;
  // If the derived discount is negative (shouldn't happen), fall back to original
  const effectiveDiscount = discountAmount.gte(0) ? discountAmount : order.totalDiscounts;

  // Gross sales = netSales + giftCardSold + discounts (before discounts removed)
  const grossSales = combinedJe
    ? combinedJe.netSales.abs().plus(giftCardSoldAmount).plus(effectiveDiscount)
    : order.subtotalPrice.plus(order.totalDiscounts);

  // Exclude POS orders with no tax collected (out-of-state shipments)
  if (isPOS && totalTaxCollected.isZero()) {
    return null;
  }

  // Check for exempt reason via tags
  const tags = enrichedData?.tags || '';
  let exemptReason = '';
  if (tags.toLowerCase().split(',').some(t => t.trim() === 'licenses')) {
    exemptReason = 'License';
  }

  // Calculate taxable vs non-taxable from line items (original proportions)
  let originalTaxable = new Decimal(0);
  let originalNonTaxable = new Decimal(0);

  if (order.lineItems) {
    for (const item of order.lineItems) {
      const lineTotal = item.price.times(item.quantity).minus(item.totalDiscount);
      if (item.taxable) {
        originalTaxable = originalTaxable.plus(lineTotal);
      } else {
        originalNonTaxable = originalNonTaxable.plus(lineTotal);
      }
    }
  }

  // When jeSummary is available, scale taxable/nonTaxable proportionally to match
  // the jeSummary netSales (which reflects partial captures/cancellations)
  let taxableAmount: Decimal;
  let nonTaxableAmount: Decimal;
  const netSalesFromJe = combinedJe ? combinedJe.netSales.abs().plus(giftCardSoldAmount) : null;

  if (netSalesFromJe && !originalTaxable.plus(originalNonTaxable).isZero()) {
    const originalTotal = originalTaxable.plus(originalNonTaxable);
    const scale = netSalesFromJe.div(originalTotal);
    taxableAmount = originalTaxable.times(scale).toDecimalPlaces(2);
    nonTaxableAmount = netSalesFromJe.minus(taxableAmount); // remainder to avoid rounding gap
  } else {
    taxableAmount = originalTaxable;
    nonTaxableAmount = originalNonTaxable;
  }

  // Tax lines from enrichment — scale proportionally when jeSummary tax differs
  const originalTaxLines = enrichedData?.taxLines || [];
  let taxLines: Array<{ title: string; rate: string; price: Decimal }>;

  const originalTaxTotal = originalTaxLines.reduce(
    (sum, tl) => sum.plus(tl.price), new Decimal(0),
  );

  if (combinedJe && !originalTaxTotal.isZero() && !originalTaxTotal.eq(totalTaxCollected)) {
    // Scale each tax line proportionally so they sum to totalTaxCollected
    const taxScale = totalTaxCollected.div(originalTaxTotal);
    let scaledSum = new Decimal(0);
    taxLines = originalTaxLines.map((tl, idx) => {
      let scaledPrice: Decimal;
      if (idx === originalTaxLines.length - 1) {
        // Last line gets the remainder to avoid rounding discrepancy
        scaledPrice = totalTaxCollected.minus(scaledSum);
      } else {
        scaledPrice = tl.price.times(taxScale).toDecimalPlaces(2);
        scaledSum = scaledSum.plus(scaledPrice);
      }
      return { title: tl.title, rate: tl.rate, price: scaledPrice };
    });
  } else {
    taxLines = originalTaxLines;
  }

  // Capture date from the primary capture transaction
  const captureTxn = transactions.find(t => t.balanceTransaction.type === 'charge');
  const captureDate = captureTxn
    ? formatDateOnly(captureTxn.balanceTransaction.processedAt)
    : formatDateOnly(primaryTxn.balanceTransaction.processedAt);

  // Refund amounts from refund transactions
  let refundAmount = new Decimal(0);
  let refundTaxAmount = new Decimal(0);
  for (const txn of transactions) {
    if (txn.balanceTransaction.type === 'refund') {
      refundAmount = refundAmount.plus(txn.balanceTransaction.gross.abs());
      // Estimate refund tax from jeSummary if available
      if (txn.jeSummary) {
        refundTaxAmount = refundTaxAmount.plus(txn.jeSummary.tax.abs());
      }
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.name,
    orderDate: formatDateOnly(order.createdAt),
    captureDate,
    sourceName,
    tags,
    shipToCity,
    shipToState,
    grossSales,
    discountAmount: effectiveDiscount,
    shippingCharged,
    taxableAmount,
    nonTaxableAmount,
    exemptReason,
    taxLines,
    totalTaxCollected,
    refundAmount,
    refundTaxAmount,
  };
}

/**
 * Convert order summary to CSV row
 */
function summaryToRow(summary: SalesTaxOrderSummary): SalesTaxReportRow {
  const tax1 = summary.taxLines[0] || { title: '', rate: '', price: new Decimal(0) };
  const tax2 = summary.taxLines[1] || { title: '', rate: '', price: new Decimal(0) };
  const tax3 = summary.taxLines[2] || { title: '', rate: '', price: new Decimal(0) };
  const tax4 = summary.taxLines[3] || { title: '', rate: '', price: new Decimal(0) };
  const tax5 = summary.taxLines[4] || { title: '', rate: '', price: new Decimal(0) };

  return {
    orderNumber: summary.orderNumber,
    orderDate: summary.orderDate,
    captureDate: summary.captureDate,
    source: summary.sourceName === 'pos' ? 'POS' : 'Online',
    shipToCity: summary.shipToCity,
    shipToState: summary.shipToState,
    grossSales: summary.grossSales.toFixed(2),
    discountAmount: summary.discountAmount.toFixed(2),
    shippingCharged: summary.shippingCharged.toFixed(2),
    taxableAmount: summary.taxableAmount.toFixed(2),
    nonTaxableAmount: summary.nonTaxableAmount.toFixed(2),
    exemptReason: summary.exemptReason,
    tax1Title: tax1.title,
    tax1Rate: tax1.rate,
    tax1Amount: tax1.price.toFixed(2),
    tax2Title: tax2.title,
    tax2Rate: tax2.rate,
    tax2Amount: tax2.price.toFixed(2),
    tax3Title: tax3.title,
    tax3Rate: tax3.rate,
    tax3Amount: tax3.price.toFixed(2),
    tax4Title: tax4.title,
    tax4Rate: tax4.rate,
    tax4Amount: tax4.price.toFixed(2),
    tax5Title: tax5.title,
    tax5Rate: tax5.rate,
    tax5Amount: tax5.price.toFixed(2),
    totalTaxCollected: summary.totalTaxCollected.toFixed(2),
    refundAmount: summary.refundAmount.greaterThan(0) ? summary.refundAmount.toFixed(2) : '',
    refundTaxAmount: summary.refundTaxAmount.greaterThan(0) ? summary.refundTaxAmount.toFixed(2) : '',
  };
}

/**
 * Format ISO date to YYYY-MM-DD
 */
function formatDateOnly(isoDate: string): string {
  if (!isoDate) return '';
  return isoDate.split('T')[0];
}

/**
 * Generate CSV string
 */
function generateCSV(
  rows: SalesTaxReportRow[],
): string {
  const lines: string[] = [];

  // Header row
  const headers = [
    'Order Number',
    'Order Date',
    'Capture Date',
    'Source',
    'Ship-to City',
    'Ship-to State',
    'Gross Sales',
    'Discount Amount',
    'Shipping Charged',
    'Taxable Amount',
    'Non-Taxable Amount',
    'Exempt Reason',
    'Tax 1 Title',
    'Tax 1 Rate',
    'Tax 1 Amount',
    'Tax 2 Title',
    'Tax 2 Rate',
    'Tax 2 Amount',
    'Tax 3 Title',
    'Tax 3 Rate',
    'Tax 3 Amount',
    'Tax 4 Title',
    'Tax 4 Rate',
    'Tax 4 Amount',
    'Tax 5 Title',
    'Tax 5 Rate',
    'Tax 5 Amount',
    'Total Tax Collected',
    'Refund Amount',
    'Refund Tax Amount',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    lines.push(rowToCSVLine(row));
  }

  return lines.join('\n');
}

/**
 * Convert a report row to a CSV line
 */
function rowToCSVLine(row: SalesTaxReportRow): string {
  const fields = [
    row.orderNumber,
    row.orderDate,
    row.captureDate,
    row.source,
    row.shipToCity,
    row.shipToState,
    row.grossSales,
    row.discountAmount,
    row.shippingCharged,
    row.taxableAmount,
    row.nonTaxableAmount,
    row.exemptReason,
    row.tax1Title,
    row.tax1Rate,
    row.tax1Amount,
    row.tax2Title,
    row.tax2Rate,
    row.tax2Amount,
    row.tax3Title,
    row.tax3Rate,
    row.tax3Amount,
    row.tax4Title,
    row.tax4Rate,
    row.tax4Amount,
    row.tax5Title,
    row.tax5Rate,
    row.tax5Amount,
    row.totalTaxCollected,
    row.refundAmount,
    row.refundTaxAmount,
  ];
  return fields.map(escapeCSVField).join(',');
}

/**
 * Escape CSV field
 */
function escapeCSVField(field: string): string {
  const fieldStr = String(field);

  if (
    fieldStr.includes(',') ||
    fieldStr.includes('"') ||
    fieldStr.includes('\n') ||
    fieldStr.includes('\r')
  ) {
    const escaped = fieldStr.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return fieldStr;
}
