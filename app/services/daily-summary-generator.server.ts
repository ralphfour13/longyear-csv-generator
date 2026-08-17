import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../types/journal-entry';
import { writeExport } from './storage-adapter.server';

/**
 * Generate Daily Sales Summary
 *
 * Aggregates detailed journal entries into a single daily summary
 * Format: seq,date,GEN,INV,,account,amount
 * - Positive amount = debit
 * - Negative amount = credit
 * - One file per day
 */

interface DailySummaryLine {
  seq: number;
  date: string;
  type1: string;
  type2: string;
  blank: string;
  account: string;
  amount: Decimal;
}

/**
 * Generate daily summary from journal entries
 *
 * @param shop - Shop domain
 * @param entries - Journal entries to summarize
 * @param targetDate - Date to summarize (YYYY-MM-DD)
 * @param options - Generation options
 * @returns Path to generated summary file
 */
export async function generateDailySummary(
  shop: string,
  entries: JournalEntry[],
  targetDate: string,
  options: {
    includeFees?: boolean;
    includePayouts?: boolean;
  } = {}
): Promise<string> {
  const { includeFees = true, includePayouts = true } = options;

  // Filter to target date and optionally exclude FEE-/PO- references
  const filteredEntries = entries.filter((entry) => {
    const entryDate = convertDateToISO(entry.date);
    if (entryDate !== targetDate) return false;

    if (!includeFees && entry.reference.startsWith('FEE-')) return false;
    if (!includePayouts && entry.reference.startsWith('PO-')) return false;

    return true;
  });

  if (filteredEntries.length === 0) {
    throw new Error(`No journal entries found for date ${targetDate}`);
  }

  // Aggregate by account (Option B: separate debits and credits)
  const accountDebits = new Map<string, Decimal>();
  const accountCredits = new Map<string, Decimal>();

  for (const entry of filteredEntries) {
    const account = entry.account;

    if (entry.debit.greaterThan(0)) {
      const current = accountDebits.get(account) || new Decimal(0);
      accountDebits.set(account, current.plus(entry.debit));
    }

    if (entry.credit.greaterThan(0)) {
      const current = accountCredits.get(account) || new Decimal(0);
      accountCredits.set(account, current.plus(entry.credit));
    }
  }

  // Build summary lines
  const summaryLines: DailySummaryLine[] = [];
  const dateFormatted = formatDateForSummary(targetDate); // MM/DD/YY

  // Get all unique accounts
  const allAccounts = new Set([
    ...Array.from(accountDebits.keys()),
    ...Array.from(accountCredits.keys()),
  ]);

  // Sort accounts for consistent output
  const sortedAccounts = Array.from(allAccounts).sort();

  // Create lines for each account (debits first, then credits)
  for (const account of sortedAccounts) {
    const debitAmount = accountDebits.get(account);
    const creditAmount = accountCredits.get(account);

    // Debit line (positive amount)
    if (debitAmount && debitAmount.greaterThan(0)) {
      summaryLines.push({
        seq: 1,
        date: dateFormatted,
        type1: 'GEN',
        type2: 'INV',
        blank: '',
        account,
        amount: debitAmount, // Positive = debit
      });
    }

    // Credit line (negative amount)
    if (creditAmount && creditAmount.greaterThan(0)) {
      summaryLines.push({
        seq: 1,
        date: dateFormatted,
        type1: 'GEN',
        type2: 'INV',
        blank: '',
        account,
        amount: creditAmount.neg(), // Negative = credit
      });
    }
  }

  // Validate: sum should be zero
  const total = summaryLines.reduce(
    (sum, line) => sum.plus(line.amount),
    new Decimal(0)
  );

  if (total.abs().greaterThan(new Decimal('0.02'))) {
    throw new Error(
      `Summary doesn't balance: ${total.toFixed(2)} (should be 0.00). ` +
        `This indicates imbalances in the detailed journal entries.`
    );
  }

  // Generate CSV
  const csvContent = generateSummaryCSV(summaryLines);

  // Save file
  const filename = `daily-sales-report_${targetDate}.csv`;
  const filePath = await writeExport(shop, filename, csvContent);

  console.log(`✅ Daily summary generated: ${filename} (${summaryLines.length} lines)`);

  return filePath;
}

/**
 * Generate CSV string from summary lines
 * Note: No header row - Sage 50 expects data rows only
 */
function generateSummaryCSV(lines: DailySummaryLine[]): string {
  // No header - Sage 50 import format doesn't use headers
  const rows = lines
    .map((line) => {
      return [
        line.seq,
        line.date,
        line.type1,
        line.type2,
        line.blank,
        line.account,
        line.amount.toFixed(2),
      ].join(',');
    })
    .join('\n');

  return rows;
}

/**
 * Convert journal entry date (MM/DD/YYYY) to ISO (YYYY-MM-DD)
 */
function convertDateToISO(mmddyyyy: string): string {
  const [month, day, year] = mmddyyyy.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Format date as MM/DD/YY for summary file
 */
function formatDateForSummary(isoDate: string): string {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2); // Last 2 digits

  return `${month}/${day}/${year}`;
}

/**
 * Validate daily summary
 */
export function validateDailySummary(lines: DailySummaryLine[]): {
  valid: boolean;
  total: Decimal;
  errors: string[];
} {
  const errors: string[] = [];

  // Check total sums to zero
  const total = lines.reduce(
    (sum, line) => sum.plus(line.amount),
    new Decimal(0)
  );

  if (total.abs().greaterThan(new Decimal('0.02'))) {
    errors.push(`Summary doesn't balance: total = ${total.toFixed(2)} (should be 0.00)`);
  }

  // Check all required fields
  lines.forEach((line, index) => {
    if (!line.account) {
      errors.push(`Line ${index + 1}: Missing account`);
    }
    if (!line.date) {
      errors.push(`Line ${index + 1}: Missing date`);
    }
  });

  return {
    valid: errors.length === 0,
    total,
    errors,
  };
}
