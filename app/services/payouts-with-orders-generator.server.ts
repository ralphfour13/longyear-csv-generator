import { Decimal } from 'decimal.js';
import type { EnrichedTransaction } from '../types/journal-entry';
import { fetchProductMetafieldBySkus } from './shopify/product-cost-updater.server';

/** DonorPerfect product metafield holding the G/L account string. */
export const GL_ACCOUNT_METAFIELD_NAMESPACE = 'donorperfect';
export const GL_ACCOUNT_METAFIELD_KEY = 'gl_account';

/**
 * The order shape carried on an enriched transaction. This is intentionally
 * narrower than the full `Order` type — it's exactly what the order-level
 * exports (Payouts/Products with Orders) need.
 */
export type PayoutOrder = NonNullable<EnrichedTransaction['order']>;

/**
 * Payouts with Orders Row — Sage 50 sales-import layout.
 *
 * ONE ROW PER LINE ITEM. Order-level fields (customer, invoice no., date, tax,
 * discount) repeat on every line item belonging to that order.
 */
interface PayoutsWithOrdersRow {
  customerId: string;      // order.customer.id
  customerName: string;    // order.customer.first_name + last_name
  invoiceNo: string;       // order.name
  date: string;            // order.created_at
  dueDate: string;         // order.created_at + payment terms
  itemId: string;          // line_item.sku
  description: string;     // line_item.title
  quantity: string;        // line_item.quantity
  unitPrice: string;       // line_item.price
  amount: string;          // quantity × price
  glAccount: string;       // mapped from SKU/category (TODO: not yet sourced)
  salesTax: string;        // order.tax_lines[] (summed)
  taxType: string;         // order.tax_lines[0].title
  discountAmount: string;  // order.total_discounts
  taxRate: string;         // order.tax_lines[0].rate
}

/**
 * Generate Payouts with Orders CSV (Sage 50 sales-import layout)
 *
 * One row per ORDER LINE ITEM. Each row carries its parent order's customer,
 * invoice number, date, tax and discount so the file can be imported as a sales
 * journal. Order-level values (tax, discount) are repeated on each line item row.
 *
 * Column → source mapping:
 *  1. Customer ID    ← order.customer.id
 *  2. Customer Name  ← order.customer.first_name + last_name
 *  3. Invoice No.    ← order.name
 *  4. Date           ← order.created_at
 *  5. Due Date       ← order.created_at + payment terms
 *  6. Item ID        ← line_item.sku
 *  7. Description    ← line_item.title
 *  8. Quantity       ← line_item.quantity
 *  9. Unit Price     ← line_item.price
 * 10. Amount         ← quantity × price
 * 11. G/L Account    ← mapped from SKU/category (not yet sourced — left blank)
 * 12. Sales Tax      ← order.tax_lines[] (summed)
 * 13. Tax Type       ← order.tax_lines[0].title
 * 14. Discount Amount← order.total_discounts
 * 15. Tax Rate       ← order.tax_lines[0].rate
 *
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @returns CSV string
 */
