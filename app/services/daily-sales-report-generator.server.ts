import { Decimal } from 'decimal.js';
import type { EnrichedTransaction } from '../types/journal-entry';

/**
 * Daily Sales Report Row
 * 32-column transaction-level detail for bookkeeping team
 */
interface DailySalesReportRow {
  name: string; // Order name (e.g., "#1001")
  tags: string;
  tax1Title: string;
  tax1Rate: string;
  tax1Price: string;
  tax2Title: string;
  tax2Rate: string;
  tax2Price: string;
  tax3Title: string;
  tax3Rate: string;
  tax3Price: string;
  tax4Title: string;
  tax4Rate: string;
  tax4Price: string;
  tax5Title: string;
  tax5Rate: string;
  tax5Price: string;
  taxTotal: string;
  totalShipping: string;
  totalRefund: string;
  currentTotal1: string; // Total payment from all methods (was: card only)
  cash: string;
  charge: string; // Travel Give Aways
  giftCard: string;
  storeCredit: string;
  check: string;
  currentTotal2: string; // Second instance of current total
  paymentStatus: string;
  orderFulfillmentStatus: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingZip: string;
  shippingCity: string;
  transactionKind: string;
  transactionProcessedAt: string;
  transactionAmount: string;
  transactionGateway: string;
  transactionPaymentMethod: string;
  fulfillmentStatus: string;
}

/**
 * Generate Daily Sales Report CSV
 *
 * File #1: Order-level detail with raw Shopify data
 *
 * Format:
 * - ONE row per order (aggregates captures and refunds)
 * - Date assignment: Based on latest capture/sale date across all transactions
 * - Split payments: Entire order reports on the latest capture date
 * - Refunds: Aggregated into totalRefund column (not separate rows)
 * - Partial captures: Uses currentTotalPrice (what was actually captured)
 * - Totals row at bottom
 *
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @returns CSV string
 */
