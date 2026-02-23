import { Decimal } from 'decimal.js';
import type { ExportHistoryEntry, ReconciliationResult, JournalEntry, EnrichedTransaction, GeneratedFile } from '../types/journal-entry';
import { fetchPayouts } from './shopify/payout-fetcher.server';
import { fetchOrdersByDateRange } from './shopify/order-fetcher.server';
import { reconcilePayout } from './reconciler.server';
import { applyAccountMappings } from './account-mapper.server';
import { generateCSV, generateFilename, validateEntries } from './csv-generator.server';
import { getAccountMappings, getShopConfig, writeExport } from './storage.server';
import { randomUUID } from 'crypto';
import { logError, logWarning, logInfo } from './error-logger.server';
import { validateExportRequest, validateEntriesBalanceToPayout } from './validator.server';
import { generateDailySalesReport } from './daily-sales-report-generator.server';
import { generatePayoutsWithOrders } from './payouts-with-orders-generator.server';
import { generateJournalEntrySummary } from './journal-entry-summary-generator.server';

/**
 * Process payouts and generate CSV export
 *
 * This is the main orchestration function that:
 * 1. Fetches payouts from wider date range (target date +/- 60 days)
 * 2. Filters balance transactions by processedAt matching target date
 * 3. Reconciles filtered transactions (capture-date based)
 * 4. Applies account mappings
 * 5. Generates CSV file
 *
 * @param shop - Shop domain
 * @param accessToken - Shopify access token
 * @param targetDate - Target date (YYYY-MM-DD) - exports charges captured on this date
 * @returns Export history entry with download info
 */
