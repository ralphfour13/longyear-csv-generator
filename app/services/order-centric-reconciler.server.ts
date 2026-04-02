import { Decimal } from 'decimal.js';
import type {
  Order,
  JournalEntry,
  EnrichedTransaction,
  Transaction,
  OrderCentricReconciliationResult,
} from '../types/journal-entry';
import type { CogsCalculation } from '../types/cin7';
import {
  fetchOrdersByCaptureDateRange,
  getOrderCaptureDate,
} from './order-centric-fetcher.server';
import {
  analyzeOrderPayments,
  validatePaymentTotal,
} from './payment-method-analyzer.server';
import {
  createOrderJournalEntries,
  createRefundJournalEntries,
  createFeeEntries,
  validateOrderEntries,
  hasActualRefunds,
  getPointInTimeAmounts,
} from './order-centric-journal-generator.server';
import { enrichOrderData, type EnrichedOrderData } from './enrichment/order-enrichment.server';
import { calculateOrderCogsWithService } from './cogs/cogs-calculator.server';
import { isCin7Enabled } from './cin7/cin7-credential-manager.server';
import { Cin7ProductService } from './cin7/cin7-product-service.server';
import { fetchBalanceTransactionsByDate } from './shopify/balance-transaction-fetcher.server';

/**
 * Compute a per-order summary from JE lines. Used by DR/DSR generators
 * to ensure all export files match the JE exactly.
 * Credit accounts (3000, 2110, 3040, 2320) are summed as credit - debit (positive = credit).
 * Debit accounts (1051, 1061) are summed as debit - credit (positive = debit/payment).
 */
function computeJESummary(entries: JournalEntry[]) {
  const zero = new Decimal(0);
  let netSales = zero;
  let tax = zero;
  let shipping = zero;
  let giftCardLiability = zero;
  let storeCredit = zero;
  let totalPayment = zero;

  for (const e of entries) {
    const acct = e.account;
    const netCredit = e.credit.minus(e.debit);
    const netDebit = e.debit.minus(e.credit);

    if (acct.startsWith('3000')) netSales = netSales.plus(netCredit);
    else if (acct.startsWith('2110')) tax = tax.plus(netCredit);
    else if (acct.startsWith('3040')) shipping = shipping.plus(netCredit);
    else if (acct.startsWith('2320')) giftCardLiability = giftCardLiability.plus(netCredit);
    else if (acct.startsWith('2340')) storeCredit = storeCredit.plus(netDebit);
    else totalPayment = totalPayment.plus(netDebit); // 1051, 1061, etc.
  }

  return { netSales, tax, shipping, giftCardLiability, storeCredit, totalPayment };
}

/**
 * Log order reconciliation values for debugging
 * Shows original vs current values to help diagnose partial capture/refund issues
 */
function logOrderReconciliationValues(order: Order, usedValues: { sales: Decimal; tax: Decimal }): void {
  const hasCurrentValues = order.currentSubtotalPrice !== undefined || order.currentTotalTax !== undefined;

  console.log(`📊 Order ${order.name} Reconciliation Values:`);
  console.log(`  Original: subtotal=$${order.subtotalPrice.toFixed(2)}, tax=$${(order.totalTax || new Decimal(0)).toFixed(2)}, total=$${order.totalPrice.toFixed(2)}`);

  if (hasCurrentValues) {
    console.log(`  Current:  subtotal=$${order.currentSubtotalPrice?.toFixed(2) ?? 'N/A'}, tax=$${order.currentTotalTax?.toFixed(2) ?? 'N/A'}, total=$${order.currentTotalPrice?.toFixed(2) ?? 'N/A'}`);
  }

  console.log(`  Used:     sales=$${usedValues.sales.toFixed(2)}, tax=$${usedValues.tax.toFixed(2)}`);
  console.log(`  Financial Status: ${order.financialStatus}`);
}

/**
 * Reconcile orders by capture date
 *
 * This is the main entry point for order-centric reconciliation.
 * Fetches all orders with activity in the date range, filters by capture date,
 * analyzes payment methods, and generates journal entries.
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param targetDate - Target date (YYYY-MM-DD format)
 * @returns Reconciliation result with journal entries and enriched transactions
 */
