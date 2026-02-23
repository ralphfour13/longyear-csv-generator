import { Decimal } from 'decimal.js';
import type {
  Payout,
  BalanceTransaction,
  Order,
  ReconciliationResult,
  JournalEntry,
  EnrichedTransaction,
} from '../types/journal-entry';
import { fetchBalanceTransactions } from './shopify/balance-transaction-fetcher.server';
import { fetchOrderById } from './shopify/order-fetcher.server';
import { fetchOrderTransactions } from './shopify/transaction-fetcher.server';
import { enrichOrderData } from './enrichment/order-enrichment.server';

/**
 * Payout-First Reconciliation Engine
 *
 * CRITICAL: Each SO- reference MUST balance internally (debits = credits)
 * AR debit MUST equal the sum of Sales + Tax + Shipping credits
 *
 * @param targetDate - Optional: filter transactions to this capture date (YYYY-MM-DD)
 */
export async function reconcilePayout(
  shop: string,
  accessToken: string,
  payout: Payout,
  targetDate?: string
): Promise<ReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const journalEntries: JournalEntry[] = [];
  const enrichedTransactions: EnrichedTransaction[] = []; // NEW: Collect enriched transactions

  try {
    console.log(`Fetching balance transactions for payout ${payout.id}...`);
    const balanceTransactions = await fetchBalanceTransactions(
      shop,
      accessToken,
      payout.id
    );

    console.log(`Found ${balanceTransactions.length} balance transactions`);

    // Filter by target date if provided (filter by capture date)
    const filteredTransactions = targetDate
      ? balanceTransactions.filter((txn) => {
          const txnDate = formatDateOnly(txn.processedAt);
          return txnDate === targetDate;
        })
      : balanceTransactions;

    if (targetDate && filteredTransactions.length < balanceTransactions.length) {
      console.log(
        `Filtered to ${filteredTransactions.length} transactions matching ${targetDate} ` +
        `(${balanceTransactions.length - filteredTransactions.length} excluded)`
      );
    }

    // Track processed orders to prevent duplicates
    // (multiple balance transactions can reference the same order)
    const processedOrderIds = new Set<string>();

    for (const balanceTxn of filteredTransactions) {
      try {
        await processBalanceTransaction(
          shop,
          accessToken,
          balanceTxn,
          payout,
          journalEntries,
          enrichedTransactions, // NEW: Pass enriched transactions array
          warnings,
          errors,
          processedOrderIds
        );
      } catch (error) {
        errors.push(
          `Failed to process balance transaction ${balanceTxn.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Only add payout entries if there were filtered transactions
    // When filtering by target date, skip payouts with zero matching transactions
    if (!targetDate || filteredTransactions.length > 0) {
      // Add payout cash entry (final debit to bank account)
      journalEntries.push({
        date: formatDate(payout.date),
        reference: `PO-${payout.id}`,
        account: '1000-00',
        accountName: 'Cash - Shopify Account',
        debit: payout.amount,
        credit: new Decimal(0),
        memo: `Shopify Payout ${payout.id}`,
      });

      // Add corresponding AR credit to clear the clearing account
      journalEntries.push({
        date: formatDate(payout.date),
        reference: `PO-${payout.id}`,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: payout.amount,
        memo: `Payout Clearing`,
      });
    }

    // Calculate totals and validate balance
    const totalDebit = journalEntries.reduce(
      (sum, entry) => sum.plus(entry.debit),
      new Decimal(0)
    );
    const totalCredit = journalEntries.reduce(
      (sum, entry) => sum.plus(entry.credit),
      new Decimal(0)
    );

    const balanced = totalDebit.equals(totalCredit);

    if (!balanced) {
      const difference = totalDebit.minus(totalCredit);
      errors.push(
        `Journal entries do not balance. Difference: ${difference.toFixed(2)} ` +
          `(Debit: ${totalDebit.toFixed(2)}, Credit: ${totalCredit.toFixed(2)})`
      );
    }

    const clearingTotal = journalEntries
      .filter((entry) => entry.account === '1250-00' && entry.credit.greaterThan(0))
      .reduce((sum, entry) => sum.plus(entry.credit), new Decimal(0));

    if (!clearingTotal.equals(payout.amount)) {
      warnings.push(
        `Clearing account credits (${clearingTotal.toFixed(2)}) do not equal payout amount (${payout.amount.toFixed(2)})`
      );
    }

    return {
      payout,
      journalEntries,
      enrichedTransactions, // NEW: Include enriched transactions
      totalDebit,
      totalCredit,
      balanced,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );

    return {
      payout,
      journalEntries,
      enrichedTransactions: [], // NEW: Empty array on failure
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      balanced: false,
      errors,
      warnings,
    };
  }
}

/**
 * Process a single balance transaction and create journal entries
 * Also builds EnrichedTransaction objects for multi-file exports
 */
async function processBalanceTransaction(
  shop: string,
  accessToken: string,
  balanceTxn: BalanceTransaction,
  payout: Payout,
  journalEntries: JournalEntry[],
  enrichedTransactions: EnrichedTransaction[], // NEW: Collect enriched transactions
  warnings: string[],
  errors: string[],
  processedOrderIds: Set<string>
): Promise<void> {
  const txnDate = formatDate(balanceTxn.processedAt);

  switch (balanceTxn.type) {
    case 'charge': {
      if (balanceTxn.sourceOrderId) {
        // Check if we've already processed this order
        if (processedOrderIds.has(balanceTxn.sourceOrderId)) {
          console.log(`Skipping duplicate order ${balanceTxn.sourceOrderId} (already processed)`);
          // Still process fees for this transaction
          createFeeEntries(balanceTxn, txnDate, journalEntries);
          break;
        }

        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          createOrderEntries(order, balanceTxn, journalEntries, errors);
          createFeeEntries(balanceTxn, txnDate, journalEntries);

          // NEW: Enrich order data and build EnrichedTransaction
          try {
            const enrichedData = await enrichOrderData(shop, accessToken, balanceTxn.sourceOrderId);

            enrichedTransactions.push({
              balanceTransaction: {
                id: balanceTxn.id,
                type: balanceTxn.type,
                sourceOrderId: balanceTxn.sourceOrderId,
                processedAt: balanceTxn.processedAt,
                net: balanceTxn.net,
                fee: balanceTxn.fee,
                gross: balanceTxn.gross,
              },
              order: {
                id: order.id,
                name: order.name,
                createdAt: order.createdAt,
                currentTotalPrice: order.currentTotalPrice || order.totalPrice,
                totalTax: order.totalTax,
                totalShipping: order.totalShipping,
                totalDiscounts: order.totalDiscounts,
                financialStatus: order.financialStatus,
              },
              enrichedData: enrichedData || undefined,
              payout: {
                id: payout.id,
                date: payout.date,
                amount: payout.amount,
              },
            });
          } catch (enrichError) {
            console.error(`Failed to enrich order ${balanceTxn.sourceOrderId}:`, enrichError);
            warnings.push(`Failed to enrich order ${balanceTxn.sourceOrderId} for export`);
          }

          // Mark this order as processed
          processedOrderIds.add(balanceTxn.sourceOrderId);
        } else {
          warnings.push(
            `Order ${balanceTxn.sourceOrderId} not found for balance transaction ${balanceTxn.id}`
          );

          journalEntries.push({
            date: txnDate,
            reference: `CHG-${balanceTxn.id}`,
            account: '1250-00',
            accountName: 'Shopify Clearing Account',
            debit: balanceTxn.gross,
            credit: new Decimal(0),
            memo: `Charge - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          journalEntries.push({
            date: txnDate,
            reference: `CHG-${balanceTxn.id}`,
            account: '4000-00',
            accountName: 'Sales Revenue',
            debit: new Decimal(0),
            credit: balanceTxn.gross,
            memo: `Sale - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          // NEW: Add enriched transaction even if order not found (minimal data)
          enrichedTransactions.push({
            balanceTransaction: {
              id: balanceTxn.id,
              type: balanceTxn.type,
              sourceOrderId: balanceTxn.sourceOrderId,
              processedAt: balanceTxn.processedAt,
              net: balanceTxn.net,
              fee: balanceTxn.fee,
              gross: balanceTxn.gross,
            },
            payout: {
              id: payout.id,
              date: payout.date,
              amount: payout.amount,
            },
          });
        }
      }
      break;
    }

    case 'refund': {
      if (balanceTxn.sourceOrderId) {
        // Note: We DON'T deduplicate refunds because each refund transaction
        // represents a separate refund event (partial refunds, etc.)
        const order = await fetchOrderById(shop, accessToken, balanceTxn.sourceOrderId);

        if (order) {
          createRefundEntries(order, balanceTxn, txnDate, journalEntries);

          // NEW: Enrich order data for refund transaction
          try {
            const enrichedData = await enrichOrderData(shop, accessToken, balanceTxn.sourceOrderId);

            enrichedTransactions.push({
              balanceTransaction: {
                id: balanceTxn.id,
                type: balanceTxn.type,
                sourceOrderId: balanceTxn.sourceOrderId,
                processedAt: balanceTxn.processedAt,
                net: balanceTxn.net,
                fee: balanceTxn.fee,
                gross: balanceTxn.gross,
              },
              order: {
                id: order.id,
                name: order.name,
                createdAt: order.createdAt,
                currentTotalPrice: order.currentTotalPrice || order.totalPrice,
                totalTax: order.totalTax,
                totalShipping: order.totalShipping,
                totalDiscounts: order.totalDiscounts,
                financialStatus: order.financialStatus,
              },
              enrichedData: enrichedData || undefined,
              payout: {
                id: payout.id,
                date: payout.date,
                amount: payout.amount,
              },
            });
          } catch (enrichError) {
            console.error(`Failed to enrich refund order ${balanceTxn.sourceOrderId}:`, enrichError);
            warnings.push(`Failed to enrich refund order ${balanceTxn.sourceOrderId} for export`);
          }
        } else {
          journalEntries.push({
            date: txnDate,
            reference: `RF-${balanceTxn.id}`,
            account: '4900-00',
            accountName: 'Sales Returns & Refunds',
            debit: balanceTxn.gross.abs(),
            credit: new Decimal(0),
            memo: `Refund - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          journalEntries.push({
            date: txnDate,
            reference: `RF-${balanceTxn.id}`,
            account: '1250-00',
            accountName: 'Shopify Clearing Account',
            debit: new Decimal(0),
            credit: balanceTxn.gross.abs(),
            memo: `Refund Clearing - Order ${balanceTxn.sourceOrderId || 'Unknown'}`,
          });

          // NEW: Add enriched transaction even if order not found
          enrichedTransactions.push({
            balanceTransaction: {
              id: balanceTxn.id,
              type: balanceTxn.type,
              sourceOrderId: balanceTxn.sourceOrderId,
              processedAt: balanceTxn.processedAt,
              net: balanceTxn.net,
              fee: balanceTxn.fee,
              gross: balanceTxn.gross,
            },
            payout: {
              id: payout.id,
              date: payout.date,
              amount: payout.amount,
            },
          });
        }
      }
      break;
    }

    case 'payout': {
      // Payout transaction within balance transactions (clearing to bank)
      // This represents the final settlement from clearing account to bank
      journalEntries.push({
        date: txnDate,
        reference: `PO-${balanceTxn.id}`,
        account: '1000-00',
        accountName: 'Cash - Shopify Account',
        debit: balanceTxn.net.abs(),
        credit: new Decimal(0),
        memo: `Bank Deposit - Payout`,
      });

      journalEntries.push({
        date: txnDate,
        reference: `PO-${balanceTxn.id}`,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.net.abs(),
        memo: `Clear to Bank`,
      });
      break;
    }

    case 'adjustment':
    case 'reserve': {
      journalEntries.push({
        date: txnDate,
        reference: `ADJ-${balanceTxn.id}`,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: balanceTxn.net.greaterThan(0) ? balanceTxn.net : new Decimal(0),
        credit: balanceTxn.net.lessThan(0) ? balanceTxn.net.abs() : new Decimal(0),
        memo: `${balanceTxn.type} - ${balanceTxn.sourceType || 'Unknown'}`,
      });
      break;
    }

    default: {
      warnings.push(`Unknown transaction type: ${balanceTxn.type} (ID: ${balanceTxn.id})`);
    }
  }
}

/**
 * Create journal entries for an order (sales revenue)
 *
 * APPROACH: GROSS Sales with separate discount line
 * - AR = Current total (handles edited orders with multiple captures)
 * - Sales = GROSS revenue (before discounts, for CURRENT items only)
 * - Discount = Separate debit line (4050-00) for visibility
 * - Tax and Shipping = Always included when > 0
 * - Invariant: AR + Discount = Sales + Tax + Shipping
 *
 * EDITED ORDERS:
 * - Uses current_total_price (final order total after all edits/captures)
 * - Uses current_subtotal_price + current_total_discounts = GROSS sales
 * - Automatically excludes removed line items
 *
 * FULLY REFUNDED ORDERS:
 * - Skipped entirely (no SO- entry generated)
 * - RF- entries handle the refund accounting separately
 *
 * NOTE: If multiple balance transactions exist for the same order (e.g., edited
 * orders with additional captures in the same payout), this will create multiple
 * SO- entries. Consider deduplicating by order ID if this becomes an issue.
 */
function createOrderEntries(
  order: Order,
  balanceTxn: BalanceTransaction,
  journalEntries: JournalEntry[],
  errors: string[]
): void {
  const orderDate = formatDate(order.createdAt);
  const reference = `SO-${order.name}`;

  // AR Debit: Use balance transaction gross (what actually flowed through Shopify)
  // This represents the actual cash captured and is more reliable than order.totalPrice
  // which can have rounding issues or adjustments
  // Note: For fully refunded orders, we still generate SO- entries using original amounts
  // The refund is handled separately by RF- entries, which net together on AR
  const arAmount = balanceTxn.gross;

  journalEntries.push({
    date: orderDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: arAmount,
    credit: new Decimal(0),
    memo: `Order ${order.name}`,
  });

  // Calculate GROSS sales (before discounts)
  // CRITICAL: Shopify's current_subtotal_price is NET (after discounts)
  // To get GROSS, we must add back the discounts
  // For edited orders, this automatically uses the current items only
  const discountAmount = order.currentTotalDiscounts || order.totalDiscounts || new Decimal(0);

  let grossSales: Decimal;
  if (order.currentSubtotalPrice) {
    // For edited orders: NET + Discount = GROSS
    grossSales = order.currentSubtotalPrice.plus(discountAmount);
    console.log(`Order ${order.name}: Gross sales = ${grossSales.toFixed(2)} (current_subtotal ${order.currentSubtotalPrice.toFixed(2)} + discount ${discountAmount.toFixed(2)})`);
  } else {
    // For standard orders: sum line item prices (GROSS per item)
    grossSales = order.lineItems.reduce(
      (sum, item) => sum.plus(item.price.times(item.quantity)),
      new Decimal(0)
    );
    console.log(`Order ${order.name}: Gross sales = ${grossSales.toFixed(2)} (calculated from line items)`);
  }

  // Credit: Sales Revenue (GROSS - full catalog price before discounts)
  journalEntries.push({
    date: orderDate,
    reference,
    account: '4000-00',
    accountName: 'Sales Revenue',
    debit: new Decimal(0),
    credit: grossSales,
    memo: `Sales - Order ${order.name}`,
  });

  // Debit: Discounts (if any) - use CURRENT discounts for edited orders
  if (discountAmount.greaterThan(0)) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4050-00',
      accountName: 'Discounts Given',
      debit: discountAmount,
      credit: new Decimal(0),
      memo: `Discount - Order ${order.name}`,
    });
  }

  // Credit: Sales Tax (only if > 0, zero is valid for out-of-state)
  const taxAmount = order.totalTax;
  const hasTax = taxAmount && taxAmount.greaterThan(0);

  if (hasTax) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '2200-00',
      accountName: 'Sales Tax Payable',
      debit: new Decimal(0),
      credit: taxAmount,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // Credit: Shipping Revenue (only if > 0, zero is valid for POS/pickup)
  const shippingAmount = order.totalShipping;
  const hasShipping = shippingAmount && shippingAmount.greaterThan(0);

  if (hasShipping) {
    journalEntries.push({
      date: orderDate,
      reference,
      account: '4100-00',
      accountName: 'Shipping Revenue',
      debit: new Decimal(0),
      credit: shippingAmount,
      memo: `Shipping - Order ${order.name}`,
    });
  }

  // VALIDATION: AR + Discount = Sales + Tax + Shipping
  const totalDebits = arAmount.plus(discountAmount);
  const totalCredits = grossSales
    .plus(taxAmount || new Decimal(0))
    .plus(shippingAmount || new Decimal(0));

  // Check if balanced (allow 1 cent rounding difference)
  const diff = totalDebits.minus(totalCredits).abs();
  const isBalanced = diff.lessThanOrEqualTo(new Decimal('0.01'));

  if (!isBalanced) {
    // Build detailed error message
    let errorMsg = `Order ${order.name} IMBALANCE: ` +
      `Debits(AR+Disc)=${totalDebits.toFixed(2)}, ` +
      `Credits(S+T+Sh)=${totalCredits.toFixed(2)} (diff=${totalDebits.minus(totalCredits).toFixed(2)}). ` +
      `[AR=${arAmount.toFixed(2)}, GrossSales=${grossSales.toFixed(2)}, Discount=${discountAmount.toFixed(2)}, ` +
      `Tax=${(taxAmount || new Decimal(0)).toFixed(2)}, Ship=${(shippingAmount || new Decimal(0)).toFixed(2)}]`;

    // Add context about missing amounts
    if (!hasTax) {
      errorMsg += ' [No tax - may be out-of-state order]';
    }
    if (!hasShipping) {
      errorMsg += ' [No shipping - may be POS/pickup order]';
    }

    errors.push(errorMsg);
  } else {
    // Log successful balance with context
    let successMsg = `Order ${order.name} ✓ Balanced: AR=${arAmount.toFixed(2)}`;
    if (!hasTax) {
      console.log(`${successMsg} [Out-of-state - no tax]`);
    }
    if (!hasShipping) {
      console.log(`${successMsg} [POS/Pickup - no shipping]`);
    }
  }
}

