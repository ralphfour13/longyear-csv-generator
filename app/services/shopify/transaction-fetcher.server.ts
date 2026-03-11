import { Decimal } from 'decimal.js';
import type { Transaction, TransactionFee } from '../../types/journal-entry';
import { retryShopifyAPI } from '../../utils/retry';

/**
 * Fetch transactions for a specific order
 * Includes payment details and fee breakdown
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param orderId - Order ID
 * @returns Array of transactions for the order
 */
export async function fetchOrderTransactions(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<Transaction[]> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions.json`;

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
          return [];
        }
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch transactions: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.transactions && Array.isArray(data.transactions)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.transactions.map((txn: any) => parseTransaction(txn));
      }

      return [];
    });
  } catch (error) {
    console.error(`Error fetching transactions for order ${orderId}:`, error);
    throw error;
  }
}

/**
 * Parse transaction data from Shopify API
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTransaction(txnData: any): Transaction {
  // Parse fee breakdown from receipt or payment_details
  const fees = parseFees(txnData);

  return {
    id: txnData.id.toString(),
    orderId: txnData.order_id?.toString() || '',
    kind: txnData.kind,
    gateway: txnData.gateway,
    status: txnData.status,
    amount: new Decimal(txnData.amount),
    currency: txnData.currency,
    processedAt: txnData.processed_at,
    fees,
  };
}

/**
 * Parse fee details from transaction
 * Different gateways may return fees in different formats
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFees(txnData: any): TransactionFee[] {
  const fees: TransactionFee[] = [];

  // Check for Shopify Payments receipt
  if (txnData.receipt && typeof txnData.receipt === 'object') {
    const receipt = txnData.receipt;

    // Shopify fee
    if (receipt.shopify_fee) {
      fees.push({
        type: 'shopify_fee',
        amount: new Decimal(receipt.shopify_fee),
        currency: txnData.currency,
      });
    }

    // Gateway fee
    if (receipt.processing_fee || receipt.gateway_fee) {
      fees.push({
        type: 'gateway_fee',
        amount: new Decimal(receipt.processing_fee || receipt.gateway_fee),
        currency: txnData.currency,
      });
    }

    // Chargeback fee
    if (receipt.chargeback_fee) {
      fees.push({
        type: 'chargeback_fee',
        amount: new Decimal(receipt.chargeback_fee),
        currency: txnData.currency,
      });
    }
  }

  // Check for payment_details (alternative format)
  if (txnData.payment_details && typeof txnData.payment_details === 'object') {
    const details = txnData.payment_details;

    if (details.shopify_payments_fee) {
      fees.push({
        type: 'shopify_fee',
        amount: new Decimal(details.shopify_payments_fee),
        currency: txnData.currency,
      });
    }

    if (details.gateway_fee) {
      fees.push({
        type: 'gateway_fee',
        amount: new Decimal(details.gateway_fee),
        currency: txnData.currency,
      });
    }
  }

  return fees;
}

/**
 * Fetch a single transaction by ID
 */
export async function fetchTransactionById(
  shop: string,
  accessToken: string,
  orderId: string,
  transactionId: string
): Promise<Transaction | null> {
  const url = `https://${shop}/admin/api/2024-10/orders/${orderId}/transactions/${transactionId}.json`;

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
          return null;
        }
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch transaction: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      if (data.transaction) {
        return parseTransaction(data.transaction);
      }

      return null;
    });
  } catch (error) {
    console.error(`Error fetching transaction ${transactionId}:`, error);
    throw error;
  }
}

/**
 * Calculate total fees for an array of transactions
 */
export function calculateTotalFees(transactions: Transaction[]): Decimal {
  return transactions.reduce((total, txn) => {
    const txnFees = txn.fees.reduce(
      (sum, fee) => sum.plus(fee.amount),
      new Decimal(0)
    );
    return total.plus(txnFees);
  }, new Decimal(0));
}
