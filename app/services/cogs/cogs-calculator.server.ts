import { Decimal } from 'decimal.js';
import type { Order, OrderLineItem } from '../../types/journal-entry';
import type { CogsCalculation, CogsLineItem } from '../../types/cin7';
import { Cin7ProductService } from '../cin7/cin7-product-service.server';
import { extractSkuFromLineItem } from './product-matcher.server';
import {
  fetchFulfilledLineItems,
  filterToFulfilledItems,
} from '../shopify/fulfillment-fetcher.server';

/**
 * COGS Calculator
 *
 * Calculates Cost of Goods Sold for orders using Cin7 product costs.
 * Handles missing SKUs and products with warnings.
 *
 * NEW: Now supports fulfillment-based calculation to exclude removed items.
 */

/**
 * Calculate COGS for an order using pre-initialized service (optimized)
 *
 * This is the optimized version that reuses a service instance.
 * Use this when calculating COGS for multiple orders to avoid initialization overhead.
 *
 * @param cin7Service - Pre-initialized Cin7ProductService instance
 * @param order - Shopify order
 * @param shop - Shop domain (required for fulfillment filtering)
 * @param accessToken - Shopify access token (required for fulfillment filtering)
 * @param useFulfillments - If true, only calculate COGS for fulfilled items (default: true)
 * @returns COGS calculation with line items and warnings
 */
export async function calculateOrderCogsWithService(
  cin7Service: Cin7ProductService,
  order: Order,
  shop?: string,
  accessToken?: string,
  useFulfillments: boolean = true
): Promise<CogsCalculation> {

  const calculation: CogsCalculation = {
    orderId: order.id,
    orderName: order.name,
    totalCogs: new Decimal(0),
    lineItems: [],
    warnings: [],
  };

  // Determine which line items to process
  let itemsToProcess: OrderLineItem[];

  if (useFulfillments && shop && accessToken) {
    // NEW: Use only fulfilled items
    try {
      const fulfilledItems = await fetchFulfilledLineItems(shop, accessToken, order.id);
      itemsToProcess = filterToFulfilledItems(order.lineItems, fulfilledItems);

      console.log(
        `📦 Order ${order.name}: Using ${itemsToProcess.length} fulfilled items ` +
        `(${order.lineItems.length} total ordered, ${order.lineItems.length - itemsToProcess.length} removed/unfulfilled)`
      );
    } catch (error) {
      console.error(
        `⚠️ Failed to fetch fulfillments for order ${order.name}, falling back to all line items:`,
        error
      );
      calculation.warnings.push(
        `⚠️ Could not verify fulfillments - using all line items as fallback`
      );
      itemsToProcess = order.lineItems;
    }
  } else {
    // Fallback: Use all line items (legacy behavior)
    itemsToProcess = order.lineItems;
    if (useFulfillments) {
      console.log(
        `⚠️ Order ${order.name}: Fulfillment filtering requested but shop/accessToken not provided, using all line items`
      );
    }
  }

  // DIAGNOSTIC: Log order details for COGS investigation
  console.log(
    `📊 COGS Debug - Order ${order.name}:\n` +
    `  Line Items to Process: ${itemsToProcess.length}\n` +
    `  SKUs: ${itemsToProcess.map(i => i.sku || 'NO_SKU').join(', ')}\n` +
    `  Financial Status: ${order.financialStatus}\n` +
    `  Using Fulfillments: ${useFulfillments && shop && accessToken ? 'YES' : 'NO'}`
  );

  // Process each line item
  for (const lineItem of itemsToProcess) {
    try {
      const sku = extractSkuFromLineItem(lineItem);

      if (!sku) {
        calculation.warnings.push(
          `⚠️ No SKU found for item: ${lineItem.title} (Qty: ${lineItem.quantity})`
        );
        console.log(
          `  ❌ Line Item Missing SKU: "${lineItem.title}" x${lineItem.quantity}`
        );
        continue;
      }

      const unitCost = await cin7Service.getProductCost(sku);

      if (unitCost === null) {
        calculation.warnings.push(
          `⚠️ COGS not found for Order ${order.name}: "${lineItem.title}" (SKU: ${sku}, Qty: ${lineItem.quantity})`
        );
        console.log(
          `  ❌ COGS Not Found in Cin7: SKU "${sku}" - "${lineItem.title}" x${lineItem.quantity}`
        );
        continue;
      }

      // Log successful COGS lookup for verification
      console.log(
        `  ✓ COGS Found: SKU "${sku}" - $${unitCost.toFixed(2)} x${lineItem.quantity} = $${unitCost.times(lineItem.quantity).toFixed(2)}`
      );

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
 * Calculate COGS for an order (backward compatible)
 *
 * This function creates a new service instance for each call.
 * For better performance with multiple orders, use calculateOrderCogsWithService()
 * with a shared service instance.
 *
 * @param shop - Shop domain
 * @param order - Shopify order
 * @param accessToken - Shopify access token (optional, for fulfillment filtering)
 * @param useFulfillments - If true, only calculate COGS for fulfilled items (default: true)
 * @returns COGS calculation with line items and warnings
 */
export async function calculateOrderCogs(
  shop: string,
  order: Order,
  accessToken?: string,
  useFulfillments: boolean = true
): Promise<CogsCalculation> {
  const cin7Service = new Cin7ProductService(shop);
  await cin7Service.initialize();
  return calculateOrderCogsWithService(cin7Service, order, shop, accessToken, useFulfillments);
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
