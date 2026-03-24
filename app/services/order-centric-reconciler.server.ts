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
  cogsDataMap?: Map<string, CogsCalculation>  // Pre-calculated COGS data for consistency
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
    if (!cogsDataMap) {
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
          // Still check for refunds on targetDate before skipping entirely
          const refundTxns = filterRefundTransactions(order, targetDate);
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

        // GIFT CARD-ONLY ORDERS: Post on closed_at (fulfillment) date instead of sale transaction date.
        // Gift card 'sale' transactions fire immediately at order creation, but accounting
        // should match CC behavior (post when order is fulfilled).
        // Fallback: if closed_at is not set (common for POS orders), use the sale transaction date
        // since POS orders are fulfilled instantly at creation.
        const giftCardOnly = isGiftCardOnlyOrder(order);
        if (giftCardOnly) {
          const closedDate = order.closedAt ? formatDateOnly(order.closedAt) : null;
          const saleTxnDate = getOrderCaptureDate(order, targetDate);
          const effectiveDate = closedDate || saleTxnDate;

          if (!effectiveDate || effectiveDate !== targetDate) {
            // Check for refunds on this date
            const refundTxns = filterRefundTransactions(order, targetDate);
            if (refundTxns.length > 0) {
              await processOrderRefunds(
                shop, accessToken, order, refundTxns, targetDate,
                journalEntries, enrichedTransactions, warnings, enrichmentCache
              );
              processedOrderIds.add(order.id);
              ordersProcessed++;
            }
            continue;
          }
          // effectiveDate === targetDate: fall through to normal processing
        }

        // REFUND-ONLY ORDERS: Handle standalone refunds (where original sale was on prior date)
        // Check this BEFORE capture logic to catch refund-only transactions
        const allCaptureTransactions = order.transactions?.filter(
          (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
        ) || [];

        if (allCaptureTransactions.length === 0) {
          // No captures - check if this is a refund-only order
          const refundTransactions = filterRefundTransactions(order, targetDate);
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
        const refundTransactions = filterRefundTransactions(order, targetDate);

        // MULTI-CC-CAPTURE DETECTION: Check if CC captures span multiple dates
        // IMPORTANT: Look at ALL captures (not point-in-time filtered) to detect multi-date pattern.
        // Otherwise, when processing Jan 5 for an order with CC captures on Jan 5 AND Jan 15,
        // we'd only see 1 date and incorrectly post the full order on Jan 5.
        const ccCapturesByDate = groupCCCapturesByDate(allCaptureTransactions);
        const isMultiDateCCCapture = ccCapturesByDate.size > 1;

        let captureRatio: Decimal | undefined;

        if (isMultiDateCCCapture) {
          // Multi-CC-capture path: each date gets its own proportional entry
          const targetDateCCCaptures = ccCapturesByDate.get(targetDate) || [];

          if (targetDateCCCaptures.length === 0 && refundTransactions.length === 0) {
            // No CC captures and no refunds on this date - skip
            continue;
          }

          if (targetDateCCCaptures.length === 0 && refundTransactions.length > 0) {
            // Refund-only on this date for a multi-capture order
            await processOrderRefunds(
              shop, accessToken, order, refundTransactions, targetDate,
              journalEntries, enrichedTransactions, warnings, enrichmentCache
            );
            processedOrderIds.add(order.id);
            ordersProcessed++;
            continue;
          }

          // Compute captureRatio = targetDateCCTotal / orderEffectiveTotal
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
        } else if (!giftCardOnly) {
          // LAST-CAPTURE-DATE RULE: Order posts on the date of its LAST captured payment
          // This ensures split-payment orders post as a complete unit (all legs balance)
          // POINT-IN-TIME: Only consider captures up to target date (no future knowledge)
          // NOTE: Gift card-only orders skip this — they already validated via closed_at above.
          const lastCaptureDate = getOrderCaptureDate(order, targetDate);

          if (!lastCaptureDate) {
            // Should not happen since we checked for captures above, but safety check
            continue;
          }

          if (lastCaptureDate !== targetDate) {
            // This order's last capture is on a different date
            // BUT check if there are refunds on target date before skipping
            if (refundTransactions.length > 0) {
              // Process refunds for this order even though capture was on different date
              await processOrderRefunds(
                shop, accessToken, order, refundTransactions, targetDate,
                journalEntries, enrichedTransactions, warnings, enrichmentCache
              );
              processedOrderIds.add(order.id);
              ordersProcessed++;
            }
            // Skip capture processing (will be processed when we run reconciliation for that date)
            continue;
          }
        }

        // POINT-IN-TIME FILTERING:
        // - Gift card-only: Use ALL sale transactions (posted on closed_at date, not sale date)
        // - Multi-CC-capture: Use only targetDate captures (each date gets its own portion)
        // - Normal: Use all captures on or before targetDate
        const pointInTimeCaptureTransactions = giftCardOnly
          ? allCaptureTransactions // Gift card-only: all sales posted on closed_at date
          : isMultiDateCCCapture
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
          console.log(`⏭️  Order ${order.name}: No captures on ${isMultiDateCCCapture ? '' : 'or before '}${targetDate}`);
          continue;
        }

        // Check if we've already processed this order
        if (processedOrderIds.has(order.id)) {
          continue;
        }

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
          enrichmentCache
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
  enrichmentCache?: Map<string, EnrichedOrderData | null>
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
    targetDate  // Pass YYYY-MM-DD for point-in-time filtering
  );

  journalEntries.push(...entries);

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

    // Scale payment breakdown for split captures so payment method columns
    // match this date's captured amount (not the full order's total captures)
    if (captureRatio && enrichedData) {
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

    const enrichedOrder = {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      totalPrice: captureRatio ? captureTotal : order.totalPrice,
      subtotalPrice: captureRatio ? captureTotal : order.subtotalPrice,
      currentTotalPrice: captureRatio ? captureTotal : (order.currentTotalPrice || order.totalPrice),
      currentSubtotalPrice: captureRatio ? captureTotal : pointInTime.subtotal,
      currentTotalTax: captureRatio ? scaleDecimal(order.currentTotalTax, captureRatio) : pointInTime.tax,
      totalTax: captureRatio ? scaleDecimal(order.totalTax, captureRatio) : order.totalTax,
      totalShipping: captureRatio ? scaleDecimal(order.totalShipping, captureRatio) : order.totalShipping,
      totalDiscounts: captureRatio ? scaleDecimal(order.totalDiscounts, captureRatio) : order.totalDiscounts,
      financialStatus: order.financialStatus,
      lineItems: order.lineItems,
      hasActualRefunds: hasActualRefunds(order, targetDate),
      isMultiCaptureSplit: !!captureRatio,
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
      payout: {
        id: 'Direct Payment',
        date: targetDate,
        amount: new Decimal(0),
      },
    });
  }
}