export function generateDailySalesReport(
  enrichedTransactions: EnrichedTransaction[],
): string {
  const rows: DailySalesReportRow[] = [];

  // Group transactions by order
  const orderGroups = groupByOrder(enrichedTransactions);

  // Process all orders that were already filtered by the reconciler
  // The reconciler has already filtered transactions by the target date,
  // so we don't need to filter again here
  //
  // FIX: Create ONE row per order by using only the FIRST transaction (the capture)
  // Previously, this created rows for BOTH captures AND refunds, causing 2-3x duplication
  // Refunds are shown in the totalRefund column, not as separate rows
  for (const [, transactions] of orderGroups.entries()) {
    // Find the capture transaction (charge type) for this order
    const captureTransaction = transactions.find(txn => txn.balanceTransaction.type === 'charge');

    // Only create a row if there's a capture (skip refund-only orders)
    if (captureTransaction) {
      const row = transformToReportRow(captureTransaction, transactions);
      if (row) {
        rows.push(row);
      }
    }
  }

  // Calculate totals row
  const totalsRow = calculateTotalsRow(rows);

  // Generate CSV
  return generateCSV(rows, totalsRow);
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
 * Transform EnrichedTransaction to Daily Sales Report row
 *
 * Handles:
 * - ONE row per order (aggregates all transactions)
 * - Payment method mapping
 * - Tax breakdown (up to 5 lines)
 * - Shipping address fields
 * - Refund totals (from all refund transactions for this order)
 *
 * @param enrichedTxn - The primary capture transaction for this order
 * @param allOrderTransactions - All transactions for this order (captures + refunds)
 */
function transformToReportRow(
  enrichedTxn: EnrichedTransaction,
  allOrderTransactions?: EnrichedTransaction[],
): DailySalesReportRow | null {
  if (!enrichedTxn.order || !enrichedTxn.enrichedData) {
    return null;
  }

  const order = enrichedTxn.order;
  const enrichedData = enrichedTxn.enrichedData;

  // This function now only handles capture transactions (one row per order)
  // Refunds are aggregated into the totalRefund column

  // Tax lines (up to 5)
  const tax1 = enrichedData.taxLines[0] || { title: '', rate: '', price: new Decimal(0) };
  const tax2 = enrichedData.taxLines[1] || { title: '', rate: '', price: new Decimal(0) };
  const tax3 = enrichedData.taxLines[2] || { title: '', rate: '', price: new Decimal(0) };
  const tax4 = enrichedData.taxLines[3] || { title: '', rate: '', price: new Decimal(0) };
  const tax5 = enrichedData.taxLines[4] || { title: '', rate: '', price: new Decimal(0) };

  // USE JE SUMMARY for tax, shipping, and totals to match JE exactly.
  // Combine all jeSummaries for this order (capture + refund) so same-day refunds net correctly.
  const combinedJe = (() => {
    const first = enrichedTxn.jeSummary;
    if (!first) return null;
    let netSales = first.netSales;
    let tax = first.tax;
    let shipping = first.shipping;
    let totalPayment = first.totalPayment;
    let giftCardLiability = first.giftCardLiability;
    if (allOrderTransactions) {
      for (const txn of allOrderTransactions) {
        if (txn === enrichedTxn) continue; // skip the one we already counted
        const other = txn.jeSummary;
        if (other) {
          netSales = netSales.plus(other.netSales);
          tax = tax.plus(other.tax);
          shipping = shipping.plus(other.shipping);
          totalPayment = totalPayment.plus(other.totalPayment);
          giftCardLiability = giftCardLiability.plus(other.giftCardLiability);
        }
      }
    }
    return { netSales, tax, shipping, totalPayment, giftCardLiability };
  })();
  const taxTotal = combinedJe ? combinedJe.tax.abs() : (order.totalTax ?? new Decimal(0));
  const jeShipping = combinedJe ? combinedJe.shipping.abs() : order.totalShipping;

  // Payment breakdown from the capture transaction
  const paymentBreakdown = enrichedData.paymentBreakdown;

  // Current total from JE summary: sales + tax + shipping (matches what JE records in 3000/2110/3040).
  // This excludes gift card liability (2320) so gift card product sales show $0 total, matching the JE.
  // Uses combinedJe so same-day refunds net correctly.
  const currentTotal = combinedJe
    ? combinedJe.netSales.abs().plus(combinedJe.tax.abs()).plus(combinedJe.shipping.abs()).toFixed(2)
    : order.currentTotalPrice.toFixed(2);
  const currentTotal1 = currentTotal;
  const currentTotal2 = currentTotal;

  // Calculate total refund by summing all refund transactions for this order
  // FIX: Aggregate refunds from all transactions, don't create separate rows
  let totalRefundAmount = new Decimal(0);
  if (allOrderTransactions) {
    for (const txn of allOrderTransactions) {
      if (txn.balanceTransaction.type === 'refund') {
        totalRefundAmount = totalRefundAmount.plus(txn.balanceTransaction.gross.abs());
      }
    }
  }
  const totalRefund = totalRefundAmount.greaterThan(0) ? totalRefundAmount.toFixed(2) : '';

  // Get the capture/sale transaction details for this row
  const transaction = enrichedData.transactions.find(
    (txn) => txn.kind === 'capture' || txn.kind === 'sale'
  );

  return {
    name: order.name,
    tags: enrichedData.tags,
    tax1Title: tax1.title,
    tax1Rate: tax1.rate,
    tax1Price: tax1.price.toFixed(2),
    tax2Title: tax2.title,
    tax2Rate: tax2.rate,
    tax2Price: tax2.price.toFixed(2),
    tax3Title: tax3.title,
    tax3Rate: tax3.rate,
    tax3Price: tax3.price.toFixed(2),
    tax4Title: tax4.title,
    tax4Rate: tax4.rate,
    tax4Price: tax4.price.toFixed(2),
    tax5Title: tax5.title,
    tax5Rate: tax5.rate,
    tax5Price: tax5.price.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    totalShipping: jeShipping.toFixed(2),
    totalRefund,
    currentTotal1,
    cash: paymentBreakdown.cash.toFixed(2),
    charge: paymentBreakdown.charge.toFixed(2),
    giftCard: paymentBreakdown.giftCard.toFixed(2),
    storeCredit: paymentBreakdown.storeCredit.toFixed(2),
    check: paymentBreakdown.check.toFixed(2),
    currentTotal2,
    paymentStatus: order.financialStatus,
    orderFulfillmentStatus: enrichedData.fulfillmentStatus,
    shippingAddress1: enrichedData.shippingAddress.address1,
    shippingAddress2: enrichedData.shippingAddress.address2,
    shippingZip: enrichedData.shippingAddress.zip,
    shippingCity: enrichedData.shippingAddress.city,
    transactionKind: transaction?.kind || '',
    transactionProcessedAt: transaction?.processedAt || '',
    transactionAmount: transaction?.amount.toFixed(2) || '',
    transactionGateway: transaction?.gateway || '',
    transactionPaymentMethod: transaction?.paymentMethod || '',
    fulfillmentStatus: enrichedData.fulfillmentStatus,
  };
}

/**
 * Calculate totals row
 *
 * Sums key columns:
 * - Current Total
 * - Tax Total
 * - Shipping
 * - Refunds
 * - Payment methods (CASH, CHARGE, GIFT CARD, STORE CREDIT, CHECK)
 */
function calculateTotalsRow(rows: DailySalesReportRow[]): DailySalesReportRow {
  const totals: DailySalesReportRow = {
    name: 'TOTALS',
    tags: '',
    tax1Title: '',
    tax1Rate: '',
    tax1Price: '',
    tax2Title: '',
    tax2Rate: '',
    tax2Price: '',
    tax3Title: '',
    tax3Rate: '',
    tax3Price: '',
    tax4Title: '',
    tax4Rate: '',
    tax4Price: '',
    tax5Title: '',
    tax5Rate: '',
    tax5Price: '',
    taxTotal: '0.00',
    totalShipping: '0.00',
    totalRefund: '0.00',
    currentTotal1: '0.00',
    cash: '0.00',
    charge: '0.00',
    giftCard: '0.00',
    storeCredit: '0.00',
    check: '0.00',
    currentTotal2: '0.00',
    paymentStatus: '',
    orderFulfillmentStatus: '',
    shippingAddress1: '',
    shippingAddress2: '',
    shippingZip: '',
    shippingCity: '',
    transactionKind: '',
    transactionProcessedAt: '',
    transactionAmount: '',
    transactionGateway: '',
    transactionPaymentMethod: '',
    fulfillmentStatus: '',
  };

  let taxTotal = new Decimal(0);
  let shippingTotal = new Decimal(0);
  let refundTotal = new Decimal(0);
  let currentTotal1Sum = new Decimal(0);
  let cashSum = new Decimal(0);
  let chargeSum = new Decimal(0);
  let giftCardSum = new Decimal(0);
  let storeCreditSum = new Decimal(0);
  let checkSum = new Decimal(0);
  let currentTotal2Sum = new Decimal(0);

  for (const row of rows) {
    taxTotal = taxTotal.plus(parseDecimal(row.taxTotal));
    shippingTotal = shippingTotal.plus(parseDecimal(row.totalShipping));
    refundTotal = refundTotal.plus(parseDecimal(row.totalRefund));
    currentTotal1Sum = currentTotal1Sum.plus(parseDecimal(row.currentTotal1));
    cashSum = cashSum.plus(parseDecimal(row.cash));
    chargeSum = chargeSum.plus(parseDecimal(row.charge));
    giftCardSum = giftCardSum.plus(parseDecimal(row.giftCard));
    storeCreditSum = storeCreditSum.plus(parseDecimal(row.storeCredit));
    checkSum = checkSum.plus(parseDecimal(row.check));
    currentTotal2Sum = currentTotal2Sum.plus(parseDecimal(row.currentTotal2));
  }

  totals.taxTotal = taxTotal.toFixed(2);
  totals.totalShipping = shippingTotal.toFixed(2);
  totals.totalRefund = refundTotal.toFixed(2);
  totals.currentTotal1 = currentTotal1Sum.toFixed(2);
  totals.cash = cashSum.toFixed(2);
  totals.charge = chargeSum.toFixed(2);
  totals.giftCard = giftCardSum.toFixed(2);
  totals.storeCredit = storeCreditSum.toFixed(2);
  totals.check = checkSum.toFixed(2);
  totals.currentTotal2 = currentTotal2Sum.toFixed(2);

  return totals;
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
 * Generate CSV string from rows and totals
 *
 * Format:
 * - Header row with column names
 * - Data rows
 * - Totals row
 *
 * CSV escaping:
 * - Quote fields containing commas, quotes, or newlines
 * - Escape quotes by doubling them
 */
function generateCSV(rows: DailySalesReportRow[], totalsRow: DailySalesReportRow): string {
  const lines: string[] = [];

  // Header row
  const headers = [
    'Name',
    'Tags',
    'Tax 1 Title',
    'Tax 1 Rate',
    'Tax 1 Price',
    'Tax 2 Title',
    'Tax 2 Rate',
    'Tax 2 Price',
    'Tax 3 Title',
    'Tax 3 Rate',
    'Tax 3 Price',
    'Tax 4 Title',
    'Tax 4 Rate',
    'Tax 4 Price',
    'Tax 5 Title',
    'Tax 5 Rate',
    'Tax 5 Price',
    'Tax: Total',
    'Price: Total Shipping',
    'Price: Total Refund',
    'Price: Current Total',
    'CASH',
    'CHARGE',
    'GIFT CARD',
    'STORE CREDIT',
    'CHECK',
    'Price: Current Total',
    'Payment: Status',
    'Order Fulfillment Status',
    'Shipping: Address 1',
    'Shipping: Address 2',
    'Shipping: Zip',
    'Shipping: City',
    'Transaction: Kind',
    'Transaction: Processed At',
    'Transaction: Amount',
    'Transaction: Gateway',
    'Transaction: Payment Method',
    'Fulfillment: Status',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.name,
      row.tags,
      row.tax1Title,
      row.tax1Rate,
      row.tax1Price,
      row.tax2Title,
      row.tax2Rate,
      row.tax2Price,
      row.tax3Title,
      row.tax3Rate,
      row.tax3Price,
      row.tax4Title,
      row.tax4Rate,
      row.tax4Price,
      row.tax5Title,
      row.tax5Rate,
      row.tax5Price,
      row.taxTotal,
      row.totalShipping,
      row.totalRefund,
      row.currentTotal1,
      row.cash,
      row.charge,
      row.giftCard,
      row.storeCredit,
      row.check,
      row.currentTotal2,
      row.paymentStatus,
      row.orderFulfillmentStatus,
      row.shippingAddress1,
      row.shippingAddress2,
      row.shippingZip,
      row.shippingCity,
      row.transactionKind,
      row.transactionProcessedAt,
      row.transactionAmount,
      row.transactionGateway,
      row.transactionPaymentMethod,
      row.fulfillmentStatus,
    ];
    lines.push(fields.map(escapeCSVField).join(','));
  }

  // Totals row
  const totalsFields = [
    totalsRow.name,
    totalsRow.tags,
    totalsRow.tax1Title,
    totalsRow.tax1Rate,
    totalsRow.tax1Price,
    totalsRow.tax2Title,
    totalsRow.tax2Rate,
    totalsRow.tax2Price,
    totalsRow.tax3Title,
    totalsRow.tax3Rate,
    totalsRow.tax3Price,
    totalsRow.tax4Title,
    totalsRow.tax4Rate,
    totalsRow.tax4Price,
    totalsRow.tax5Title,
    totalsRow.tax5Rate,
    totalsRow.tax5Price,
    totalsRow.taxTotal,
    totalsRow.totalShipping,
    totalsRow.totalRefund,
    totalsRow.currentTotal1,
    totalsRow.cash,
    totalsRow.charge,
    totalsRow.giftCard,
    totalsRow.storeCredit,
    totalsRow.check,
    totalsRow.currentTotal2,
    totalsRow.paymentStatus,
    totalsRow.orderFulfillmentStatus,
    totalsRow.shippingAddress1,
    totalsRow.shippingAddress2,
    totalsRow.shippingZip,
    totalsRow.shippingCity,
    totalsRow.transactionKind,
    totalsRow.transactionProcessedAt,
    totalsRow.transactionAmount,
    totalsRow.transactionGateway,
    totalsRow.transactionPaymentMethod,
    totalsRow.fulfillmentStatus,
  ];
  lines.push(totalsFields.map(escapeCSVField).join(','));

  return lines.join('\n');
}

/**
 * Escape CSV field
 * Quote fields containing commas, quotes, or newlines
 * Escape quotes by doubling them
 */
function escapeCSVField(field: string): string {
  const fieldStr = String(field);

  // Check if field needs quoting
  if (
    fieldStr.includes(',') ||
    fieldStr.includes('"') ||
    fieldStr.includes('\n') ||
    fieldStr.includes('\r')
  ) {
    // Escape quotes by doubling them
    const escaped = fieldStr.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return fieldStr;
}
