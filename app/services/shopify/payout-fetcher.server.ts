import { Decimal } from 'decimal.js';
import type { Payout } from '../../types/journal-entry';
import { retryShopifyAPI } from '../../utils/retry';

/**
 * Fetch payouts for a specific date range
 * This is the ENTRY POINT for payout-first reconciliation
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param startDate - Start date (ISO format: YYYY-MM-DD)
 * @param endDate - End date (ISO format: YYYY-MM-DD)
 * @returns Array of payouts that hit the bank during this period
 */
export async function fetchPayouts(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Payout[]> {
  const payouts: Payout[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  // Shopify Payments API endpoint for payouts
  const baseUrl = `https://${shop}/admin/api/2024-10/shopify_payments/payouts.json`;

  while (hasNextPage) {
    const params = new URLSearchParams({
      date_min: startDate,
      date_max: endDate,
      status: 'paid', // Only get paid payouts (what actually hit bank)
      limit: '250', // Max limit
    });

    if (cursor) {
      params.set('since_id', cursor);
    }

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await retryShopifyAPI(
        () => fetch(url, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        }),
        'Fetch Payouts'
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch payouts: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.payouts && Array.isArray(data.payouts)) {
        for (const payout of data.payouts) {
          payouts.push({
            id: payout.id.toString(),
            status: payout.status,
            date: payout.date,
            amount: new Decimal(payout.amount),
            currency: payout.currency,
          });
        }

        // Check for pagination
        if (data.payouts.length === 250) {
          // Get last payout ID for cursor
          const lastPayout = data.payouts[data.payouts.length - 1];
          cursor = lastPayout.id.toString();
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error('Error fetching payouts:', error);
      throw error;
    }
  }

  return payouts;
}

/**
 * Fetch a single payout by ID
 */
export async function fetchPayoutById(
  shop: string,
  accessToken: string,
  payoutId: string
): Promise<Payout | null> {
  const url = `https://${shop}/admin/api/2024-10/shopify_payments/payouts/${payoutId}.json`;

  try {
    const response = await retryShopifyAPI(
      () => fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }),
      'Fetch Payout by ID'
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch payout: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.payout) {
      return {
        id: data.payout.id.toString(),
        status: data.payout.status,
        date: data.payout.date,
        amount: new Decimal(data.payout.amount),
        currency: data.payout.currency,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching payout by ID:', error);
    throw error;
  }
}
