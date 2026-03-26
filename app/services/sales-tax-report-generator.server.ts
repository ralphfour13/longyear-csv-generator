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
  periodLabel: string,
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

  // Calculate totals
  const totalsRow = calculateTotalsRow(rows);

  // Generate CSV
  return generateCSV(rows, totalsRow, periodLabel);
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

  // Calculate taxable vs non-taxable from line items
  let taxableAmount = new Decimal(0);
  let nonTaxableAmount = new Decimal(0);
  let exemptReason = '';

  if (order.lineItems) {
    for (const item of order.lineItems) {
      const lineTotal = item.price.times(item.quantity).minus(item.totalDiscount);
      if (item.taxable) {
        taxableAmount = taxableAmount.plus(lineTotal);
      } else {
        nonTaxableAmount = nonTaxableAmount.plus(lineTotal);
      }
    }
  }

  // Check for exempt reason via tags
  const tags = enrichedData?.tags || '';
  if (tags.toLowerCase().split(',').some(t => t.trim() === 'licenses')) {
    exemptReason = 'License';
  }

  // Tax lines from enrichment
  const taxLines = enrichedData?.taxLines || [];

  // Total tax collected
  const totalTaxCollected = taxLines.reduce(
    (sum, tl) => sum.plus(tl.price),
    new Decimal(0),
  );

  // Gross sales = subtotal + discounts (before discounts removed)
  const grossSales = order.subtotalPrice.plus(order.totalDiscounts);

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
    discountAmount: order.totalDiscounts,
    shippingCharged: order.totalShipping,
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
 * Calculate totals row
 */
function calculateTotalsRow(rows: SalesTaxReportRow[]): SalesTaxReportRow {
  let grossSales = new Decimal(0);
  let discountAmount = new Decimal(0);
  let shippingCharged = new Decimal(0);
  let taxableAmount = new Decimal(0);
  let nonTaxableAmount = new Decimal(0);
  let totalTaxCollected = new Decimal(0);
  let refundAmount = new Decimal(0);
  let refundTaxAmount = new Decimal(0);

  for (const row of rows) {
    grossSales = grossSales.plus(parseDecimal(row.grossSales));
    discountAmount = discountAmount.plus(parseDecimal(row.discountAmount));
    shippingCharged = shippingCharged.plus(parseDecimal(row.shippingCharged));
    taxableAmount = taxableAmount.plus(parseDecimal(row.taxableAmount));
    nonTaxableAmount = nonTaxableAmount.plus(parseDecimal(row.nonTaxableAmount));
    totalTaxCollected = totalTaxCollected.plus(parseDecimal(row.totalTaxCollected));
    refundAmount = refundAmount.plus(parseDecimal(row.refundAmount));
    refundTaxAmount = refundTaxAmount.plus(parseDecimal(row.refundTaxAmount));
  }

  return {
    orderNumber: 'TOTALS',
    orderDate: '',
    captureDate: '',
    source: '',
    shipToCity: '',
    shipToState: '',
    grossSales: grossSales.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    shippingCharged: shippingCharged.toFixed(2),
    taxableAmount: taxableAmount.toFixed(2),
    nonTaxableAmount: nonTaxableAmount.toFixed(2),
    exemptReason: '',
    tax1Title: '',
    tax1Rate: '',
    tax1Amount: '',
    tax2Title: '',
    tax2Rate: '',
    tax2Amount: '',
    tax3Title: '',
    tax3Rate: '',
    tax3Amount: '',
    tax4Title: '',
    tax4Rate: '',
    tax4Amount: '',
    tax5Title: '',
    tax5Rate: '',
    tax5Amount: '',
    totalTaxCollected: totalTaxCollected.toFixed(2),
    refundAmount: refundAmount.toFixed(2),
    refundTaxAmount: refundTaxAmount.toFixed(2),
  };
}

/**
 * Parse string to Decimal (handles empty strings as zero)
 */
function parseDecimal(value: string): Decimal {
  if (!value || value === '') {
    return new Decimal(0);
  }
  return new Decimal(value);
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
  totalsRow: SalesTaxReportRow,
  periodLabel: string,
): string {
  const lines: string[] = [];

  // Period label row
  lines.push(escapeCSVField(`Sales Tax Report - ${periodLabel}`));
  lines.push(''); // blank line

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

  // Totals row
  lines.push(rowToCSVLine(totalsRow));

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
