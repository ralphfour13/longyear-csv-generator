import { Decimal } from 'decimal.js';
import type { ExportHistoryEntry, ReconciliationResult } from '../types/journal-entry';
import { fetchPayouts } from './shopify/payout-fetcher.server';
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

    if (payouts.length === 0) {
      const errorMsg = `No payouts found for date range ${startDate} to ${endDate}`;
      await logWarning(shop, 'Export', errorMsg);
      throw new Error(errorMsg);
    }

    // Step 2: Reconcile each payout
    await logInfo(shop, 'Export', 'Reconciling payouts...');
    const allJournalEntries = [];
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

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

    // Step 5: Generate CSV
    await logInfo(shop, 'Export', 'Generating CSV...');
    const filename = generateFilename(startDate, endDate);
    const filePath = await generateCSV(shop, mappedEntries, filename);

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
      downloadUrl: `/app/api/download-csv?shop=${shop}&filename=${filename}`,
    };

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