export async function generatePayoutsWithOrders(
  shop: string,
  accessToken: string,
  enrichedTransactions: EnrichedTransaction[]
): Promise<string> {
  const rows: PayoutsWithOrdersRow[] = [];

  // Single source of truth for which orders this export contains.
  const orders = getPayoutOrders(enrichedTransactions);

  // Fetch the DonorPerfect G/L Account product metafield for every SKU sold.
  const skus = collectSkus(orders);
  const glAccountBySku =
    skus.length > 0
      ? await fetchProductMetafieldBySkus(
          shop,
          accessToken,
          skus,
          GL_ACCOUNT_METAFIELD_NAMESPACE,
          GL_ACCOUNT_METAFIELD_KEY
        )
      : new Map<string, string>();

  for (const order of orders) {
    // Order-level values, computed once and repeated on each line item row.
    const customerName =
      [order.customerFirstName, order.customerLastName].filter(Boolean).join(' ').trim() ||
      order.customerName ||
      '';

    const taxLines = order.taxLines || [];
    const salesTax = taxLines.reduce((sum, t) => sum.plus(t.price), new Decimal(0));
    const taxType = taxLines[0]?.title || '';
    const taxRate = taxLines[0] != null ? String(taxLines[0].rate) : '';
    const discountAmount = (order.totalDiscounts ?? new Decimal(0)).toFixed(2);
    const date = formatDate(order.createdAt);
    const dueDate = formatDate(addDays(order.createdAt, parseTermDays(order.paymentTerms)));

    for (const item of order.lineItems) {
      const amount = item.price.times(item.quantity);

      rows.push({
        customerId: order.customerId || '',
        customerName,
        invoiceNo: order.name,
        date,
        dueDate,
        itemId: item.sku || '',
        description: item.title,
        quantity: String(item.quantity),
        unitPrice: item.price.toFixed(2),
        amount: amount.toFixed(2),
        glAccount: item.sku ? glAccountBySku.get(item.sku.trim().toLowerCase()) || '' : '',
        salesTax: salesTax.toFixed(2),
        taxType,
        discountAmount,
        taxRate,
      });
    }
  }

  // Generate CSV
  return generateCSV(rows);
}

/**
 * Resolve the deduped list of orders that the Payouts with Orders export contains,
 * in stable first-seen order.
 *
 * This is the SINGLE SOURCE OF TRUTH for "which orders are in the export". Other
 * reports (e.g. Products with Orders) import this so they generate rows for exactly
 * the same set of orders and can never drift from the payouts file.
 */
export function getPayoutOrders(
  enrichedTransactions: EnrichedTransaction[]
): PayoutOrder[] {
  const orders: PayoutOrder[] = [];
  const seen = new Set<string>();

  for (const txn of enrichedTransactions) {
    if (txn.order && !seen.has(txn.order.id)) {
      seen.add(txn.order.id);
      orders.push(txn.order);
    }
  }

  return orders;
}

/**
 * Collect the unique, non-empty SKUs (original casing) across the given orders.
 */
function collectSkus(orders: PayoutOrder[]): string[] {
  const skus: string[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    for (const item of order.lineItems) {
      const sku = (item.sku || '').trim();
      if (!sku) continue;
      const key = sku.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        skus.push(sku);
      }
    }
  }
  return skus;
}

/**
 * Parse the number of days from a payment-terms label (e.g. "Net 30" → 30).
 * Returns 0 when there are no terms, so the due date falls back to the order date.
 */
function parseTermDays(terms?: string): number {
  if (!terms) return 0;
  const match = terms.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

/**
 * Add a whole number of days to an ISO timestamp, returning a new ISO string.
 */
function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/**
 * Format date as MM/DD/YYYY in the store's timezone (Pacific).
 *
 * Orders are SELECTED by their Pacific calendar day, so the displayed date must use
 * the same conversion — otherwise an order created near midnight could show a day
 * that differs from the export date the user selected. Handles PST/PDT automatically.
 */
function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Generate CSV string from rows
 *
 * Format:
 * - Header row with column names
 * - Data rows (one per line item)
 *
 * CSV escaping:
 * - Quote fields containing commas, quotes, or newlines
 * - Escape quotes by doubling them
 */
function generateCSV(rows: PayoutsWithOrdersRow[]): string {
  const lines: string[] = [];

  // Header row — must stay in sync (count + order) with the fields array below.
  const headers = [
    'Customer ID',
    'Customer Name',
    'Invoice No.',
    'Date',
    'Due Date',
    'Item ID',
    'Description',
    'Quantity',
    'Unit Price',
    'Amount',
    'G/L Account',
    'Sales Tax',
    'Tax Type',
    'Discount Amount',
    'Tax Rate',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.customerId,
      row.customerName,
      row.invoiceNo,
      row.date,
      row.dueDate,
      row.itemId,
      row.description,
      row.quantity,
      row.unitPrice,
      row.amount,
      row.glAccount,
      row.salesTax,
      row.taxType,
      row.discountAmount,
      row.taxRate,
    ];
    lines.push(fields.map(escapeCSVField).join(','));
  }

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
