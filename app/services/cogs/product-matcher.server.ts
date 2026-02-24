import type { OrderLineItem } from '../../types/journal-entry';

/**
 * Product Matcher
 *
 * Extracts SKUs from Shopify line items and matches them to Cin7 products.
 */

/**
 * Extract SKU from a Shopify line item
 *
 * @param lineItem - Shopify order line item
 * @returns SKU string, or null if not found
 */
export function extractSkuFromLineItem(lineItem: OrderLineItem): string | null {
  // Check for SKU in line item properties
  const sku = lineItem.sku;

  if (sku && typeof sku === 'string' && sku.trim().length > 0) {
    return sku.trim();
  }

  return null;
}

/**
 * Extract all unique SKUs from order line items
 *
 * @param lineItems - Array of order line items
 * @returns Array of unique SKUs
 */
export function extractSkusFromOrder(lineItems: OrderLineItem[]): string[] {
  const skus = new Set<string>();

  for (const lineItem of lineItems) {
    const sku = extractSkuFromLineItem(lineItem);
    if (sku) {
      skus.add(sku);
    }
  }

  return Array.from(skus);
}

/**
 * Validate SKU format
 *
 * @param sku - SKU to validate
 * @returns True if valid
 */
export function isValidSku(sku: string): boolean {
  if (!sku || typeof sku !== 'string') {
    return false;
  }

  const trimmed = sku.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Basic validation - no strict format required
  return true;
}
