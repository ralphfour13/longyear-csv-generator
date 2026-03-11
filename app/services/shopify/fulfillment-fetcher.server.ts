import type { OrderLineItem } from '../../types/journal-entry';
import { retryShopifyAPI } from '../../utils/retry';

/**
 * Fulfillment line item data from Shopify
 * Represents items that were actually shipped/fulfilled
 */
export interface FulfilledLineItem {
  lineItemId: string; // Maps to OrderLineItem.id
  sku?: string;
  quantity: number; // Quantity fulfilled (may be less than ordered)
  productTitle: string;
}

/**
 * Shopify fulfillment API response types
 */
interface ShopifyFulfillmentLineItem {
  id: number;
  variant_id: number;
  title: string;
  quantity: number;
  sku?: string;
  variant_title?: string;
  name: string;
}

interface ShopifyFulfillment {
  id: number;
  order_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  tracking_company?: string;
  tracking_number?: string;
  line_items: ShopifyFulfillmentLineItem[];
}

interface ShopifyFulfillmentsResponse {
  fulfillments: ShopifyFulfillment[];
}

/**
 * Fetch fulfillment data for an order from Shopify
 * Returns only items that were actually shipped (not removed/cancelled)
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderId - Order ID to fetch fulfillments for
 * @returns Array of fulfilled line items
 */
export async function fetchFulfilledLineItems(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<FulfilledLineItem[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/fulfillments.json`;

  try {
    return await retryShopifyAPI(async () => {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Order exists but has no fulfillments yet
          console.log(`Order ${orderId} has no fulfillments yet`);
          return [];
        }
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch fulfillments for order ${orderId}: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: ShopifyFulfillmentsResponse = await response.json();

      if (!data.fulfillments || data.fulfillments.length === 0) {
        console.log(`Order ${orderId} has no fulfillments`);
        return [];
      }

      // Extract line items from all fulfillments and aggregate by line item ID
      const fulfilledItemsMap = new Map<string, FulfilledLineItem>();

      for (const fulfillment of data.fulfillments) {
        // Only include successful fulfillments
        if (fulfillment.status === 'cancelled' || fulfillment.status === 'error') {
          console.log(
            `Skipping ${fulfillment.status} fulfillment ${fulfillment.id} for order ${orderId}`
          );
          continue;
        }

        for (const item of fulfillment.line_items) {
          const lineItemId = item.id.toString();
          const existingItem = fulfilledItemsMap.get(lineItemId);

          if (existingItem) {
            // Item was fulfilled in multiple shipments - sum quantities
            existingItem.quantity += item.quantity;
          } else {
            fulfilledItemsMap.set(lineItemId, {
              lineItemId,
              sku: item.sku,
              quantity: item.quantity,
              productTitle: item.name,
            });
          }
        }
      }

      const fulfilledItems = Array.from(fulfilledItemsMap.values());

      console.log(
        `📦 Order ${orderId}: Found ${fulfilledItems.length} fulfilled line items from ${data.fulfillments.length} fulfillment(s)`
      );

      return fulfilledItems;
    });
  } catch (error) {
    console.error(`Error fetching fulfillments for order ${orderId}:`, error);
    throw error;
  }
}

/**
 * Filter order line items to only include fulfilled items
 * Maps fulfillment data back to original order line items
 *
 * @param orderLineItems - All line items from the order
 * @param fulfilledItems - Fulfilled items from fetchFulfilledLineItems
 * @returns Filtered array of order line items that were fulfilled
 */
export function filterToFulfilledItems(
  orderLineItems: OrderLineItem[],
  fulfilledItems: FulfilledLineItem[]
): OrderLineItem[] {
  if (fulfilledItems.length === 0) {
    return [];
  }

  const fulfilledMap = new Map<string, FulfilledLineItem>(
    fulfilledItems.map(item => [item.lineItemId, item])
  );

  const filtered = orderLineItems.filter(lineItem => fulfilledMap.has(lineItem.id));

  return filtered;
}

/**
 * Get quantity comparison between ordered and fulfilled
 * Useful for detecting removed items
 *
 * @param orderLineItems - All line items from the order
 * @param fulfilledItems - Fulfilled items from fetchFulfilledLineItems
 * @returns Array of items with quantity comparison
 */
export interface LineItemQuantityComparison {
  lineItemId: string;
  sku?: string;
  title: string;
  orderedQuantity: number;
  fulfilledQuantity: number;
  isPartiallyFulfilled: boolean;
  isRemoved: boolean;
}

export function compareOrderedVsFulfilled(
  orderLineItems: OrderLineItem[],
  fulfilledItems: FulfilledLineItem[]
): LineItemQuantityComparison[] {
  const fulfilledMap = new Map<string, FulfilledLineItem>(
    fulfilledItems.map(item => [item.lineItemId, item])
  );

  return orderLineItems.map(lineItem => {
    const fulfilled = fulfilledMap.get(lineItem.id);
    const fulfilledQuantity = fulfilled?.quantity || 0;
    const orderedQuantity = lineItem.quantity;

    return {
      lineItemId: lineItem.id,
      sku: lineItem.sku,
      title: lineItem.title,
      orderedQuantity,
      fulfilledQuantity,
      isPartiallyFulfilled: fulfilledQuantity > 0 && fulfilledQuantity < orderedQuantity,
      isRemoved: fulfilledQuantity === 0,
    };
  });
}