export async function reconcileOrdersByDate(
  shop: string,
  accessToken: string,
  targetDate: string,
  jobId?: string,  // Optional job ID for progress tracking
  cogsDataMap?: Map<string, CogsCalculation>,  // Pre-calculated COGS data for consistency
  skipCogs?: boolean  // Skip all COGS/Cin7 processing (e.g., for sales tax reports)
): Promise<OrderCentricReconciliationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cogsWarnings: string[] = [];
  const journalEntries: JournalEntry[] = [];
  const enrichedTransactions: EnrichedTransaction[] = [];

  try {
    // Fetch orders with activity in the date range (-30/+1 day buffer for created_at query)
    // The fetcher uses dual-query strategy:
    // - created_at: Uses -8/+1 day buffer (extra day covers boundary edge cases where
    //   orders created exactly 7 days before target date were missed)
    // - updated_at: Uses -2/+1 day from targetDate to catch recently modified orders
    // +1 day forward buffer covers timezone edge cases; no need to look further ahead
    const startDate = addDays(targetDate, -8);
    const endDate = addDays(targetDate, 1);

    const orders = await fetchOrdersByCaptureDateRange(
      shop,
      accessToken,
      startDate,
      endDate,
      jobId,  // Pass jobId for progress tracking
      targetDate  // Pass explicit targetDate so Query 2 uses correct -7/+1 day window
    );

    let ordersProcessed = 0;
    let capturesProcessed = 0;
    const processedOrderIds = new Set<string>();

    // PRE-COLLECT COGS DATA: Calculate COGS once before journal generation
    // This ensures both journal entries and COGS detail CSV use identical cost data
    let preCollectedCogsDataMap: Map<string, CogsCalculation> | undefined;
    if (!cogsDataMap && !skipCogs) {
      const cin7Enabled = await isCin7Enabled(shop);
      if (cin7Enabled) {
        try {
          preCollectedCogsDataMap = await collectCogsData(shop, accessToken, orders);
          console.log(`📊 Pre-collected COGS for ${preCollectedCogsDataMap.size} orders`);
        } catch (error) {
          console.error('Failed to pre-collect COGS data:', error);
          cogsWarnings.push(`COGS pre-collection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const effectiveCogsDataMap = cogsDataMap || preCollectedCogsDataMap;

    // PRE-FETCH REFUND SETTLEMENT DATES: For shopify_payments refunds, the order
    // transaction processedAt is the initiation date (pending), not the settlement date.
    // Balance transactions provide the actual settlement date.
    const refundSettlementMap = await buildRefundSettlementMap(shop, accessToken, targetDate);

    // Cache enrichment data to avoid duplicate API calls when an order
    // has both captures and refunds processed separately
    const enrichmentCache = new Map<string, EnrichedOrderData | null>();

    // Process each order
    for (const order of orders) {
      try {
        // DIAGNOSTIC: Warn if order has no transactions at all (likely a fetch failure)
        if (!order.transactions || order.transactions.length === 0) {
          warnings.push(
            `⚠️ Order ${order.name} (${order.id}) has NO transactions - possible fetch failure. ` +
            `Financial status: ${order.financialStatus}, Total: $${order.totalPrice.toFixed(2)}`
          );
          console.warn(
            `⚠️ Order ${order.name} has 0 transactions - this order will be skipped. ` +
            `Check if transaction fetch failed silently.`
          );
        }

        // PENDING CC AUTH CHECK: Skip orders where a CC authorization exists but
        // no CC capture has occurred on or before targetDate. The order will post
        // on the date the CC capture happens instead.
        // Example: Gift card + CC auth on Jan 12, CC capture on Jan 14 → skip on Jan 12, post on Jan 14
        const hasPendingCCAuth = (() => {
          if (!order.transactions || order.transactions.length === 0) return false;

          // Find CC (shopify_payments) authorization transactions
          const ccAuths = order.transactions.filter(
            (txn) => txn.kind === 'authorization' && txn.status === 'success' && isCardGateway(txn.gateway)
          );
          if (ccAuths.length === 0) return false;

          // Find CC capture transactions on or before targetDate
          const ccCaptures = order.transactions.filter((txn) => {
            if ((txn.kind !== 'capture' && txn.kind !== 'sale') || txn.status !== 'success') return false;
            if (!isCardGateway(txn.gateway)) return false;
            const txnDate = formatDateOnly(txn.processedAt);
            return txnDate <= targetDate;
          });

          // CC auth exists but no CC capture by targetDate → pending
          return ccCaptures.length === 0;
        })();

        if (hasPendingCCAuth) {
          // Exception: online gift card orders on their fulfillment date should post
          // as a complete unit, even if CC auth was never captured (voided/manual).
          const fulfillmentDate = order.fulfilledAt ? formatDateOnly(order.fulfilledAt)
            : order.closedAt ? formatDateOnly(order.closedAt) : null;
          const onFulfillmentDate = shouldUseFulfillmentDate(order) && fulfillmentDate === targetDate;

          if (!onFulfillmentDate) {
            // Normal pending CC auth behavior — process refunds only, skip sale
            const refundTxns = filterRefundTransactions(order, targetDate, refundSettlementMap);
            if (refundTxns.length > 0) {
              await processOrderRefunds(
                shop, accessToken, order, refundTxns, targetDate,
                journalEntries, enrichedTransactions, warnings, enrichmentCache
              );
              processedOrderIds.add(order.id);
              ordersProcessed++;
            } else {
              console.log(
                `⏭️  Order ${order.name}: Skipped - CC authorized but not captured by ${targetDate}. ` +
                `Will post when CC capture occurs.`
              );
            }
            continue;
          }
          // Fall through — order posts as complete unit on fulfillment date
        }

        // REFUND-ONLY ORDERS: Handle standalone refunds (where original sale was on prior date)
        // Check this BEFORE capture logic to catch refund-only transactions
        const allCaptureTransactions = order.transactions?.filter(
          (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
        ) || [];

        if (allCaptureTransactions.length === 0) {
          // No captures - check if this is a refund-only order
          const refundTransactions = filterRefundTransactions(order, targetDate, refundSettlementMap);
          if (refundTransactions.length > 0) {
            await processOrderRefunds(
              shop,
              accessToken,
              order,
              refundTransactions,
              targetDate,
              journalEntries,
              enrichedTransactions,
              warnings,
              enrichmentCache
            );

            processedOrderIds.add(order.id);
            ordersProcessed++;
          }
          // Skip to next order (either processed refunds or nothing to do)
          // DIAGNOSTIC: Log orders dropped with no captures and no refunds on target date
          if (refundTransactions.length === 0) {
            console.log(
              `⏭️  Order ${order.name}: Skipped - no captures and no refunds on ${targetDate}. ` +
              `Total transactions: ${order.transactions?.length || 0}, ` +
              `Financial status: ${order.financialStatus}, Total: $${order.totalPrice.toFixed(2)}`
            );
          }
          continue;
        }

        // Check for refunds on target date BEFORE deciding to skip order
        // This ensures refunds that occur on different dates than captures are still processed
        const refundTransactions = filterRefundTransactions(order, targetDate, refundSettlementMap);

        // POSTING DATE: For online orders with gift card transactions, use fulfillment date
        // so all payment legs post together. For all other orders, use capture date.
        const postingDate = getOrderPostingDate(order, targetDate);
        const useFulfillmentDate = shouldUseFulfillmentDate(order) && !!(order.fulfilledAt || order.closedAt);
        const postingOnFulfillmentDate = useFulfillmentDate && postingDate === targetDate;

        let captureRatio: Decimal | undefined;
        let isMultiDateCapture = false;

        // Detect captures spanning multiple dates (any gateway, not just CC)
        const allCapturesByDate = groupAllCapturesByDate(allCaptureTransactions);
        const hasMultipleDates = allCapturesByDate.size > 1;

        if (useFulfillmentDate) {
          // Fulfillment date available: order posts as a complete unit on that date.
          if (postingOnFulfillmentDate) {
            // On fulfillment date: include captures on or before fulfillment date.
            // Later captures (e.g., manual payments after fulfillment) are excluded
            // and will post on their own date via the multi-date path below.
          } else {
            // Not on fulfillment date — check if there are NEW captures on targetDate
            // that arrived after the fulfillment date (e.g., manual payment closing an old auth)
            const targetDateCaptures = allCapturesByDate.get(targetDate) || [];
            if (targetDateCaptures.length > 0) {
              // New captures after fulfillment — treat as multi-date split
              const targetDateTotal = targetDateCaptures.reduce(
                (sum, txn) => sum.plus(txn.amount), new Decimal(0)
              );
              const orderEffectiveTotal = order.currentTotalPrice || order.totalPrice;
              captureRatio = targetDateTotal.dividedBy(orderEffectiveTotal);
              isMultiDateCapture = true;

              console.log(
                `🔀 Order ${order.name}: Post-fulfillment capture on ${targetDate} - ` +
                `$${targetDateTotal.toFixed(2)} / $${orderEffectiveTotal.toFixed(2)} = ${captureRatio.toFixed(4)}`
              );
              // Fall through to processOrderCaptures with targetDate captures and ratio
            } else {
              // No captures on targetDate — check for refunds, then skip
              if (refundTransactions.length > 0) {
                await processOrderRefunds(
                  shop, accessToken, order, refundTransactions, targetDate,
                  journalEntries, enrichedTransactions, warnings, enrichmentCache
                );
                processedOrderIds.add(order.id);
                ordersProcessed++;
              }
              continue;
            }
          }
        } else if (postingDate) {
          // Fallback path (no fulfillment date): use last capture date with multi-CC-capture detection.
          // This handles POS orders, unfulfilled orders, and other edge cases.
          // IMPORTANT: Only detect multi-date splits for CC (card) gateways here.
          // Non-CC gateways (gift_card, manual) on different dates are independent payments,
          // not split captures. Using all-gateway detection would incorrectly apply a
          // proportional ratio to orders like "gift card Jan 10 + manual Jan 30".
          const ccCapturesByDate = new Map<string, Transaction[]>();
          for (const txn of allCaptureTransactions) {
            if (!isCardGateway(txn.gateway)) continue;
            if ((txn.kind !== 'capture' && txn.kind !== 'sale') || txn.status !== 'success') continue;
            const txnDate = formatDateOnly(txn.processedAt);
            if (!ccCapturesByDate.has(txnDate)) ccCapturesByDate.set(txnDate, []);
            ccCapturesByDate.get(txnDate)!.push(txn);
          }
          const hasMultipleCCDates = ccCapturesByDate.size > 1;

          if (hasMultipleCCDates) {
            isMultiDateCapture = true;
            // Multi-CC-capture path: each date gets its own proportional entry
            const targetDateCCCaptures = ccCapturesByDate.get(targetDate) || [];

            if (targetDateCCCaptures.length === 0 && refundTransactions.length === 0) {
              continue;
            }

            if (targetDateCCCaptures.length === 0 && refundTransactions.length > 0) {
              await processOrderRefunds(
                shop, accessToken, order, refundTransactions, targetDate,
                journalEntries, enrichedTransactions, warnings, enrichmentCache
              );
              processedOrderIds.add(order.id);
              ordersProcessed++;
              continue;
            }

            const targetDateCCTotal = targetDateCCCaptures.reduce(
              (sum, txn) => sum.plus(txn.amount), new Decimal(0)
            );
            const orderEffectiveTotal = order.currentTotalPrice || order.totalPrice;
            captureRatio = targetDateCCTotal.dividedBy(orderEffectiveTotal);

            console.log(
              `🔀 Order ${order.name}: Multi-CC-capture split - ` +
              `${ccCapturesByDate.size} dates, targetDate ${targetDate}: ` +
              `$${targetDateCCTotal.toFixed(2)} / $${orderEffectiveTotal.toFixed(2)} = ${captureRatio.toFixed(4)}`
            );
          } else if (postingDate !== targetDate) {
            // Last capture date is on a different date — check for refunds, then skip
            if (refundTransactions.length > 0) {
              await processOrderRefunds(
                shop, accessToken, order, refundTransactions, targetDate,
                journalEntries, enrichedTransactions, warnings, enrichmentCache
              );
              processedOrderIds.add(order.id);
              ordersProcessed++;
            }
            continue;
          }
        } else {
          // No posting date (no closedAt, no captures) — should not reach here
          // since we already checked for captures above, but safety guard
          continue;
        }

        // POINT-IN-TIME FILTERING:
        // - Fulfillment date (no multi-date): captures on or before fulfillment date
        // - Multi-date capture (CC split): only targetDate captures (proportional split)
        // - Multi-date (non-CC, e.g. gift_card + manual): only targetDate captures (no ratio)
        // - Normal single-date: all captures on or before targetDate
        const fulfillmentDate = postingOnFulfillmentDate && !isMultiDateCapture
          ? postingDate : null;
        const pointInTimeCaptureTransactions = isMultiDateCapture
          ? allCaptureTransactions.filter((txn) => {
              const txnDate = formatDateOnly(txn.processedAt);
              return txnDate === targetDate;
            })
          : fulfillmentDate
            ? allCaptureTransactions.filter((txn) => {
                const txnDate = formatDateOnly(txn.processedAt);
                return txnDate <= fulfillmentDate;
              })
            : hasMultipleDates
              ? allCaptureTransactions.filter((txn) => {
                  const txnDate = formatDateOnly(txn.processedAt);
                  return txnDate === targetDate;
                })
              : allCaptureTransactions.filter((txn) => {
                  const txnDate = formatDateOnly(txn.processedAt);
                  return txnDate <= targetDate;
                });

        if (pointInTimeCaptureTransactions.length === 0) {
          // No captures on target date (multi) or on/before target date (normal)
          console.log(`⏭️  Order ${order.name}: No captures on ${isMultiDateCapture ? '' : 'or before '}${targetDate}`);
          continue;
        }

        // Check if we've already processed this order
        if (processedOrderIds.has(order.id)) {
          continue;
        }

        // Detect subsequent-date captures for non-CC multi-date orders.
        // The primary (earliest) date records full sales/tax/shipping.
        // Subsequent dates are payment-only (just the capture, no tax/shipping).
        const isSubsequentDayCapture = hasMultipleDates && !isMultiDateCapture && (() => {
          const dates = [...allCapturesByDate.keys()].sort();
          return dates[0] !== targetDate;
        })();

        // Process captures (using point-in-time filtered transactions)
        await processOrderCaptures(
          shop,
          accessToken,
          order,
          pointInTimeCaptureTransactions,
          targetDate,
          journalEntries,
          enrichedTransactions,
          warnings,
          errors,
          effectiveCogsDataMap,
          captureRatio,
          enrichmentCache,
          skipCogs,
          hasMultipleDates,
          isSubsequentDayCapture
        );

        // Process refunds (if any on target date)
        if (refundTransactions.length > 0) {
          await processOrderRefunds(
            shop,
            accessToken,
            order,
            refundTransactions,
            targetDate,
            journalEntries,
            enrichedTransactions,
            warnings,
            enrichmentCache
          );
        }

        // Mark order as processed
        processedOrderIds.add(order.id);
        ordersProcessed++;
        capturesProcessed += pointInTimeCaptureTransactions.length;
      } catch (error) {
        errors.push(
          `Failed to process order ${order.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // VALIDATION: Verify each SO- reference balances (per-order balance check)
    const soReferences = new Set(
      journalEntries
        .filter((entry) => entry.reference.startsWith('SO-'))
        .map((entry) => entry.reference)
    );

    for (const reference of soReferences) {
      const refEntries = journalEntries.filter((entry) => entry.reference === reference);
      const refDebits = refEntries.reduce((sum, entry) => sum.plus(entry.debit), new Decimal(0));
      const refCredits = refEntries.reduce((sum, entry) => sum.plus(entry.credit), new Decimal(0));
      const refDiff = refDebits.minus(refCredits).abs();

      if (refDiff.greaterThan(new Decimal('0.01'))) {
        errors.push(
          `❌ ${reference} does NOT balance: Debits=${refDebits.toFixed(2)}, ` +
          `Credits=${refCredits.toFixed(2)}, Diff=${refDebits.minus(refCredits).toFixed(2)}`
        );
      }
    }

    // Calculate totals and validate overall balance
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

    return {
      journalEntries,
      enrichedTransactions,
      orders, // Return fetched orders to avoid duplicate fetching
      processedOrderIds, // Return orders that generated journal entries
      balanced,
      errors,
      warnings,
      cogsWarnings,
      cogsDataMap: effectiveCogsDataMap, // Return pre-calculated COGS for reuse in COGS detail CSV
      orderCount: ordersProcessed,
      captureCount: capturesProcessed,
    };
  } catch (error) {
    errors.push(
      `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );

    return {
      journalEntries,
      enrichedTransactions,
      orders: [], // Return empty array on error
      processedOrderIds: new Set<string>(), // Return empty set on error
      balanced: false,
      errors,
      warnings,
      cogsWarnings,
      orderCount: 0,
      captureCount: 0,
    };
  }
}

/**
 * Collect COGS data for orders
 * Used to generate COGS detail CSV file
 *
 * NEW: Now uses fulfillment-based calculation to exclude removed items
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token (for fulfillment filtering)
 * @param orders - Array of orders
 * @returns Map of order ID to COGS calculation
 */
export async function collectCogsData(
  shop: string,
  accessToken: string,
  orders: Order[]
): Promise<Map<string, CogsCalculation>> {
  const cogsDataMap = new Map<string, CogsCalculation>();

  // Check if Cin7 is enabled
  const cin7Enabled = await isCin7Enabled(shop);
  if (!cin7Enabled) {
    return cogsDataMap;
  }

  // OPTIMIZATION (Phase 2): Initialize Cin7 service ONCE for all orders
  const cin7Service = new Cin7ProductService(shop);
  await cin7Service.initialize();

  // OPTIMIZATION: Collect all unique SKUs across all orders first
  const uniqueSkus = new Set<string>();
  for (const order of orders) {
    for (const lineItem of order.lineItems) {
      if (lineItem.sku) {
        uniqueSkus.add(lineItem.sku);
      }
    }
  }

  // Pre-fetch all costs in one batch (with rate limiting and caching)
  const skuArray = Array.from(uniqueSkus);
  await cin7Service.batchGetCosts(skuArray);

  // Now calculate COGS for each order (costs are cached, so this is fast)
  // OPTIMIZATION (Phase 2): Reuse same cin7Service instance for all orders
  // NEW: Pass shop and accessToken to enable fulfillment-based filtering
  for (const order of orders) {
    try {
      const cogsCalculation = await calculateOrderCogsWithService(
        cin7Service,
        order,
        shop,
        accessToken,
        true // Use fulfillments to exclude removed items
      );
      cogsDataMap.set(order.id, cogsCalculation);
    } catch (error) {
      console.error(`Failed to calculate COGS for order ${order.name}:`, error);
    }
  }

  return cogsDataMap;
}

/**
 * Process order captures and create journal entries
 */
async function processOrderCaptures(
  shop: string,
  accessToken: string,
  order: Order,
  captureTransactions: Transaction[],
  targetDate: string,
  journalEntries: JournalEntry[],
  enrichedTransactions: EnrichedTransaction[],
  warnings: string[],
  errors: string[],
  cogsDataMap?: Map<string, CogsCalculation>,
  captureRatio?: Decimal,
  enrichmentCache?: Map<string, EnrichedOrderData | null>,
  skipCogs?: boolean,
  hasMultipleDates?: boolean,
  isSubsequentDayCapture?: boolean
): Promise<void> {
  // Analyze payment methods
  const paymentBreakdowns = await analyzeOrderPayments(
    shop,
    order,
    captureTransactions
  );

  // Validate payment totals (skip for multi-CC-capture splits - partial date won't match order total)
  const paymentErrors = validatePaymentTotal(order, paymentBreakdowns, !!captureRatio);
  if (paymentErrors.length > 0) {
    errors.push(...paymentErrors);
  }

  // Log reconciliation values for debugging (helps diagnose partial capture/refund issues)
  const usedSales = order.currentSubtotalPrice !== undefined && order.currentSubtotalPrice.gte(0)
    ? order.currentSubtotalPrice
    : order.subtotalPrice;
  const usedTax = order.currentTotalTax !== undefined
    ? order.currentTotalTax
    : (order.totalTax || new Decimal(0));
  logOrderReconciliationValues(order, { sales: usedSales, tax: usedTax });

  // Create journal entries
  const formattedDate = formatDate(targetDate);
  const preCalculatedCogs = cogsDataMap?.get(order.id);
  const entries = await createOrderJournalEntries(
    shop,
    order,
    paymentBreakdowns,
    formattedDate,
    accessToken,
    preCalculatedCogs,
    captureRatio,
    targetDate,  // Pass YYYY-MM-DD for point-in-time filtering
    skipCogs,
    isSubsequentDayCapture
  );

  journalEntries.push(...entries);

  // Compute JE summary for DR/DSR alignment
  const jeSummary = computeJESummary(entries);

  // Validate entries balance
  const reference = `SO-${order.name}`;
  const validationErrors = validateOrderEntries(entries, reference);
  if (validationErrors.length > 0) {
    errors.push(...validationErrors);
  }

  // Create fee entries for each capture transaction
  for (const txn of captureTransactions) {
    if (txn.fees.length > 0) {
      const feeEntries = await createFeeEntries(shop, txn, formattedDate);
      journalEntries.push(...feeEntries);
    }
  }

  // Enrich order data for reporting (use cache to avoid duplicate API calls)
  try {
    let enrichedData: EnrichedOrderData | null;
    if (enrichmentCache?.has(order.id)) {
      enrichedData = enrichmentCache.get(order.id) ?? null;
    } else {
      enrichedData = await enrichOrderData(shop, accessToken, order.id);
      enrichmentCache?.set(order.id, enrichedData);
    }

    // For multi-CC-capture splits, scale enriched data to match this date's portion
    const captureTotal = captureTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0));

    // Override payment breakdown when captures span multiple dates.
    // The enrichment API calculates from ALL order transactions, but each day's
    // recon should only show that day's payment methods.
    // Payment breakdown columns (gc, card, etc.) show GROSS captures only.
    // Refunds (kind='refund') are handled separately by processOrderRefunds and
    // flow through jeSummary into paymentTotal.
    if (hasMultipleDates && enrichedData) {
      const zero = new Decimal(0);
      const dayBreakdown = { cash: zero, charge: zero, giftCard: zero, storeCredit: zero, check: zero, card: zero };
      for (const txn of captureTransactions) {
        const gw = txn.gateway.toLowerCase().replace(/\s+/g, '_');
        if (gw === 'cash') dayBreakdown.cash = dayBreakdown.cash.plus(txn.amount);
        else if (gw === 'gift_card') dayBreakdown.giftCard = dayBreakdown.giftCard.plus(txn.amount);
        else if (gw === 'shopify_payments') dayBreakdown.card = dayBreakdown.card.plus(txn.amount);
        else if (gw === 'shopify_store_credit' || gw === 'store_credit') dayBreakdown.storeCredit = dayBreakdown.storeCredit.plus(txn.amount);
        else if (gw === 'check' || gw === 'cheque') dayBreakdown.check = dayBreakdown.check.plus(txn.amount);
        else dayBreakdown.charge = dayBreakdown.charge.plus(txn.amount); // manual, charge, unknown → paymentOther
      }
      enrichedData = { ...enrichedData, paymentBreakdown: dayBreakdown };
    } else if (captureRatio && enrichedData) {
      // Scale payment breakdown for CC split captures so payment method columns
      // match this date's captured amount (not the full order's total captures)
      enrichedData = {
        ...enrichedData,
        paymentBreakdown: {
          cash: enrichedData.paymentBreakdown.cash.times(captureRatio),
          card: enrichedData.paymentBreakdown.card.times(captureRatio),
          charge: enrichedData.paymentBreakdown.charge.times(captureRatio),
          giftCard: enrichedData.paymentBreakdown.giftCard.times(captureRatio),
          storeCredit: enrichedData.paymentBreakdown.storeCredit.times(captureRatio),
          check: enrichedData.paymentBreakdown.check.times(captureRatio),
        },
      };
    }

    // POINT-IN-TIME: Compute current values as of targetDate, undoing future refunds.
    // Shopify's currentSubtotalPrice/currentTotalTax reflect ALL refunds (including future ones).
    // The DR and DSR need values that only reflect refunds up to targetDate.
    const pointInTime = getPointInTimeAmounts(order, targetDate);

    // Detect uncaptured authorizations (CC auth with no corresponding capture)
    const uncapturedAuths = detectUncapturedAuths(order);
    if (uncapturedAuths.length > 0) {
      for (const auth of uncapturedAuths) {
        warnings.push(
          `⚠️ Order ${order.name}: Uncaptured ${auth.gateway} authorization $${auth.amount} ` +
          `(authorized ${auth.date})`
        );
      }
    }

    const enrichedOrder = {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      totalPrice: (isSubsequentDayCapture || captureRatio) ? captureTotal : order.totalPrice,
      subtotalPrice: (isSubsequentDayCapture || captureRatio) ? captureTotal : order.subtotalPrice,
      currentTotalPrice: (isSubsequentDayCapture || captureRatio) ? captureTotal : (order.currentTotalPrice || order.totalPrice),
      currentSubtotalPrice: (isSubsequentDayCapture || captureRatio) ? captureTotal : pointInTime.subtotal,
      currentTotalTax: isSubsequentDayCapture ? new Decimal(0)
        : captureRatio ? scaleDecimal(order.currentTotalTax, captureRatio)
        : pointInTime.tax,
      totalTax: isSubsequentDayCapture ? new Decimal(0)
        : captureRatio ? scaleDecimal(order.totalTax, captureRatio)
        : order.totalTax,
      totalShipping: isSubsequentDayCapture ? new Decimal(0)
        : captureRatio ? scaleDecimal(order.totalShipping, captureRatio)
        : order.totalShipping,
      totalDiscounts: isSubsequentDayCapture ? new Decimal(0)
        : captureRatio ? scaleDecimal(order.totalDiscounts, captureRatio)
        : order.totalDiscounts,
      financialStatus: order.financialStatus,
      lineItems: order.lineItems,
      hasActualRefunds: hasActualRefunds(order, targetDate),
      isMultiCaptureSplit: !!captureRatio,  // NOT set for subsequent-day (no "split capture" note)
      outstandingAuths: uncapturedAuths.length > 0 ? uncapturedAuths : undefined,
    };

    enrichedTransactions.push({
      balanceTransaction: {
        id: captureTransactions[0].id, // Use first capture for reference
        type: 'charge',
        sourceOrderId: order.id,
        processedAt: captureTransactions[0].processedAt,
        net: captureTotal,
        fee: new Decimal(0), // Fees tracked separately
        gross: captureTotal,
      },
      order: enrichedOrder,
      enrichedData: enrichedData || undefined,
      jeSummary,
      payout: {
        id: 'Direct Payment', // Order-centric: no payout reference
        date: targetDate,
        amount: new Decimal(0), // Not applicable for order-centric
      },
    });
  } catch (enrichError) {
    console.error(`Failed to enrich order ${order.name}:`, enrichError);
    warnings.push(`Failed to enrich order ${order.name} for export`);

    // Still push to enrichedTransactions with undefined enrichedData
    // so the order appears in ALL report CSVs (not silently dropped)
    const captureTotal = captureTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0));
    const pointInTimeFallback = getPointInTimeAmounts(order, targetDate);
    enrichedTransactions.push({
      balanceTransaction: {
        id: captureTransactions[0].id,
        type: 'charge',
        sourceOrderId: order.id,
        processedAt: captureTransactions[0].processedAt,
        net: captureTotal,
        fee: new Decimal(0),
        gross: captureTotal,
      },
      order: {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        totalPrice: captureRatio ? captureTotal : order.totalPrice,
        subtotalPrice: captureRatio ? captureTotal : order.subtotalPrice,
        currentTotalPrice: captureRatio ? captureTotal : (order.currentTotalPrice || order.totalPrice),
        currentSubtotalPrice: captureRatio ? captureTotal : pointInTimeFallback.subtotal,
        currentTotalTax: captureRatio ? scaleDecimal(order.currentTotalTax, captureRatio) : pointInTimeFallback.tax,
        totalTax: captureRatio ? scaleDecimal(order.totalTax, captureRatio) : order.totalTax,
        totalShipping: captureRatio ? scaleDecimal(order.totalShipping, captureRatio) : order.totalShipping,
        totalDiscounts: captureRatio ? scaleDecimal(order.totalDiscounts, captureRatio) : order.totalDiscounts,
        financialStatus: order.financialStatus,
        lineItems: order.lineItems,
        hasActualRefunds: hasActualRefunds(order, targetDate),
        isMultiCaptureSplit: !!captureRatio,
      },
      enrichedData: undefined,
      jeSummary,
      payout: {
        id: 'Direct Payment',
        date: targetDate,
        amount: new Decimal(0),
      },
    });
  }
}

/**
 * Process order refunds and create journal entries
 */
async function processOrderRefunds(
  shop: string,
  accessToken: string,
  order: Order,
  refundTransactions: Transaction[],
  targetDate: string,
  journalEntries: JournalEntry[],
  enrichedTransactions: EnrichedTransaction[],
  warnings: string[],
  enrichmentCache?: Map<string, EnrichedOrderData | null>
): Promise<void> {
  const formattedDate = formatDate(targetDate);
  const entries = await createRefundJournalEntries(
    shop,
    order,
    refundTransactions,
    formattedDate
  );

  journalEntries.push(...entries);

  // Compute JE summary for DR/DSR alignment
  const refundJeSummary = computeJESummary(entries);

  // Enrich order data for refund reporting (use cache to avoid duplicate API calls)
  try {
    let enrichedData: EnrichedOrderData | null;
    if (enrichmentCache?.has(order.id)) {
      enrichedData = enrichmentCache.get(order.id) ?? null;
    } else {
      enrichedData = await enrichOrderData(shop, accessToken, order.id);
      enrichmentCache?.set(order.id, enrichedData);
    }

    // POINT-IN-TIME: Use adjusted current values for refund-path orders too
    const refundPointInTime = getPointInTimeAmounts(order, targetDate);

    enrichedTransactions.push({
      balanceTransaction: {
        id: refundTransactions[0].id,
        type: 'refund',
        sourceOrderId: order.id,
        processedAt: refundTransactions[0].processedAt,
        net: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
        fee: new Decimal(0),
        gross: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
      },
      order: {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        subtotalPrice: order.subtotalPrice,
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        currentSubtotalPrice: refundPointInTime.subtotal,
        currentTotalTax: refundPointInTime.tax,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
        lineItems: order.lineItems,
        hasActualRefunds: hasActualRefunds(order, targetDate),
      },
      enrichedData: enrichedData || undefined,
      jeSummary: refundJeSummary,
      payout: {
        id: 'Direct Payment',
        date: targetDate,
        amount: new Decimal(0),
      },
    });
  } catch (enrichError) {
    console.error(`Failed to enrich refund order ${order.name}:`, enrichError);
    warnings.push(`Failed to enrich refund order ${order.name} for export`);

    // Still push to enrichedTransactions with undefined enrichedData
    // so the refund appears in ALL report CSVs (not silently dropped)
    const refundPointInTimeFallback = getPointInTimeAmounts(order, targetDate);
    enrichedTransactions.push({
      balanceTransaction: {
        id: refundTransactions[0].id,
        type: 'refund',
        sourceOrderId: order.id,
        processedAt: refundTransactions[0].processedAt,
        net: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
        fee: new Decimal(0),
        gross: refundTransactions.reduce((sum, txn) => sum.plus(txn.amount), new Decimal(0)),
      },
      order: {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        subtotalPrice: order.subtotalPrice,
        currentTotalPrice: order.currentTotalPrice || order.totalPrice,
        currentSubtotalPrice: refundPointInTimeFallback.subtotal,
        currentTotalTax: refundPointInTimeFallback.tax,
        totalTax: order.totalTax,
        totalShipping: order.totalShipping,
        totalDiscounts: order.totalDiscounts,
        financialStatus: order.financialStatus,
        lineItems: order.lineItems,
        hasActualRefunds: hasActualRefunds(order, targetDate),
      },
      enrichedData: undefined,
      jeSummary: refundJeSummary,
      payout: {
        id: 'Direct Payment',
        date: targetDate,
        amount: new Decimal(0),
      },
    });
  }
}

/**
 * Filter refund transactions by date.
 *
 * For shopify_payments refunds, uses the balance transaction settlement date
 * (when the refund was actually processed) instead of the order transaction
 * processedAt (when the refund was initiated/pending).
 *
 * @param order - Order with transactions
 * @param targetDate - Target date (YYYY-MM-DD)
 * @param refundSettlementMap - Map of "orderId:amount" → settlement date from balance transactions
 */
function filterRefundTransactions(
  order: Order,
  targetDate: string,
  refundSettlementMap?: Map<string, string>
): Transaction[] {
  if (!order.transactions || order.transactions.length === 0) {
    return [];
  }

  return order.transactions.filter((txn) => {
    if (txn.kind !== 'refund') return false;
    if (txn.status !== 'success') return false;

    let txnDate: string;

    // For shopify_payments refunds, use the settlement date from balance transactions
    // instead of the order transaction processedAt (which is the initiation date)
    if (txn.gateway === 'shopify_payments' && refundSettlementMap && refundSettlementMap.size > 0) {
      const key = `${order.id}:${txn.amount.abs().toFixed(2)}`;
      const settlementDate = refundSettlementMap.get(key);
      if (settlementDate) {
        console.log(
          `📋 Order ${order.name}: Refund $${txn.amount.abs().toFixed(2)} settlement date ` +
          `overridden from ${formatDateOnly(txn.processedAt)} → ${settlementDate}`
        );
        txnDate = settlementDate;
      } else {
        // No balance transaction found — fall back to order transaction processedAt
        console.log(
          `📋 Order ${order.name}: Refund $${txn.amount.abs().toFixed(2)} - no settlement date found ` +
          `(key=${key}, map size=${refundSettlementMap.size}). Using processedAt=${formatDateOnly(txn.processedAt)}`
        );
        txnDate = formatDateOnly(txn.processedAt);
      }
    } else {
      txnDate = formatDateOnly(txn.processedAt);
    }

    return txnDate === targetDate;
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
 *
 * CRITICAL: Converts UTC timestamp to store's local timezone (Pacific)
 * before extracting the date. This ensures orders captured in the evening
 * Pacific time don't appear on the next day's journal entry.
 *
 * Example:
 * - UTC: 2026-01-29 01:00:00 UTC
 * - Pacific: 2026-01-28 17:00:00 PST
 * - Returns: "2026-01-28" (correct date for journal entry)
 */
function formatDateOnly(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  // Convert to Pacific timezone (America/Los_Angeles)
  // This handles both PST (-0800) and PDT (-0700) automatically
  const pacificDateString = date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse MM/DD/YYYY format to YYYY-MM-DD
  const [month, day, year] = pacificDateString.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Determine the posting date for an order.
 *
 * For online orders with gift card transactions: use fulfillment date
 * (fulfilledAt > closedAt) so all payment legs post together. Gift card
 * captures fire immediately at order creation, but the order should post
 * when fulfilled (same day CC captures).
 *
 * For all other orders (POS, pure CC online): use last capture date.
 * POS orders fulfill instantly, and pure CC orders capture at fulfillment,
 * so capture date is already correct.
 */
function getOrderPostingDate(order: Order, targetDate: string): string | null {
  if (shouldUseFulfillmentDate(order)) {
    if (order.fulfilledAt) {
      return formatDateOnly(order.fulfilledAt);
    }
    if (order.closedAt) {
      return formatDateOnly(order.closedAt);
    }
  }
  return getOrderCaptureDate(order, targetDate);
}

/**
 * Check if an order should use fulfillment date for posting.
 * Only online orders with gift card payment transactions need this,
 * because gift card captures fire immediately at order creation
 * (before fulfillment), causing a timing mismatch.
 */
function shouldUseFulfillmentDate(order: Order): boolean {
  // POS orders fulfill instantly — no timing mismatch
  if (order.sourceName === 'pos') return false;

  // Only orders with gift card transactions need fulfillment date posting
  if (!order.transactions || order.transactions.length === 0) return false;
  return order.transactions.some(
    (txn) => (txn.kind === 'capture' || txn.kind === 'sale') &&
             txn.status === 'success' &&
             txn.gateway === 'gift_card'
  );
}

/**
 * Check if a gateway is a credit card / clearing account gateway.
 * These are gateways where the payment goes through a clearing account (e.g., Shopify Payments).
 */
function isCardGateway(gateway: string): boolean {
  const normalized = gateway.toLowerCase().replace(/\s+/g, '_');
  // shopify_payments is the primary CC gateway; add others as needed
  return normalized === 'shopify_payments';
}

/**
 * Group ALL capture/sale transactions by Pacific-timezone date (any gateway).
 * Used to detect multi-date capture patterns across all payment methods
 * (gift_card, manual, shopify_payments, etc.).
 *
 * @param transactions - All capture/sale transactions for an order
 * @returns Map of date string (YYYY-MM-DD) → capture transactions on that date
 */
function groupAllCapturesByDate(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();

  for (const txn of transactions) {
    if ((txn.kind !== 'capture' && txn.kind !== 'sale') || txn.status !== 'success') continue;

    const txnDate = formatDateOnly(txn.processedAt);

    if (!groups.has(txnDate)) {
      groups.set(txnDate, []);
    }
    groups.get(txnDate)!.push(txn);
  }

  return groups;
}

/**
 * Scale a Decimal value by a ratio, handling undefined/null gracefully.
 * Used for proportional allocation in multi-date capture splits.
 */
function scaleDecimal(value: Decimal | undefined, ratio: Decimal | undefined): Decimal {
  if (!value || !ratio) return value || new Decimal(0);
  return value.times(ratio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Detect uncaptured authorization transactions on an order.
 * Returns auth transactions where no corresponding capture/sale exists for the same gateway.
 */
function detectUncapturedAuths(order: Order): Array<{ gateway: string; amount: string; date: string }> {
  if (!order.transactions || order.transactions.length === 0) return [];

  return order.transactions
    .filter(txn => {
      if (txn.kind !== 'authorization' || txn.status !== 'success') return false;
      // Check if there's a capture/sale for the same gateway
      const hasCapture = order.transactions!.some(
        t => (t.kind === 'capture' || t.kind === 'sale') &&
             t.status === 'success' && t.gateway === txn.gateway
      );
      return !hasCapture;
    })
    .map(txn => ({
      gateway: txn.gateway,
      amount: txn.amount.toFixed(2),
      date: formatDateOnly(txn.processedAt),
    }));
}

/**
 * Build a map of refund settlement dates from Shopify Payments balance transactions.
 *
 * For shopify_payments refunds, the order transaction processedAt is the initiation date
 * (when refund is pending), not the settlement date. The balance transaction processedAt
 * reflects when the refund was actually settled.
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param targetDate - Target date (YYYY-MM-DD)
 * @returns Map of "orderId:amount" → settlement date (YYYY-MM-DD Pacific)
 */
async function buildRefundSettlementMap(
  shop: string,
  accessToken: string,
  targetDate: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    // Fetch balance transactions for payouts around targetDate.
    // Refund deductions appear in payouts 2-4 days after settlement.
    const payoutStart = addDays(targetDate, -2);
    const payoutEnd = addDays(targetDate, 5);

    const balanceTxns = await fetchBalanceTransactionsByDate(shop, accessToken, payoutStart, payoutEnd);

    console.log(
      `📋 Refund settlement: Fetched ${balanceTxns.length} balance transactions ` +
      `(payout range ${payoutStart} to ${payoutEnd} for target ${targetDate})`
    );

    let refundCount = 0;
    for (const bt of balanceTxns) {
      if (bt.type === 'refund' && bt.sourceOrderId) {
        const key = `${bt.sourceOrderId}:${bt.gross.abs().toFixed(2)}`;
        const settlementDate = formatDateOnly(bt.processedAt);
        map.set(key, settlementDate);
        refundCount++;
        console.log(
          `  📋 Refund settlement entry: order=${bt.sourceOrderId}, ` +
          `amount=$${bt.gross.abs().toFixed(2)}, settlement=${settlementDate}, key=${key}`
        );
      }
    }

    if (refundCount > 0) {
      console.log(`📋 Refund settlement map: ${map.size} entries from ${refundCount} refund balance transactions`);
    } else {
      console.log(`📋 Refund settlement map: No refund balance transactions found`);
    }
  } catch (error) {
    console.warn(
      `⚠️ Failed to fetch balance transactions for refund settlement dates: ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to order transaction processedAt.`
    );
  }

  return map;
}

/**
 * Add days to a date string (YYYY-MM-DD format)
 */
function addDays(dateString: string, days: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
