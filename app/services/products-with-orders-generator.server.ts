import { Decimal } from 'decimal.js';
import type { EnrichedTransaction } from '../types/journal-entry';
import {
  getPayoutOrders,
  GL_ACCOUNT_METAFIELD_NAMESPACE,
  GL_ACCOUNT_METAFIELD_KEY,
} from './payouts-with-orders-generator.server';
import {
  fetchVariantDetailsBySkus,
  fetchProductMetafieldBySkus,
} from './shopify/product-cost-updater.server';

/**
 * Products with Orders Row — Sage 50 inventory/item master layout.
 *
 * ONE ROW PER UNIQUE SKU sold in the selected orders. Catalog fields (price,
 * weight, on-hand inventory, unit cost) come from the live Shopify product/variant.
 */
interface ProductsWithOrdersRow {
  itemId: string;            // product.variants.sku
  description: string;       // product.title
  glAccount: string;         // custom mapping (SKU category) — TODO: not yet sourced
  inventoryAccount: string;  // static config OR location mapping — TODO: not yet sourced
  quantity: string;          // inventory_level.available
  stockingQuantity: string;  // inventory_level.available
  unitPrice: string;         // variant.price
  upcSku: string;            // variant.sku
  weight: string;            // variant.weight
  costOfSalesAccount: string;// custom mapping — TODO: not yet sourced
  costOfSalesAmount: string; // Shopify variant unit cost ("Cost per item"), else 0
}

/**
 * Generate Products with Orders CSV (Sage 50 inventory/item master)
 *
 * One row per UNIQUE SKU sold across the selected day's orders (deduped,
 * case-insensitive). The order set is sourced from the shared `getPayoutOrders()`
 * selector, so it stays in lockstep with the Payouts with Orders file. Catalog
 * fields are fetched live from Shopify per SKU.
 *
 * Column → source mapping:
 *  1. Item ID               ← product.variants.sku
 *  2. Description           ← product.title
 *  3. G/L Account           ← custom mapping (SKU category) — left blank (not sourced)
 *  4. Inventory Account     ← static config OR location mapping — left blank (not sourced)
 *  5. Quantity              ← inventory_level.available
 *  6. Stocking Quantity     ← inventory_level.available
 *  7. Unit Price            ← variant.price
 *  8. UPC / SKU             ← variant.sku
 *  9. Weight                ← variant.weight
 * 10. Cost of Sales Account ← custom mapping — left blank (not sourced)
 * 11. Cost of Sales Amount  ← Shopify variant unit cost, else 0
 *
 * @param shop - Shop domain (for the Shopify variant lookup)
 * @param accessToken - Shopify access token
 * @param enrichedTransactions - Array of enriched transactions from reconciliation
 * @returns CSV string
 */
export async function generateProductsWithOrders(
  shop: string,
  accessToken: string,
  enrichedTransactions: EnrichedTransaction[]
): Promise<string> {
  const orders = getPayoutOrders(enrichedTransactions);

  // Collect unique SKUs sold (case-insensitive), preserving first-seen casing and a
  // fallback description from the line item in case the variant lookup misses.
  const skusInOrder: string[] = [];
  const seen = new Set<string>();
  const fallbackTitle = new Map<string, string>();

  for (const order of orders) {
    for (const item of order.lineItems) {
      const sku = (item.sku || '').trim();
      if (!sku) {
        continue; // no SKU → cannot key an inventory item; skip
      }
      const key = sku.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        skusInOrder.push(sku);
        fallbackTitle.set(key, item.title);
      }
    }
  }

  // Fetch live catalog detail (price, weight, on-hand inventory, unit cost) per SKU,
  // plus the DonorPerfect G/L Account product metafield (same source as the income file).
  const [details, glAccountBySku] =
    skusInOrder.length > 0
      ? await Promise.all([
          fetchVariantDetailsBySkus(shop, accessToken, skusInOrder),
          fetchProductMetafieldBySkus(
            shop,
            accessToken,
            skusInOrder,
            GL_ACCOUNT_METAFIELD_NAMESPACE,
            GL_ACCOUNT_METAFIELD_KEY
          ),
        ])
      : [new Map(), new Map<string, string>()];

  const rows: ProductsWithOrdersRow[] = skusInOrder.map((sku) => {
    const key = sku.toLowerCase();
    const d = details.get(key);

    const available = d?.inventoryAvailable != null ? String(d.inventoryAvailable) : '';
    const unitPrice = d?.price != null ? new Decimal(d.price).toFixed(2) : '';
    const weight = d?.weight != null ? String(d.weight) : '';
    const costOfSalesAmount = d?.unitCost != null ? new Decimal(d.unitCost).toFixed(2) : '0.00';
    const description = d?.productTitle || fallbackTitle.get(key) || '';

    return {
      itemId: sku,
      description,
      glAccount: glAccountBySku.get(key) || '',
      inventoryAccount: '', // TODO: source from static config OR location mapping
      quantity: available,
      stockingQuantity: available,
      unitPrice,
      upcSku: sku,
      weight,
      costOfSalesAccount: '', // TODO: source from custom mapping
      costOfSalesAmount,
    };
  });

  return generateCSV(rows);
}

/**
 * Generate CSV string from rows
 *
 * Format:
 * - Header row with column names
 * - Data rows (one per unique SKU)
 *
 * CSV escaping:
 * - Quote fields containing commas, quotes, or newlines
 * - Escape quotes by doubling them
 */
function generateCSV(rows: ProductsWithOrdersRow[]): string {
  const lines: string[] = [];

  // Header row — must stay in sync (count + order) with the fields array below.
  const headers = [
    'Item ID',
    'Description',
    'G/L Account',
    'Inventory Account',
    'Quantity',
    'Stocking Quantity',
    'Unit Price',
    'UPC / SKU',
    'Weight',
    'Cost of Sales Account',
    'Cost of Sales Amount',
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = [
      row.itemId,
      row.description,
      row.glAccount,
      row.inventoryAccount,
      row.quantity,
      row.stockingQuantity,
      row.unitPrice,
      row.upcSku,
      row.weight,
      row.costOfSalesAccount,
      row.costOfSalesAmount,
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