/**
 * Create journal entries for fees
 */
function createFeeEntries(
  balanceTxn: BalanceTransaction,
  txnDate: string,
  journalEntries: JournalEntry[]
): void {
  if (balanceTxn.fee.greaterThan(0) && balanceTxn.feeBreakdown) {
    const reference = `FEE-${balanceTxn.id}`;

    // Shopify fees
    if (balanceTxn.feeBreakdown.shopifyFee.greaterThan(0)) {
      journalEntries.push({
        date: txnDate,
        reference,
        account: '6110-00',
        accountName: 'Shopify Transaction Fees',
        debit: balanceTxn.feeBreakdown.shopifyFee,
        credit: new Decimal(0),
        memo: 'Shopify Transaction Fee',
      });

      journalEntries.push({
        date: txnDate,
        reference,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.feeBreakdown.shopifyFee,
        memo: 'Fee Deduction',
      });
    }

    // Gateway fees
    if (balanceTxn.feeBreakdown.gatewayFee.greaterThan(0)) {
      journalEntries.push({
        date: txnDate,
        reference,
        account: '6100-00',
        accountName: 'Payment Processing Fees',
        debit: balanceTxn.feeBreakdown.gatewayFee,
        credit: new Decimal(0),
        memo: 'Payment Gateway Fee',
      });

      journalEntries.push({
        date: txnDate,
        reference,
        account: '1250-00',
        accountName: 'Shopify Clearing Account',
        debit: new Decimal(0),
        credit: balanceTxn.feeBreakdown.gatewayFee,
        memo: 'Fee Deduction',
      });
    }
  }
}

/**
 * Create journal entries for refunds
 */
function createRefundEntries(
  order: Order,
  balanceTxn: BalanceTransaction,
  txnDate: string,
  journalEntries: JournalEntry[]
): void {
  const reference = `RF-${order.name}`;
  const refundAmount = balanceTxn.gross.abs();

  // Debit: Sales Returns & Refunds
  journalEntries.push({
    date: txnDate,
    reference,
    account: '4900-00',
    accountName: 'Sales Returns & Refunds',
    debit: refundAmount,
    credit: new Decimal(0),
    memo: `Refund - Order ${order.name}`,
  });

  // Credit: Clearing Account
  journalEntries.push({
    date: txnDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: new Decimal(0),
    credit: refundAmount,
    memo: `Refund Clearing - Order ${order.name}`,
  });
}

/**
 * Format date for journal entries (MM/DD/YYYY)
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

/**
 * Extract date-only portion from ISO timestamp (YYYY-MM-DD)
 * Used for filtering transactions by capture date
 */
function formatDateOnly(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