export async function processExport(
  shop: string,
  accessToken: string,
  targetDate: string
): Promise<ExportHistoryEntry> {
  await logInfo(shop, 'Export', `Starting export for ${targetDate} (by capture date)`);

  try {
    // Step 0: Validate request
    const config = await getShopConfig(shop);
    const mappings = await getAccountMappings(shop);

    const validation = validateExportRequest(targetDate, targetDate, config, mappings);
    if (!validation.valid) {
      const errorMsg = `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`;
      await logError(shop, 'Export Validation', errorMsg, validation.errors);
      throw new Error(errorMsg);
    }

    // Step 1: Fetch payouts from wider date range (target +/- 60 days)
    const lookbackDate = calculateDateOffset(targetDate, -60);
    const lookforwardDate = calculateDateOffset(targetDate, +60);

    await logInfo(shop, 'Export', `Fetching payouts from ${lookbackDate} to ${lookforwardDate}...`);
    const payouts = await fetchPayouts(shop, accessToken, lookbackDate, lookforwardDate);
    await logInfo(shop, 'Export', `Found ${payouts.length} payouts in wider range`);

    const allJournalEntries: JournalEntry[] = [];
    const allEnrichedTransactions: EnrichedTransaction[] = []; // NEW: Collect enriched transactions
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (payouts.length === 0) {
      const errorMsg = `No payouts found in range ${lookbackDate} to ${lookforwardDate}. Cannot generate entries for ${targetDate}.`;
      await logError(shop, 'Export', errorMsg);
      throw new Error(errorMsg);
    }

    // Step 2: Reconcile each payout, filtering transactions by target date
    await logInfo(shop, 'Export', `Filtering transactions to ${targetDate} capture date...`);

    for (const payout of payouts) {
      try {
        await logInfo(shop, 'Reconcile', `Processing payout ${payout.id} (${payout.amount.toFixed(2)} ${payout.currency})`);

        const result = await reconcilePayout(shop, accessToken, payout, targetDate);

        allJournalEntries.push(...result.journalEntries);
        allEnrichedTransactions.push(...result.enrichedTransactions); // NEW: Collect enriched transactions
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);

        if (!result.balanced) {
          await logWarning(shop, 'Reconcile', `Filtered entries from payout ${payout.id} not balanced`);
        }
      } catch (error) {
        const errorMsg = `Failed to reconcile payout ${payout.id}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        await logError(shop, 'Reconcile', errorMsg);
        allErrors.push(errorMsg);
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

    // Step 5: Generate four files with error isolation
    await logInfo(shop, 'Export', 'Generating export files...');
    const generatedFiles: GeneratedFile[] = [];

    // File #1: Detailed Sales Report
    await logInfo(shop, 'Export', 'Generating Detailed Sales Report...');
    try {
      const detailedSalesFilename = `detailed-sales-report_${targetDate}.csv`;
      const detailedSalesContent = generateDailySalesReport(allEnrichedTransactions, targetDate);
      const detailedSalesPath = await writeExport(shop, detailedSalesFilename, detailedSalesContent);

      const rowCount = detailedSalesContent.split('\n').length - 2; // Subtract header and totals row
      generatedFiles.push({
        type: 'daily-sales',
        filename: detailedSalesFilename,
        downloadUrl: `/api/download-csv?shop=${shop}&filename=${detailedSalesFilename}`,
        rowCount,
      });

      console.log(`✅ Detailed Sales Report created: ${detailedSalesFilename} (${rowCount} rows)`);
      await logInfo(shop, 'Export', `Detailed Sales Report saved: ${detailedSalesFilename}`);
    } catch (error) {
      const errorMsg = `Detailed Sales Report generation failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error('❌ Detailed Sales Report error:', error);
      await logError(shop, 'Export', errorMsg);
      allWarnings.push(errorMsg);

      generatedFiles.push({
        type: 'daily-sales',
        filename: `detailed-sales-report_${targetDate}.csv`,
        downloadUrl: '',
        rowCount: 0,
        error: errorMsg,
      });
    }

    // File #2: Payouts with Orders
    await logInfo(shop, 'Export', 'Generating Payouts with Orders...');
    try {
      const payoutsFilename = `payouts-with-orders_${targetDate}.csv`;
      const payoutsContent = generatePayoutsWithOrders(allEnrichedTransactions);
      const payoutsPath = await writeExport(shop, payoutsFilename, payoutsContent);

      const rowCount = payoutsContent.split('\n').length - 1; // Subtract header row
      generatedFiles.push({
        type: 'payouts-orders',
        filename: payoutsFilename,
        downloadUrl: `/api/download-csv?shop=${shop}&filename=${payoutsFilename}`,
        rowCount,
      });

      console.log(`✅ Payouts with Orders created: ${payoutsFilename} (${rowCount} rows)`);
      await logInfo(shop, 'Export', `Payouts with Orders saved: ${payoutsFilename}`);
    } catch (error) {
      const errorMsg = `Payouts with Orders generation failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error('❌ Payouts with Orders error:', error);
      await logError(shop, 'Export', errorMsg);
      allWarnings.push(errorMsg);

      generatedFiles.push({
        type: 'payouts-orders',
        filename: `payouts-with-orders_${targetDate}.csv`,
        downloadUrl: '',
        rowCount: 0,
        error: errorMsg,
      });
    }

    // File #3: Journal Entry Details (detailed format with Reference column)
    await logInfo(shop, 'Export', 'Generating Journal Entry Details...');
    const journalEntriesDetailsFilename = `journal-entry-details_${targetDate}.csv`;
    let journalEntriesDetailsPath: string;
    try {
      journalEntriesDetailsPath = await generateCSV(shop, mappedEntries, journalEntriesDetailsFilename);

      generatedFiles.push({
        type: 'journal-entries-details',
        filename: journalEntriesDetailsFilename,
        downloadUrl: `/api/download-csv?shop=${shop}&filename=${journalEntriesDetailsFilename}`,
        rowCount: mappedEntries.length,
      });

      console.log(`✅ Journal Entry Details created: ${journalEntriesDetailsFilename} (${mappedEntries.length} rows)`);
      await logInfo(shop, 'Export', `Journal Entry Details saved: ${journalEntriesDetailsFilename}`);
    } catch (error) {
      const errorMsg = `Journal Entry Details generation failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error('❌ Journal Entry Details error:', error);
      await logError(shop, 'Export', errorMsg);
      allErrors.push(errorMsg);

      generatedFiles.push({
        type: 'journal-entries-details',
        filename: journalEntriesDetailsFilename,
        downloadUrl: '',
        rowCount: 0,
        error: errorMsg,
      });
    }

    // File #4: Journal Entry Summary (one line per account for Sage 50 import)
    await logInfo(shop, 'Export', 'Generating Journal Entry Summary...');
    const journalEntrySummaryFilename = `journal-entry_${targetDate}.csv`;
    try {
      // Format date for summary (MM/DD/YYYY)
      const [year, month, day] = targetDate.split('-');
      const formattedDate = `${month}/${day}/${year}`;

      const journalEntrySummaryContent = generateJournalEntrySummary(mappedEntries, formattedDate);
      const journalEntrySummaryPath = await writeExport(shop, journalEntrySummaryFilename, journalEntrySummaryContent);

      const rowCount = journalEntrySummaryContent.split('\n').length - 1; // Subtract header row
      generatedFiles.push({
        type: 'journal-entry-summary',
        filename: journalEntrySummaryFilename,
        downloadUrl: `/api/download-csv?shop=${shop}&filename=${journalEntrySummaryFilename}`,
        rowCount,
      });

      console.log(`✅ Journal Entry Summary created: ${journalEntrySummaryFilename} (${rowCount} rows)`);
      await logInfo(shop, 'Export', `Journal Entry Summary saved: ${journalEntrySummaryFilename}`);
    } catch (error) {
      const errorMsg = `Journal Entry Summary generation failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error('❌ Journal Entry Summary error:', error);
      await logError(shop, 'Export', errorMsg);
      allErrors.push(errorMsg);

      generatedFiles.push({
        type: 'journal-entry-summary',
        filename: journalEntrySummaryFilename,
        downloadUrl: '',
        rowCount: 0,
        error: errorMsg,
      });
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
      date: targetDate,
      filename: journalEntrySummaryFilename, // Keep for backward compatibility (use summary file)
      files: generatedFiles, // Include all generated files
      entryCount: mappedEntries.length,
      totalDebit,
      totalCredit,
      balanced: totalDebit.equals(totalCredit),
      createdAt: new Date().toISOString(),
      downloadUrl: `/api/download-csv?shop=${shop}&filename=${journalEntrySummaryFilename}`, // Keep for backward compatibility
    };

    await logInfo(shop, 'Export', `Export complete: ${generatedFiles.length} files generated`, {
      entryCount: mappedEntries.length,
      balanced: totalDebit.equals(totalCredit),
      targetDate,
      files: generatedFiles.map(f => f.filename),
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
 * Calculate date offset (add/subtract days)
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param days - Number of days to add (positive) or subtract (negative)
 * @returns New date string in YYYY-MM-DD format
 */
function calculateDateOffset(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateISO(date);
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
  // Note: For fully refunded orders, we still generate SO- entries using original amounts
  // The refund is handled separately by RF- entries, which net together on AR
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
