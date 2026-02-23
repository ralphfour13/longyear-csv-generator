import { Decimal } from 'decimal.js';
import type { Order, OrderLineItem } from '../../types/journal-entry';

/**
 * Fetch order details by order ID
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderId - Order ID to fetch
 * @returns Order details with line items
 */
export async function fetchOrderById(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<Order | null> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}.json`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch order: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();

    if (data.order) {
      return parseOrder(data.order);
    }

    return null;
  } catch (error) {
    console.error(`Error fetching order ${orderId}:`, error);
    throw error;
  }
}

/**
 * Fetch multiple orders by IDs (batch)
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderIds - Array of order IDs
 * @returns Array of orders
 */
export async function fetchOrdersByIds(
  shop: string,
  accessToken: string,
  orderIds: string[]
): Promise<Order[]> {
  const orders: Order[] = [];

  // Shopify doesn't support batch fetching by ID, so we fetch individually
  // In production, consider using GraphQL for better performance
  for (const orderId of orderIds) {
    try {
      const order = await fetchOrderById(shop, accessToken, orderId);
      if (order) {
        orders.push(order);
      }
    } catch (error) {
      console.error(`Failed to fetch order ${orderId}:`, error);
      // Continue with other orders even if one fails
    }
  }

  return orders;
}

/**
 * Parse Shopify order API response into our Order type
 */
function parseOrder(orderData: any): Order {
  // Parse line items
  const lineItems: OrderLineItem[] = (orderData.line_items || []).map((item: any) => ({
    id: item.id.toString(),
    productId: item.product_id?.toString() || '',
    variantId: item.variant_id?.toString() || '',
    title: item.title,
    quantity: item.quantity,
    price: new Decimal(item.price),
    totalDiscount: new Decimal(item.total_discount || 0),
    taxable: item.taxable,
    taxes: (item.tax_lines || []).map((tax: any) => ({
      title: tax.title,
      rate: parseFloat(tax.rate),
      price: new Decimal(tax.price),
    })),
  }));

  // Calculate shipping total
  const shippingLines = orderData.shipping_lines || [];
  const totalShipping = shippingLines.reduce(
    (sum: Decimal, line: any) => sum.plus(new Decimal(line.price || 0)),
    new Decimal(0)
  );

  return {
    id: orderData.id.toString(),
    orderNumber: orderData.order_number,
    name: orderData.name,
    createdAt: orderData.created_at,
    totalPrice: new Decimal(orderData.total_price),
    subtotalPrice: new Decimal(orderData.subtotal_price),
    currentSubtotalPrice: orderData.current_subtotal_price
      ? new Decimal(orderData.current_subtotal_price)
      : undefined,
    currentTotalDiscounts: orderData.current_total_discounts
      ? new Decimal(orderData.current_total_discounts)
      : undefined,
    currentTotalPrice: orderData.current_total_price
      ? new Decimal(orderData.current_total_price)
      : undefined,
    totalTax: new Decimal(orderData.total_tax || 0),
    totalShipping,
    totalDiscounts: new Decimal(orderData.total_discounts || 0),
    currency: orderData.currency,
    financialStatus: orderData.financial_status,
    lineItems,
  };
}

/**
 * Fetch orders for a date range
 * Useful for reconciliation and reporting
 */
export async function fetchOrdersByDateRange(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Order[]> {
  const orders: Order[] = [];
  let hasNextPage = true;
  let pageInfo: string | null = null;

  const baseUrl = `https://${shop}/admin/api/2024-10/orders.json`;

  while (hasNextPage) {
    const params = new URLSearchParams({
      created_at_min: startDate,
      created_at_max: endDate,
      status: 'any',
      limit: '250',
    });

    if (pageInfo) {
      params.set('page_info', pageInfo);
    }

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch orders: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.orders && Array.isArray(data.orders)) {
        for (const orderData of data.orders) {
          orders.push(parseOrder(orderData));
        }

        // Check for Link header for pagination
        const linkHeader = response.headers.get('Link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          // Extract page_info from Link header
          const match = linkHeader.match(/page_info=([^&>]+)/);
          if (match) {
            pageInfo = match[1];
          } else {
            hasNextPage = false;
          }
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error('Error fetching orders by date range:', error);
      throw error;
    }
  }

  return orders;
}
