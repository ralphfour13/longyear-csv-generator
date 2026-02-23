import { Decimal } from 'decimal.js';
import type { ExportHistoryEntry, ReconciliationResult, JournalEntry } from '../types/journal-entry';
import { fetchPayouts } from './shopify/payout-fetcher.server';
import { fetchOrdersByDateRange } from './shopify/order-fetcher.server';
import { reconcilePayout } from './reconciler.server';
import { applyAccountMappings } from './account-mapper.server';
import { generateCSV, generateFilename, validateEntries } from './csv-generator.server';
import { getAccountMappings, getShopConfig } from './storage.server';
import { randomUUID } from 'crypto';
import { logError, logWarning, logInfo } from './error-logger.server';
import { validateExportRequest, validateEntriesBalanceToPayout } from './validator.server';

/**
 * Process payouts and generate CSV export
 *
 * This is the main orchestration function that:
 * 1. Fetches payouts for the date range
 * 2. Reconciles each payout (payout-first)
 * 3. Applies account mappings
 * 4. Generates CSV file
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Export history entry with download info
 */
export async function processExport(
  shop: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<ExportHistoryEntry> {
  await logInfo(shop, 'Export', `Starting export from ${startDate} to ${endDate}`);

  try {
    // Step 0: Validate request
    const config = await getShopConfig(shop);
    const mappings = await getAccountMappings(shop);

    const validation = validateExportRequest(startDate, endDate, config, mappings);
    if (!validation.valid) {
      const errorMsg = `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`;
      await logError(shop, 'Export Validation', errorMsg, validation.errors);
      throw new Error(errorMsg);
    }

    // Step 1: Fetch all payouts for date range
    await logInfo(shop, 'Export', 'Fetching payouts...');
    const payouts = await fetchPayouts(shop, accessToken, startDate, endDate);
    await logInfo(shop, 'Export', `Found ${payouts.length} payouts`);

    const allJournalEntries: JournalEntry[] = [];
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (payouts.length === 0) {
      // No payouts found - fall back to order-based export
      await logWarning(shop, 'Export', `No payouts found for ${startDate} to ${endDate}, using order-based export`);

      await logInfo(shop, 'Export', 'Fetching orders directly...');
      const orders = await fetchOrdersByDateRange(shop, accessToken, startDate, endDate);
      await logInfo(shop, 'Export', `Found ${orders.length} orders`);

      if (orders.length === 0) {
        const errorMsg = `No orders found for date range ${startDate} to ${endDate}`;
        await logWarning(shop, 'Export', errorMsg);
        throw new Error(errorMsg);
      }

      // Create SO- entries for each order
      for (const order of orders) {
        try {
          const entries = createOrderEntriesFromOrder(order, allErrors);
          allJournalEntries.push(...entries);
        } catch (error) {
          const errorMsg = `Failed to create entries for order ${order.name}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          await logError(shop, 'Export', errorMsg);
          allErrors.push(errorMsg);
        }
      }
    } else {
      // Step 2: Reconcile each payout (normal payout-based export)
      await logInfo(shop, 'Export', 'Reconciling payouts...');

      for (const payout of payouts) {
        try {
          await logInfo(shop, 'Reconcile', `Processing payout ${payout.id} (${payout.amount.toFixed(2)} ${payout.currency})`);

          const result = await reconcilePayout(shop, accessToken, payout);

          // Validate that entries balance to payout
          const balanceValidation = validateEntriesBalanceToPayout(
            result.journalEntries,
            payout.amount
          );

          if (!balanceValidation.valid) {
            await logWarning(shop, 'Reconcile', `Payout ${payout.id} validation failed`, balanceValidation.errors);
            allWarnings.push(...balanceValidation.errors.map(e => e.message));
          }

          allJournalEntries.push(...result.journalEntries);
          allErrors.push(...result.errors);
          allWarnings.push(...result.warnings);

          if (!result.balanced) {
            await logWarning(shop, 'Reconcile', `Payout ${payout.id} is not balanced!`);
          }
        } catch (error) {
          const errorMsg = `Failed to reconcile payout ${payout.id}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          await logError(shop, 'Reconcile', errorMsg);
          allErrors.push(errorMsg);
        }
      }
    }

    if (allJournalEntries.length === 0) {
      const errorMsg = 'No journal entries generated';
      await logError(shop, 'Export', errorMsg);
      throw new Error(errorMsg);
    }

    await logInfo(shop, 'Export', `Generated ${allJournalEntries.length} journal entries`);

    // Step 3: Apply account mappings
    await logInfo(shop, 'Export', 'Applying account mappings...');
    const mappedEntries = applyAccountMappings(allJournalEntries, mappings);

    // Step 4: Validate entries
    await logInfo(shop, 'Export', 'Validating entries...');
    const validationErrors = validateEntries(mappedEntries);

    if (validationErrors.length > 0) {
      await logError(shop, 'Validation', 'Entry validation failed', validationErrors);
      allErrors.push(...validationErrors);
    }

    // Step 5: Generate detailed journal entries CSV
    await logInfo(shop, 'Export', 'Generating detailed journal entries CSV...');
    const filename = generateFilename(startDate, endDate);
    const filePath = await generateCSV(shop, mappedEntries, filename);

    console.log(`✅ Detailed CSV created at: ${filePath}`);
    await logInfo(shop, 'Export', `Detailed CSV saved to: ${filePath}`);

    // Step 5b: Generate daily summary (if single date)
    let summaryFilename: string | undefined;
    if (startDate === endDate) {
      await logInfo(shop, 'Export', 'Generating daily summary...');

      const { generateDailySummary } = await import('./daily-summary-generator.server');

      try {
        const summaryPath = await generateDailySummary(
          shop,
          mappedEntries,
          startDate,
          { includeFees: true, includePayouts: true }
        );

        summaryFilename = `daily-sales-report_${startDate}.csv`;
        console.log(`✅ Daily summary created: ${summaryFilename}`);
        await logInfo(shop, 'Export', `Daily summary saved: ${summaryFilename}`);
      } catch (error) {
        console.warn('Failed to generate daily summary:', error);
        await logWarning(shop, 'Export', `Daily summary generation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Step 6: Calculate totals
    const totalDebit = mappedEntries.reduce(
      (sum, entry) => sum.plus(entry.debit),
      new Decimal(0)
    );
    const totalCredit = mappedEntries.reduce(
      (sum, entry) => sum.plus(entry.credit),
      new Decimal(0)
    );

    // Step 7: Create export history entry
    const exportEntry: ExportHistoryEntry = {
      id: randomUUID(),
      date: startDate,
      filename,
      entryCount: mappedEntries.length,
      totalDebit,
      totalCredit,
      balanced: totalDebit.equals(totalCredit),
      createdAt: new Date().toISOString(),
      downloadUrl: `/api/download-csv?shop=${shop}&filename=${filename}`,
    };

    // Add summary filename to metadata if generated
    if (summaryFilename) {
      (exportEntry as any).summaryFilename = summaryFilename;
    }

    await logInfo(shop, 'Export', `Export complete: ${filename}`, {
      entryCount: mappedEntries.length,
      balanced: totalDebit.equals(totalCredit),
    });

    if (allErrors.length > 0) {
      await logError(shop, 'Export', 'Export completed with errors', allErrors);
    }

    if (allWarnings.length > 0) {
      await logWarning(shop, 'Export', 'Export completed with warnings', allWarnings);
    }

    return exportEntry;
  } catch (error) {
    await logError(shop, 'Export', error as Error);
    throw error;
  }
}

/**
 * Calculate date for auto-export based on config
 *
 * @param autoExportDate - Config value: 'yesterday', 'today', 'last_7_days'
 * @returns Object with startDate and endDate (YYYY-MM-DD format)
 */
export function calculateExportDates(autoExportDate: string): {
  startDate: string;
  endDate: string;
} {
  const today = new Date();
  let startDate: Date;
  let endDate: Date;

  switch (autoExportDate) {
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday;
      endDate = yesterday;
      break;
    }

    case 'today': {
      startDate = today;
      endDate = today;
      break;
    }

    case 'last_7_days': {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      startDate = sevenDaysAgo;
      endDate = today;
      break;
    }

    default: {
      // Default to yesterday
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday;
      endDate = yesterday;
    }
  }

  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate),
  };
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Create journal entries directly from an order (without balance transaction)
 * Used when generating order-based exports without payouts
 */
function createOrderEntriesFromOrder(
  order: any,
  errors: string[]
): JournalEntry[] {
  const entries: JournalEntry[] = [];
  const orderDate = formatDate(order.createdAt);
  const reference = `SO-${order.name}`;

  // AR Debit: What customer actually paid (use CURRENT total for edited orders)
  const arAmount = order.currentTotalPrice || order.totalPrice;

  entries.push({
    date: orderDate,
    reference,
    account: '1250-00',
    accountName: 'Shopify Clearing Account',
    debit: arAmount,
    credit: new Decimal(0),
    memo: `Order ${order.name}`,
  });

  // Calculate GROSS sales (before discounts)
  const discountAmount = order.currentTotalDiscounts || order.totalDiscounts || new Decimal(0);

  let grossSales: Decimal;
  if (order.currentSubtotalPrice) {
    // For edited orders: NET + Discount = GROSS
    grossSales = order.currentSubtotalPrice.plus(discountAmount);
  } else {
    // For standard orders: sum line item prices (GROSS per item)
    grossSales = order.lineItems.reduce(
      (sum: Decimal, item: any) => sum.plus(new Decimal(item.price).times(item.quantity)),
      new Decimal(0)
    );
  }

  // Credit: Sales Revenue (GROSS)
  entries.push({
    date: orderDate,
    reference,
    account: '4000-00',
    accountName: 'Sales Revenue',
    debit: new Decimal(0),
    credit: grossSales,
    memo: `Sales - Order ${order.name}`,
  });

  // Debit: Discounts (if any)
  if (discountAmount.greaterThan(0)) {
    entries.push({
      date: orderDate,
      reference,
      account: '4050-00',
      accountName: 'Discounts Given',
      debit: discountAmount,
      credit: new Decimal(0),
      memo: `Discount - Order ${order.name}`,
    });
  }

  // Credit: Sales Tax (only if > 0)
  const taxAmount = order.totalTax || new Decimal(0);
  if (taxAmount.greaterThan(0)) {
    entries.push({
      date: orderDate,
      reference,
      account: '2200-00',
      accountName: 'Sales Tax Payable',
      debit: new Decimal(0),
      credit: taxAmount,
      memo: `Sales Tax - Order ${order.name}`,
    });
  }

  // Credit: Shipping Revenue (only if > 0)
  const shippingAmount = order.totalShipping || new Decimal(0);
  if (shippingAmount.greaterThan(0)) {
    entries.push({
      date: orderDate,
      reference,
      account: '4100-00',
      accountName: 'Shipping Revenue',
      debit: new Decimal(0),
      credit: shippingAmount,
      memo: `Shipping - Order ${order.name}`,
    });
  }

  // Validation
  const totalDebits = arAmount.plus(discountAmount);
  const totalCredits = grossSales.plus(taxAmount).plus(shippingAmount);
  const diff = totalDebits.minus(totalCredits).abs();
  const isBalanced = diff.lessThanOrEqualTo(new Decimal('0.01'));

  if (!isBalanced) {
    const errorMsg = `Order ${order.name} IMBALANCE: ` +
      `Debits=${totalDebits.toFixed(2)}, Credits=${totalCredits.toFixed(2)} ` +
      `(diff=${totalDebits.minus(totalCredits).toFixed(2)})`;
    errors.push(errorMsg);
  }

  return entries;
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
