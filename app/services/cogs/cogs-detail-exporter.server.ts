import type { Order } from '../../types/journal-entry';
import type { CogsCalculation, CogsDetailEntry } from '../../types/cin7';

/**
 * COGS Detail Exporter
 *
 * Generates detailed COGS CSV file with product-level breakdown.
 *
 * CSV format:
 * Order Number,Capture Date,Product Title,SKU,Quantity,Unit Cost,Total Cost,Order Total COGS
 *
 * Note: "Capture Date" represents the date payments were captured (target export date),
 * not the order creation date. This aligns with the journal entry date.
 */

/**
 * Generate COGS detail CSV content
 *
 * @param orders - Array of orders
 * @param cogsDataMap - Map of order ID to COGS calculation
 * @param targetDate - Target capture date (YYYY-MM-DD format)
 * @returns CSV content as string
 */
export function generateCogsDetailCSV(
  orders: Order[],
  cogsDataMap: Map<string, CogsCalculation>,
  targetDate: string
): string {
  const rows: string[] = [];

  // Header row
  rows.push(
    'Order Number,Capture Date,Product Title,SKU,Quantity,Unit Cost,Total Cost,Order Total COGS'
  );

  // Data rows
  for (const order of orders) {
    const cogsData = cogsDataMap.get(order.id);

    if (!cogsData || cogsData.lineItems.length === 0) {
      continue;
    }

    // Use target capture date (not order creation date) for alignment with journal entries
    const captureDate = formatDate(targetDate);
    const orderTotalCogs = cogsData.totalCogs.toFixed(2);

    for (const lineItem of cogsData.lineItems) {
      const entry: CogsDetailEntry = {
        orderNumber: order.name,
        orderDate: captureDate, // Now represents capture date, not creation date
        productTitle: escapeCSV(lineItem.productTitle),
        sku: lineItem.sku,
        quantity: lineItem.quantity,
        unitCost: lineItem.unitCost.toFixed(2),
        totalCost: lineItem.totalCost.toFixed(2),
        orderTotalCogs,
      };

      rows.push(
        [
          entry.orderNumber,
          entry.orderDate,
          entry.productTitle,
          entry.sku,
          entry.quantity,
          entry.unitCost,
          entry.totalCost,
          entry.orderTotalCogs,
        ].join(',')
      );
    }
  }

  return rows.join('\n');
}

/**
 * Format date to MM/DD/YYYY
 * Accepts either ISO date string (YYYY-MM-DDTHH:mm:ss) or simple date (YYYY-MM-DD)
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCSV(value: string): string {
  if (!value) {
    return '';
  }

  // If contains comma, quote, or newline - wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}
