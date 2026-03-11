import { Decimal } from 'decimal.js';
import type { Order, JournalEntry, Transaction } from '../types/journal-entry';
import type { PaymentMethodBreakdown } from './payment-method-analyzer.server';
import { getAccountMappings } from './storage.server';
import { calculateOrderCogs, validateCogsCalculation } from './cogs/cogs-calculator.server';
import { createCogsJournalEntries, createCogsRefundEntries } from './cogs/cogs-journal-generator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';
import { Cin7ProductService } from './cin7/cin7-product-service.server';
import { extractSkuFromLineItem } from './cogs/product-matcher.server';
import type { CogsCalculation } from '../types/cin7';

/**
 * Order-Centric Journal Entry Generator
 *
 * Generates journal entries from orders using payment method breakdowns.
 * Each order can have multiple payment methods (split payments).
 *
 * Entry structure:
 * - Debit: One entry per payment method (e.g., Card, Gift Card, Cash)
 * - Credit: Sales Revenue (NET - post-discount amount)
 * - Credit: Sales Tax
 * - Credit: Shipping Revenue
 * - Debit/Credit: COGS entries (if Cin7 enabled)
 *
 * Example split payment (Card $7.03 + Gift Card $20.00 = $27.03 total):
 * SO-81302: Order #81302
 *   1250-00 (AR - Card)        +7.03 Dr
 *   2320-00 (Gift Card)       +20.00 Dr
 *   4000-00 (Sales)           -25.20 Cr  [NET amount, post-discount]
 *   2200-00 (Tax)              -1.83 Cr
 *   4000-00 (COGS)            +15.37 Dr
 *   1310-00 (Inventory)       -15.37 Cr
 *
 * Total: 0.00 ✓ Balanced
 */

/**
 * Calculate the tax amount for an order, handling partial captures.
 *
 * PARTIAL CAPTURE LOGIC:
 * - For partial captures (currentTotalPrice < totalPrice), calculate tax proportionally
 * - Tax = (currentTotalPrice - currentSubtotalPrice) where available
 * - Fallback: Use original totalTax if current amounts not available
 *
 * Example Partial Capture (Order #80211):
 * - Original: $95.91 total, $89.54 subtotal, $6.37 tax
 * - Removed items, captured: $31.28 total
 * - Tax should be: $31.28 - (currentSubtotalPrice) = proportional tax amount
 */
export function calculateTaxAmount(order: Order): Decimal {
  // If we have both current amounts, calculate tax from the difference
  if (order.currentTotalPrice && order.currentSubtotalPrice) {
    const currentTax = order.currentTotalPrice
      .minus(order.currentSubtotalPrice)
      .minus(order.totalShipping || new Decimal(0));

    // Tax should never be negative
    return currentTax.greaterThan(0) ? currentTax : new Decimal(0);
  }

  // Fallback: Use original tax amount
  return order.totalTax || new Decimal(0);
}

/**
 * Create journal entries for an order
 *
 * @param shop - Shop domain (for account mappings)
 * @param order - Order with transaction details
 * @param paymentBreakdowns - Payment method breakdowns
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @param accessToken - Shopify access token (optional, for COGS fulfillment filtering)
 * @returns Array of journal entries
 */
