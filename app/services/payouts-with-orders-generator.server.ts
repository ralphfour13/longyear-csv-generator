import { Decimal } from 'decimal.js';
import type { EnrichedTransaction } from '../types/journal-entry';

/**
 * Payouts with Orders Row
 * Flat structure showing which orders went into which payout
 */
interface PayoutsWithOrdersRow {
  payoutId: string;
  payoutDate: string;
  payoutAmount: string;
  orderName: string;
  orderDate: string;
  orderTotal: string;
  netToPayout: string; // Amount that went into this payout for this order
}

/**
 * Generate Payouts with Orders CSV
 *
 * File #2: Flat payout-to-order mapping for reconciliation
 *
 * Format:
 * - One row per order
 * - Every row has payout ID to show which payout it belongs to
 * - Flat structure (no nesting or hierarchical headers)
 *
 * Columns:
 * - Payout ID
 * - Payout Date
 * - Payout Amount
 * - Order Name
 * - Order Date
 * - Order Total
 * - Net to Payout (amount that went into this payout for this order)
 *
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @returns CSV string
 */
export function generatePayoutsWithOrders(
  enrichedTransactions: EnrichedTransaction[]
): string {
  const rows: PayoutsWithOrdersRow[] = [];

  // Group transactions by order
  const orderGroups = groupByOrder(enrichedTransactions);

  for (const [, transactions] of orderGroups.entries()) {
    // Sum net amounts for this order (handles multiple balance transactions per order)
    const netToPayout = transactions.reduce(
      (sum, txn) => sum.plus(txn.balanceTransaction.net),
      new Decimal(0)
    );

    // Get order and payout details (same for all transactions in group)
    const firstTxn = transactions[0];
    if (!firstTxn.order) {
      continue;
    }

    const row: PayoutsWithOrdersRow = {
      payoutId: firstTxn.payout.id,
      payoutDate: formatDate(firstTxn.payout.date),
      payoutAmount: firstTxn.payout.amount.toFixed(2),
      orderName: firstTxn.order.name,
      orderDate: formatDate(firstTxn.order.createdAt),
      orderTotal: firstTxn.order.currentTotalPrice.toFixed(2),
      netToPayout: netToPayout.toFixed(2),
    };

    rows.push(row);
  }

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
 * Format date as MM/DD/YYYY
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Generate CSV string from rows
 *
 * Format:
 * - Header row with column names
 * - Data rows (one per order)
 *
 * CSV escaping:
 * - Quote fields containing commas, quotes, or newlines
 * - Escape quotes by doubling them
 */
function generateCSV(rows: PayoutsWithOrdersRow[]): string {
  const lines: string[] = [];

  // Header row
  const headers = [
    'Payout ID',
    'Payout Date',
    'Payout Amount',
    'Order Name',
    'Order Date',
    'Order Total',
    'Net to Payout',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.payoutId,
      row.payoutDate,
      row.payoutAmount,
      row.orderName,
      row.orderDate,
      row.orderTotal,
      row.netToPayout,
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
