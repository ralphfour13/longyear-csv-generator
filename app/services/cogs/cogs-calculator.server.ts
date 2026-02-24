import { Decimal } from 'decimal.js';
import type { Order } from '../../types/journal-entry';
import type { CogsCalculation, CogsLineItem } from '../../types/cin7';
import { Cin7ProductService } from '../cin7/cin7-product-service.server';
import { extractSkuFromLineItem } from './product-matcher.server';

/**
 * COGS Calculator
 *
 * Calculates Cost of Goods Sold for orders using Cin7 product costs.
 * Handles missing SKUs and products with warnings.
 */

/**
 * Calculate COGS for an order
 *
 * @param shop - Shop domain
 * @param order - Shopify order
 * @returns COGS calculation with line items and warnings
 */
export async function calculateOrderCogs(
  shop: string,
  order: Order
): Promise<CogsCalculation> {
  const cin7Service = new Cin7ProductService(shop);
  await cin7Service.initialize();

  const calculation: CogsCalculation = {
    orderId: order.id,
    orderName: order.name,
    totalCogs: new Decimal(0),
    lineItems: [],
    warnings: [],
  };

  // Process each line item
  for (const lineItem of order.lineItems) {
    try {
      const sku = extractSkuFromLineItem(lineItem);

      if (!sku) {
        calculation.warnings.push(
          `⚠️ No SKU found for item: ${lineItem.title}`
        );
        continue;
      }

      const unitCost = await cin7Service.getProductCost(sku);

      if (unitCost === null) {
        calculation.warnings.push(
          `⚠️ COGS not found for Order ${order.name}: "${lineItem.title}" (SKU: ${sku})`
        );
        continue;
      }

      // Validate cost is positive
      if (unitCost.lessThan(0)) {
        calculation.warnings.push(
          `⚠️ Invalid cost for SKU ${sku}: ${unitCost.toFixed(2)} (negative)`
        );
        continue;
      }

      const totalCost = unitCost.times(lineItem.quantity);

      const cogsLineItem: CogsLineItem = {
        productTitle: lineItem.title,
        sku,
        quantity: lineItem.quantity,
        unitCost,
        totalCost,
      };

      calculation.lineItems.push(cogsLineItem);
      calculation.totalCogs = calculation.totalCogs.plus(totalCost);
    } catch (error) {
      calculation.warnings.push(
        `⚠️ Error calculating COGS for "${lineItem.title}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return calculation;
}

/**
 * Calculate COGS for multiple orders
 *
 * @param shop - Shop domain
 * @param orders - Array of orders
 * @returns Map of order ID to COGS calculation
 */
export async function calculateBatchCogs(
  shop: string,
  orders: Order[]
): Promise<Map<string, CogsCalculation>> {
  const results = new Map<string, CogsCalculation>();

  // Process orders sequentially to avoid overwhelming the API
  // Rate limiter will handle throttling
  for (const order of orders) {
    const calculation = await calculateOrderCogs(shop, order);
    results.set(order.id, calculation);
  }

  return results;
}