export async function createOrderJournalEntries(
  shop: string,
  order: Order,
  paymentBreakdowns: PaymentMethodBreakdown[],
  targetDate: string,
  accessToken?: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const reference = `SO-${order.name}`;
  const accountMappings = await getAccountMappings(shop);

  // DEBITS: One entry per payment method
  for (const breakdown of paymentBreakdowns) {
    entries.push({
      date: targetDate,
      reference,
      account: breakdown.account,
      accountName: breakdown.accountName,
      debit: breakdown.amount,
      credit: new Decimal(0),
      memo: `${breakdown.accountName} - Order ${order.name}`,
    });
  }

  // PARTIAL CAPTURE FIX: Use currentSubtotalPrice for orders with line item removals
  // For partial captures, currentSubtotalPrice reflects the actual captured amount
  // Example: Order $95.91, items removed, captured $31.28 → use currentSubtotalPrice
  const netSales = order.currentSubtotalPrice || order.subtotalPrice;

  // CREDIT: Sales Revenue (NET - post-discount amount)
  // Add discount info to memo for transparency
  const hasDiscount = order.totalDiscounts && order.totalDiscounts.gt(0);
  const discountInfo = hasDiscount
    ? ` (Net: $${netSales.toFixed(2)}, Discount: $${order.totalDiscounts.toFixed(2)})`
    : '';

  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.sales_revenue.accountCode,
    accountName: accountMappings.sales_revenue.accountName,
    debit: new Decimal(0),
    credit: netSales,
    memo: `Sales - Order ${order.name}${discountInfo}`,
  });

  // NO DISCOUNT ENTRY - discounts are already reflected in NET sales amount

  // CREDIT: Sales Tax (only if > 0)
  // PARTIAL CAPTURE FIX: Calculate tax proportionally for partial captures
  const taxAmount = calculateTaxAmount(order);
  if (taxAmount && taxAmount.greaterThan(0)) {
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.sales_tax.accountCode,
      accountName: accountMappings.sales_tax.accountName,
      debit: new Decimal(0),
      credit: taxAmount,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // CREDIT: Shipping Revenue (only if > 0)
  const shippingAmount = order.totalShipping;
  if (shippingAmount && shippingAmount.greaterThan(0)) {
    entries.push({
      date: targetDate,
      reference,
      account: accountMappings.shipping_revenue.accountCode,
      accountName: accountMappings.shipping_revenue.accountName,
      debit: new Decimal(0),
      credit: shippingAmount,
      memo: `Shipping - Order ${order.name}`,
    });
  }

  // Add COGS entries (if Cin7 enabled and order has line items)
  try {
    const cin7Enabled = await isCin7Enabled(shop);
    if (cin7Enabled && order.lineItems.length > 0) {
      // NEW: Pass accessToken to enable fulfillment-based filtering
      const cogsCalculation = await calculateOrderCogs(shop, order, accessToken, true);

      // VALIDATION: Check COGS calculation quality before adding entries
      const validation = validateCogsCalculation(order, cogsCalculation);

      // Log validation errors (critical issues)
      if (validation.errors.length > 0) {
        console.error(`❌ COGS Validation Errors for ${order.name}:`);
        for (const error of validation.errors) {
          console.error(`  ${error}`);
        }
      }

      // Log validation warnings (quality issues)
      if (validation.hasWarnings) {
        console.warn(`⚠️ COGS Validation Warnings for ${order.name}:`);
        for (const warning of validation.warnings) {
          console.warn(`  ${warning}`);
        }
      }

      // Always create COGS entries if order has products, even if calculation is $0
      // This ensures journal completeness and highlights missing COGS data
      if (cogsCalculation.totalCogs.greaterThan(0)) {
        const cogsEntries = await createCogsJournalEntries(
          shop,
          order.name,
          cogsCalculation,
          targetDate
        );
        entries.push(...cogsEntries);
      } else if (order.lineItems.length > 0) {
        // Log warning if order has products but COGS is $0
        console.warn(
          `⚠️ Order ${order.name} has ${order.lineItems.length} line items but COGS is $0. ` +
          `Check Cin7 product cost data.`
        );
      }
    }
  } catch (error) {
    // Critical error: COGS calculation failed completely
    console.error(
      `❌ Failed to calculate COGS for ${order.name}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Still continue - journal will be incomplete but won't block export
    // Operator should review warnings and investigate missing COGS
  }

  // REAL-TIME VALIDATION: Validate entries before returning (Phase 3)
  const validation = validateOrderEntries(entries, reference);
  if (validation.length > 0) {
    console.error(`❌ Journal entry validation failed for ${reference}:`);
    for (const error of validation) {
      console.error(`  ${error}`);
    }

    // Log detailed breakdown for debugging
    console.error('Entry breakdown:');
    for (const entry of entries) {
      console.error(
        `  ${entry.reference} | ${entry.accountName} | ` +
        `DR: $${entry.debit.toFixed(2)} | CR: $${entry.credit.toFixed(2)}`
      );
    }

    const totalDebits = entries.reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
    const totalCredits = entries.reduce((sum, e) => sum.plus(e.credit), new Decimal(0));
    console.error(
      `Total Debits: $${totalDebits.toFixed(2)} | Total Credits: $${totalCredits.toFixed(2)}`
    );

    throw new Error(
      `Journal entry validation failed for ${reference}: ${validation.join(', ')}`
    );
  }

  return entries;
}

/**
 * Create journal entries for refunds
 *
 * Refunds reverse the original order entries.
 * Uses the refund transaction's processedAt date.
 *
 * Entry structure:
 * - RF- entries: Credit payment account (refund payment going out)
 * - SO- reversal entries: Debit sales revenue, tax, and shipping (reverse original credits)
 *
 * Example refund ($620.98 total: $579.00 sales + $41.98 tax):
 * RF-#80427: Refund - Order #80427
 *   1061.000 (Credit Card)     -620.98 Cr  [Refund payment out]
 * SO-#80427: Reversals
 *   3000.000 (Sales)           +579.00 Dr  [Reverse original sales credit]
 *   2110.000 (Tax)              +41.98 Dr  [Reverse original tax credit]
 *
 * @param shop - Shop domain (for account mappings)
 * @param order - Order being refunded
 * @param refundTransactions - Refund transactions for target date
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @returns Array of journal entries
 */
export async function createRefundJournalEntries(
  shop: string,
  order: Order,
  refundTransactions: Transaction[],
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const accountMappings = await getAccountMappings(shop);

  for (const refundTxn of refundTransactions) {
    const refundAmount = refundTxn.amount.abs();

    // Find the matching refund object from order.refunds
    const refund = order.refunds?.find(r =>
      r.transactions.some(t => t.id === refundTxn.id)
    );

    // Check if this is a cancellation (no money refunded)
    const isCancellation = refund?.refund_line_items?.some(
      item => item.restock_type === 'cancel'
    ) && refund?.transactions.length === 0;

    if (isCancellation) {
      // This is a CANCELLATION (no money refunded)
      console.log(`Order ${order.name}: Cancellation detected (no money refunded)`);

      // Check if payment was captured
      const wasCaptured = order.transactions?.some(
        t => t.kind === 'capture' && t.status === 'success'
      );

      if (!wasCaptured) {
        // Cancellation before capture: Only reverse AR, not cash
        // Calculate amounts from refund line items
        const refundedSubtotal = refund?.refund_line_items.reduce(
          (sum, item) => sum.plus(item.subtotal), new Decimal(0)
        ) || new Decimal(0);
        const refundedTax = refund?.refund_line_items.reduce(
          (sum, item) => sum.plus(item.total_tax), new Decimal(0)
        ) || new Decimal(0);

        entries.push({
          date: targetDate,
          reference: `CANCEL-${order.name}`,
          account: accountMappings.accounts_receivable.accountCode,
          accountName: accountMappings.accounts_receivable.accountName,
          debit: new Decimal(0),
          credit: refundedSubtotal.plus(refundedTax),
          memo: `Cancellation AR Reversal - Order ${order.name}`,
        });

        // Reverse sales revenue
        if (refundedSubtotal.greaterThan(0)) {
          entries.push({
            date: targetDate,
            reference: `SO-${order.name}`,
            account: accountMappings.sales_revenue.accountCode,
            accountName: accountMappings.sales_revenue.accountName,
            debit: refundedSubtotal,
            credit: new Decimal(0),
            memo: `Sales Cancellation - Order ${order.name}`,
          });
        }

        // Reverse tax
        if (refundedTax.greaterThan(0)) {
          entries.push({
            date: targetDate,
            reference: `SO-${order.name}`,
            account: accountMappings.sales_tax.accountCode,
            accountName: accountMappings.sales_tax.accountName,
            debit: refundedTax,
            credit: new Decimal(0),
            memo: `Tax Cancellation - Order ${order.name}`,
          });
        }

        continue; // Skip RF- entry creation for cancellations
      }
    }

    // NORMAL REFUND PROCESSING (not a cancellation)
    // RF- ENTRY: Payment reversal (credit payment account)
    const { account, accountName } = await getRefundAccount(
      shop,
      refundTxn, // Pass full transaction to get actual refund gateway
      order, // Pass order to check for gateway mismatch
      accountMappings
    );

    entries.push({
      date: targetDate,
      reference: `RF-${order.name}`,
      account,
      accountName,
      debit: new Decimal(0),
      credit: refundAmount,
      memo: `Refund ${accountName} - Order ${order.name}`,
    });

    // SO- REVERSAL ENTRIES: Use ACTUAL refund breakdown from refund_line_items
    let refundedSubtotal = new Decimal(0);
    let refundedTax = new Decimal(0);

    if (refund?.refund_line_items && refund.refund_line_items.length > 0) {
      // PREFERRED METHOD: Calculate actual subtotal and tax from refund line items
      refundedSubtotal = refund.refund_line_items.reduce(
        (sum, item) => sum.plus(item.subtotal), new Decimal(0)
      );
      refundedTax = refund.refund_line_items.reduce(
        (sum, item) => sum.plus(item.total_tax), new Decimal(0)
      );

      // Validate that subtotal + tax = refund amount
      const calculatedTotal = refundedSubtotal.plus(refundedTax);
      const diff = calculatedTotal.minus(refundAmount).abs();

      if (diff.greaterThan(new Decimal('0.02'))) {
        console.warn(
          `⚠️ Refund amount mismatch for ${order.name}: ` +
          `Calculated ${calculatedTotal.toFixed(2)} != Transaction ${refundAmount.toFixed(2)} ` +
          `(Diff: $${diff.toFixed(2)})`
        );
      }

      console.log(
        `Refund ${order.name}: $${refundAmount.toFixed(2)} = ` +
        `Subtotal: $${refundedSubtotal.toFixed(2)} + Tax: $${refundedTax.toFixed(2)}`
      );
    } else {
      // FALLBACK: Use proportional method if refund_line_items not available
      console.warn(`⚠️ No refund_line_items for ${order.name}, using proportional calculation`);

      const netSales = calculateNetSalesForRefund(order);
      const taxAmount = order.totalTax || new Decimal(0);
      const orderTotal = order.totalPrice;
      const refundRatio = refundAmount.dividedBy(orderTotal);

      refundedSubtotal = netSales.times(refundRatio);
      refundedTax = taxAmount.times(refundRatio);
    }

    // DEBIT: Sales Revenue (reverse credit)
    if (refundedSubtotal.greaterThan(0)) {
      entries.push({
        date: targetDate,
        reference: `RF-${order.name}`,
        account: accountMappings.sales_revenue.accountCode,
        accountName: accountMappings.sales_revenue.accountName,
        debit: refundedSubtotal,
        credit: new Decimal(0),
        memo: `Sales Refund - Order ${order.name}`,
      });
    }

    // DEBIT: Sales Tax (reverse credit)
    if (refundedTax.greaterThan(0)) {
      entries.push({
        date: targetDate,
        reference: `RF-${order.name}`,
        account: accountMappings.sales_tax.accountCode,
        accountName: accountMappings.sales_tax.accountName,
        debit: refundedTax,
        credit: new Decimal(0),
        memo: `Sales Tax Refund - Order ${order.name}`,
      });
    }

    // NOTE: Shipping refunds are included in refund_line_items.subtotal
    // No separate shipping entry needed
  }

  // COGS REVERSAL: Only for items returned to inventory
  // Check if Cin7 is enabled and if any items were restocked
  try {
    const cin7Enabled = await isCin7Enabled(shop);
    if (cin7Enabled) {
      // Calculate COGS for refunded items that were returned to inventory
      const refundCogsCalculation = await calculateRefundCogs(shop, order, refundTransactions);

      if (refundCogsCalculation.totalCogs.greaterThan(0)) {
        console.log(
          `📦 Order ${order.name}: Reversing COGS for returned items: $${refundCogsCalculation.totalCogs.toFixed(2)}`
        );

        // Create COGS reversal entries
        const cogsReversalEntries = await createCogsRefundEntries(
          shop,
          order.name,
          refundCogsCalculation,
          targetDate
        );

        entries.push(...cogsReversalEntries);
      } else {
        console.log(
          `ℹ️  Order ${order.name}: No COGS reversal needed (no items returned to inventory)`
        );
      }
    }
  } catch (error) {
    console.error(
      `❌ Failed to calculate refund COGS for ${order.name}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Continue without COGS reversal - operator should review warnings
  }

  return entries;
}

/**
 * Get the account to credit for a refund based on the ACTUAL refund gateway
 * (not the original payment gateway, which may differ)
 *
 * @param shop - Shop domain
 * @param refundTransaction - The refund transaction (contains actual gateway)
 * @param order - The order being refunded (to check for gateway mismatch)
 * @param accountMappings - Account mappings
 * @returns Account code and name for the refund
 */
async function getRefundAccount(
  shop: string,
  refundTransaction: Transaction,
  order: Order,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accountMappings: any
): Promise<{ account: string; accountName: string }> {
  const normalizedGateway = refundTransaction.gateway.toLowerCase();

  // Log warning if refund gateway differs from original payment
  const originalGateways = order.transactions
    ?.filter(t => (t.kind === 'capture' || t.kind === 'sale') && t.status === 'success')
    .map(t => t.gateway) || [];

  if (originalGateways.length > 0 && !originalGateways.includes(refundTransaction.gateway)) {
    console.warn(
      `⚠️ Refund gateway mismatch for ${order.name}: ` +
      `Original: ${originalGateways.join(', ')} | Refund: ${refundTransaction.gateway}`
    );
  }

  switch (normalizedGateway) {
    case 'shopify_payments':
      return {
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
      };

    case 'gift_card':
      return {
        account: accountMappings.gift_card_liability.accountCode,
        accountName: accountMappings.gift_card_liability.accountName,
      };

    case 'shopify_store_credit':
    case 'store_credit':
      return {
        account: accountMappings.store_credit_liability.accountCode,
        accountName: accountMappings.store_credit_liability.accountName,
      };

    case 'cash':
      return {
        account: accountMappings.cash_register.accountCode,
        accountName: accountMappings.cash_register.accountName,
      };

    case 'charge':
      return {
        account: accountMappings.cogs_inventory_writeoff.accountCode,
        accountName: accountMappings.cogs_inventory_writeoff.accountName,
      };

    case 'check':
    case 'cheque':
      return {
        account: accountMappings.undeposited_funds.accountCode,
        accountName: accountMappings.undeposited_funds.accountName,
      };

    default:
      console.warn(`Unknown refund gateway: ${refundTransaction.gateway}. Defaulting to clearing account.`);
      return {
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
      };
  }
}

/**
 * Calculate COGS for refunded items that were returned to inventory
 *
 * Only calculates COGS for line items with restock_type === 'return'.
 * Items that are not restocked (damaged, no_restock, cancel) are excluded.
 *
 * @param shop - Shop domain
 * @param order - Order being refunded
 * @param refundTransactions - Refund transactions for target date
 * @returns COGS calculation for returned items only
 */
async function calculateRefundCogs(
  shop: string,
  order: Order,
  refundTransactions: Transaction[]
): Promise<CogsCalculation> {
  const calculation: CogsCalculation = {
    orderId: order.id,
    orderName: order.name,
    totalCogs: new Decimal(0),
    lineItems: [],
    warnings: [],
  };

  // Initialize Cin7 service
  const cin7Service = new Cin7ProductService(shop);
  await cin7Service.initialize();

  // Process each refund transaction
  for (const refundTxn of refundTransactions) {
    // Find the matching refund object
    const refund = order.refunds?.find(r =>
      r.transactions.some(t => t.id === refundTxn.id)
    );

    if (!refund?.refund_line_items) {
      continue;
    }

    // Process refund line items
    for (const refundItem of refund.refund_line_items) {
      // Only process items that were returned to inventory
      if (refundItem.restock_type !== 'return' || refundItem.quantity <= 0) {
        console.log(
          `  ⏭️  Skipping COGS reversal for ${order.name}: ` +
          `restock_type=${refundItem.restock_type}, qty=${refundItem.quantity}`
        );
        continue;
      }

      // Find the original line item
      const lineItem = order.lineItems.find(li => li.id === refundItem.line_item_id);
      if (!lineItem) {
        calculation.warnings.push(
          `⚠️ Could not find original line item ${refundItem.line_item_id} for refund`
        );
        continue;
      }

      // Extract SKU and get unit cost
      try {
        const sku = extractSkuFromLineItem(lineItem);
        if (!sku) {
          calculation.warnings.push(
            `⚠️ No SKU found for refunded item: ${lineItem.title} (Qty: ${refundItem.quantity})`
          );
          continue;
        }

        const unitCost = await cin7Service.getProductCost(sku);
        if (unitCost === null) {
          calculation.warnings.push(
            `⚠️ COGS not found for refunded item: "${lineItem.title}" (SKU: ${sku}, Qty: ${refundItem.quantity})`
          );
          continue;
        }

        // Calculate total cost for refunded quantity
        const totalCost = unitCost.times(refundItem.quantity);

        console.log(
          `  ✓ Refund COGS: SKU "${sku}" - $${unitCost.toFixed(2)} x${refundItem.quantity} = $${totalCost.toFixed(2)}`
        );

        calculation.lineItems.push({
          productTitle: lineItem.title,
          sku,
          quantity: refundItem.quantity,
          unitCost,
          totalCost,
        });

        calculation.totalCogs = calculation.totalCogs.plus(totalCost);
      } catch (error) {
        calculation.warnings.push(
          `⚠️ Error calculating refund COGS for "${lineItem.title}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return calculation;
}

/**
 * Calculate net sales amount for refund reversal
 * Must match the original SO- entry calculation from createOrderJournalEntries()
 *
 * @param order - Order being refunded
 * @returns Net sales amount (post-discount)
 */
function calculateNetSalesForRefund(order: Order): Decimal {
  // Check if order has been refunded
  const isRefunded =
    order.financialStatus === 'refunded' ||
    order.financialStatus === 'partially_refunded';

  if (isRefunded) {
    // For refunded orders: Use ORIGINAL subtotal (before refunds)
    // This ensures reversal matches the original SO- entry
    return order.subtotalPrice;
  } else if (order.currentSubtotalPrice) {
    // For non-refunded orders: currentSubtotalPrice is NET (after discounts)
    return order.currentSubtotalPrice;
  } else {
    // Fallback: Calculate NET from total payment minus tax and shipping
    // NET Sales = Total Payment - Tax - Shipping
    return order.totalPrice
      .minus(order.totalTax || new Decimal(0))
      .minus(order.totalShipping || new Decimal(0));
  }
}

/**
 * Validate that journal entries balance for a given reference
 *
 * @param entries - Journal entries to validate
 * @param reference - Reference to validate (e.g., "SO-1001")
 * @returns Array of validation errors (empty if balanced)
 */
export function validateOrderEntries(
  entries: JournalEntry[],
  reference: string
): string[] {
  const errors: string[] = [];

  // Filter entries for this reference
  const refEntries = entries.filter((entry) => entry.reference === reference);

  if (refEntries.length === 0) {
    errors.push(`No entries found for reference ${reference}`);
    return errors;
  }

  // Calculate totals
  const totalDebits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );

  const totalCredits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  // Check if balanced (allow 1 cent rounding difference)
  const diff = totalDebits.minus(totalCredits).abs();
  const isBalanced = diff.lessThanOrEqualTo(new Decimal('0.01'));

  if (!isBalanced) {
    errors.push(
      `Reference ${reference} does not balance: ` +
      `Debits=${totalDebits.toFixed(2)}, ` +
      `Credits=${totalCredits.toFixed(2)}, ` +
      `Diff=${diff.toFixed(2)}`
    );
  }

  return errors;
}

/**
 * Create journal entries for fees
 * (Unchanged from payout-centric system)
 */
export async function createFeeEntries(
  shop: string,
  transaction: Transaction,
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const accountMappings = await getAccountMappings(shop);

  if (transaction.fees.length === 0) {
    return entries;
  }

  const reference = `FEE-${transaction.id}`;

  for (const fee of transaction.fees) {
    if (fee.amount.greaterThan(0)) {
      // Determine fee account based on type
      let feeAccount: string;
      let feeAccountName: string;

      if (fee.type === 'shopify_fee') {
        feeAccount = accountMappings.shopify_fees.accountCode;
        feeAccountName = accountMappings.shopify_fees.accountName;
      } else {
        feeAccount = accountMappings.payment_processing_fees.accountCode;
        feeAccountName = accountMappings.payment_processing_fees.accountName;
      }

      // DEBIT: Fee expense
      entries.push({
        date: targetDate,
        reference,
        account: feeAccount,
        accountName: feeAccountName,
        debit: fee.amount,
        credit: new Decimal(0),
        memo: `${fee.type.replace('_', ' ')} - Transaction ${transaction.id}`,
      });

      // CREDIT: Clearing account (fee deduction)
      entries.push({
        date: targetDate,
        reference,
        account: accountMappings.clearing_account.accountCode,
        accountName: accountMappings.clearing_account.accountName,
        debit: new Decimal(0),
        credit: fee.amount,
        memo: 'Fee Deduction',
      });
    }
  }

  return entries;
}
