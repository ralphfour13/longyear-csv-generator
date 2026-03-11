import { Decimal } from 'decimal.js';
import type { BalanceTransaction, FeeBreakdown } from '../../types/journal-entry';
import { retryShopifyAPI } from '../../utils/retry';

/**
 * Fetch balance transactions for a specific payout
 * These show the detailed breakdown of what's IN the payout
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param payoutId - Payout ID to fetch transactions for
 * @returns Array of balance transactions in the payout
 */
export async function fetchBalanceTransactions(
  shop: string,
  accessToken: string,
  payoutId: string
): Promise<BalanceTransaction[]> {
  const transactions: BalanceTransaction[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const baseUrl = `https://${shop}/admin/api/2024-10/shopify_payments/balance/transactions.json`;

  while (hasNextPage) {
    const params = new URLSearchParams({
      payout_id: payoutId,
      limit: '250',
    });

    if (cursor) {
      params.set('since_id', cursor);
    }

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const data = await retryShopifyAPI(async () => {
        const response = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to fetch balance transactions: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        return await response.json();
      });

      if (data.transactions && Array.isArray(data.transactions)) {
        for (const txn of data.transactions) {
          // Parse fee breakdown
          const feeBreakdown = parseFeeBreakdown(txn.fee, txn.fee_breakdown);

          transactions.push({
            id: txn.id.toString(),
            type: txn.type,
            sourceOrderId: txn.source_order_id?.toString(),
            sourceType: txn.source_type,
            net: new Decimal(txn.net || 0),
            fee: new Decimal(txn.fee || 0),
            gross: new Decimal(txn.amount || 0), // 'amount' is gross
            currency: txn.currency,
            processedAt: txn.processed_at,
            feeBreakdown,
          });
        }

        // Check for pagination
        if (data.transactions.length === 250) {
          const lastTxn = data.transactions[data.transactions.length - 1];
          cursor = lastTxn.id.toString();
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error('Error fetching balance transactions:', error);
      throw error;
    }
  }

  return transactions;
}

/**
 * Parse fee breakdown from Shopify response
 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFeeBreakdown(totalFee: string | number, feeBreakdownData?: any): FeeBreakdown {
  const total = new Decimal(totalFee || 0);

  // If Shopify provides detailed fee breakdown, parse it
  if (feeBreakdownData && typeof feeBreakdownData === 'object') {
    return {
      shopifyFee: new Decimal(feeBreakdownData.shopify_fee || 0),
      gatewayFee: new Decimal(feeBreakdownData.gateway_fee || 0),
      chargebackFee: new Decimal(feeBreakdownData.chargeback_fee || 0),
      otherFees: new Decimal(feeBreakdownData.other_fees || 0),
      total,
    };
  }

  // Default: assume all fees are payment processing
  return {
    shopifyFee: new Decimal(0),
    gatewayFee: total, // Assume it's all gateway fees if no breakdown
    chargebackFee: new Decimal(0),
    otherFees: new Decimal(0),
    total,
  };
}

/**
 * Fetch balance transactions for a date range (alternative method)
 * Useful when not filtering by payout
 */
export async function fetchBalanceTransactionsByDate(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<BalanceTransaction[]> {
  const transactions: BalanceTransaction[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const baseUrl = `https://${shop}/admin/api/2024-10/shopify_payments/balance/transactions.json`;

  while (hasNextPage) {
    const params = new URLSearchParams({
      payout_date_min: startDate,
      payout_date_max: endDate,
      limit: '250',
    });

    if (cursor) {
      params.set('since_id', cursor);
    }

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const data = await retryShopifyAPI(async () => {
        const response = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to fetch balance transactions: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        return await response.json();
      });

      if (data.transactions && Array.isArray(data.transactions)) {
        for (const txn of data.transactions) {
          const feeBreakdown = parseFeeBreakdown(txn.fee, txn.fee_breakdown);

          transactions.push({
            id: txn.id.toString(),
            type: txn.type,
            sourceOrderId: txn.source_order_id?.toString(),
            sourceType: txn.source_type,
            net: new Decimal(txn.net || 0),
            fee: new Decimal(txn.fee || 0),
            gross: new Decimal(txn.amount || 0),
            currency: txn.currency,
            processedAt: txn.processed_at,
            feeBreakdown,
          });
        }

        if (data.transactions.length === 250) {
          const lastTxn = data.transactions[data.transactions.length - 1];
          cursor = lastTxn.id.toString();
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error('Error fetching balance transactions by date:', error);
      throw error;
    }
  }

  return transactions;
}