/**
 * Filter refund transactions by date
 */
function filterRefundTransactions(order: Order, targetDate: string): Transaction[] {
  if (!order.transactions || order.transactions.length === 0) {
    return [];
  }

  return order.transactions.filter((txn) => {
    // Only include refund transactions
    if (txn.kind !== 'refund') {
      return false;
    }

    // Only include successful refunds
    if (txn.status !== 'success') {
      return false;
    }

    // Check if processedAt date matches target date
    const txnDate = formatDateOnly(txn.processedAt);
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
 * Check if an order was paid entirely by gift card (no CC, no cash, no other methods).
 * Gift card-only orders post on closed_at (fulfillment) date instead of sale transaction date.
 */
function isGiftCardOnlyOrder(order: Order): boolean {
  if (!order.transactions || order.transactions.length === 0) return false;
  const captures = order.transactions.filter(
    (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
  );
  return captures.length > 0 && captures.every(txn => txn.gateway === 'gift_card');
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
 * Group CC (card gateway) capture transactions by Pacific-timezone date.
 * Includes ALL CC captures regardless of date to correctly detect multi-date patterns.
 *
 * @param transactions - All capture/sale transactions for an order
 * @returns Map of date string (YYYY-MM-DD) → CC capture transactions on that date
 */
function groupCCCapturesByDate(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();

  for (const txn of transactions) {
    if (!isCardGateway(txn.gateway)) continue;

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
 * Used for proportional allocation in multi-CC-capture splits.
 */
function scaleDecimal(value: Decimal | undefined, ratio: Decimal | undefined): Decimal {
  if (!value || !ratio) return value || new Decimal(0);
  return value.times(ratio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
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
