import { Decimal } from 'decimal.js';
import type { AccountMappings, EnrichedTransaction } from '../types/journal-entry';
import { getPayoutOrders } from './payouts-with-orders-generator.server';
import { fetchOrderTransactions } from './order-centric-fetcher.server';
import { getAccountMappings } from './storage-adapter.server';

/**
 * Receipts Row — Sage 50 cash-receipts import layout.
 *
 * ONE ROW PER PAYMENT TRANSACTION (successful capture/sale) on a paid order placed
 * on the selected date. Split-tender orders produce multiple rows. Order-level
 * values (Total Paid, Discount, Sales Tax) repeat across an order's payment rows.
 */
interface ReceiptRow {
  depositTicketId: string; // payout.id OR order.id
  customerId: string;      // order.customer.id
  customerName: string;    // order.customer name
  reference: string;       // order.name
  date: string;            // transaction.processed_at
  paymentMethod: string;   // transaction.gateway
  cashAccount: string;     // mapped by gateway
  cashAmount: string;      // transaction.amount
  salesTaxId: string;      // order.tax_lines[0].rate
  totalPaid: string;       // order.total_price
  discountAmount: string;  // order.total_discounts
}

/**
 * Generate Receipts CSV (Sage 50 cash-receipts import)
 *
 * One row per successful payment transaction (capture/sale) on a PAID order placed
 * on the selected date. The order set comes from the shared `getPayoutOrders()`
 * selector (filtered to paid); transactions are fetched per order from Shopify
 * (the fast export path does not carry them).
 *
 * Column → source mapping:
 *  1. Deposit Ticket ID       ← payout.id OR order.id (no payout in this path → order.id)
 *  2. Customer ID             ← order.customer.id
 *  3. Customer Name           ← order.customer name
 *  4. Reference               ← order.name
 *  5. Date                    ← transaction.processed_at
 *  6. Payment Method          ← transaction.gateway
 *  7. Cash Account            ← mapped by gateway (reuses account mappings)
 *  8. Cash Amount             ← transaction.amount
 *  9. Sales Tax ID            ← order.tax_lines[0].rate
 * 10. Total Paid on Invoice(s)← order.total_price
 * 11. Discount Amount         ← order.total_discounts
 *
 * @param shop - Shop domain (for the transaction fetch + account mappings)
 * @param accessToken - Shopify access token
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @returns CSV string
 */
export async function generateReceiptsWithOrders(
  shop: string,
  accessToken: string,
  enrichedTransactions: EnrichedTransaction[]
): Promise<string> {
  const rows: ReceiptRow[] = [];

  // Same order set as the income/products files, but only paid orders get a receipt.
  const orders = getPayoutOrders(enrichedTransactions).filter(
    (order) => (order.financialStatus || '').toLowerCase() === 'paid'
  );

  const accountMappings = await getAccountMappings(shop);

  for (const order of orders) {
    const customerName =
      [order.customerFirstName, order.customerLastName].filter(Boolean).join(' ').trim() ||
      order.customerName ||
      '';

    // Order-level values, repeated on each of the order's payment rows.
    const salesTaxId = order.taxLines?.[0] != null ? String(order.taxLines[0].rate) : '';
    const totalPaid = order.totalPrice.toFixed(2);
    const discountAmount = (order.totalDiscounts ?? new Decimal(0)).toFixed(2);

    // Fetch the order's payment transactions (the fast export path carries none).
    const transactions = await fetchOrderTransactions(shop, accessToken, order.id);
    const payments = transactions.filter(
      (t) => (t.kind === 'sale' || t.kind === 'capture') && t.status === 'success'
    );

    for (const txn of payments) {
      rows.push({
        depositTicketId: order.id, // no payout in this path → fall back to order.id
        customerId: order.customerId || '',
        customerName,
        reference: order.name,
        date: formatDate(txn.processedAt),
        paymentMethod: txn.gateway || '',
        cashAccount: cashAccountForGateway(txn.gateway, accountMappings),
        cashAmount: txn.amount.toFixed(2),
        salesTaxId,
        totalPaid,
        discountAmount,
      });
    }
  }

  return generateCSV(rows);
}

/**
 * Resolve the "Cash Account" for a payment by its gateway.
 *
 * Mirrors the gateway → account scheme used by the journal generator so receipts
 * post to the same accounts. Unknown gateways fall back to the clearing account.
 */
function cashAccountForGateway(gateway: string, m: AccountMappings): string {
  switch ((gateway || '').toLowerCase()) {
    case 'shopify_payments':
      return m.clearing_account.accountCode;
    case 'gift_card':
      return m.gift_card_liability.accountCode;
    case 'shopify_store_credit':
    case 'store_credit':
      return m.store_credit_liability.accountCode;
    case 'cash':
      return m.cash_register.accountCode;
    case 'charge':
      return m.accounts_receivable.accountCode;
    case 'check':
    case 'cheque':
      return m.undeposited_funds.accountCode;
    default:
      return m.clearing_account.accountCode;
  }
}

/**
 * Format date as MM/DD/YYYY in the store's timezone (Pacific).
 *
 * Handles PST/PDT automatically. Kept in sync with the formatDate in
 * payouts-with-orders-generator.
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
 * - Data rows (one per payment transaction)
 *
 * CSV escaping:
 * - Quote fields containing commas, quotes, or newlines
 * - Escape quotes by doubling them
 */
function generateCSV(rows: ReceiptRow[]): string {
  const lines: string[] = [];

  // Header row — must stay in sync (count + order) with the fields array below.
  const headers = [
    'Deposit Ticket ID',
    'Customer ID',
    'Customer Name',
    'Reference',
    'Date',
    'Payment Method',
    'Cash Account',
    'Cash Amount',
    'Sales Tax ID',
    'Total Paid on Invoice(s)',
    'Discount Amount',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.depositTicketId,
      row.customerId,
      row.customerName,
      row.reference,
      row.date,
      row.paymentMethod,
      row.cashAccount,
      row.cashAmount,
      row.salesTaxId,
      row.totalPaid,
      row.discountAmount,
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
