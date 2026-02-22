import { createObjectCsvWriter } from 'csv-writer';
import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../types/journal-entry';
import { writeExport } from './storage.server';

/**
 * Generate CSV file in Sage 50 format
 *
 * Format: Date, Reference, Account, Debit, Credit, Memo
 *
 * @param shop - Shop domain
 * @param entries - Journal entries to export
 * @param filename - Output filename (e.g., "journal-entries-2024-01-15.csv")
 * @returns Path to generated CSV file
 */
export async function generateCSV(
  shop: string,
  entries: JournalEntry[],
  filename: string
): Promise<string> {
  // Convert entries to CSV format
  const csvRecords = entries.map((entry) => ({
    Date: entry.date,
    Reference: entry.reference,
    Account: entry.account,
    Debit: formatAmount(entry.debit),
    Credit: formatAmount(entry.credit),
    Memo: entry.memo,
  }));

  // Generate CSV string
  const csvContent = await generateCSVString(csvRecords);

  // Write to file
  const filePath = await writeExport(shop, filename, csvContent);

  return filePath;
}

/**
 * Generate CSV string from records
 */
async function generateCSVString(
  records: Array<{
    Date: string;
    Reference: string;
    Account: string;
    Debit: string;
    Credit: string;
    Memo: string;
  }>
): Promise<string> {
  // Build CSV manually for simple format
  const header = 'Date,Reference,Account,Debit,Credit,Memo\n';

  const rows = records
    .map((record) => {
      return [
        record.Date,
        escapeCsvValue(record.Reference),
        record.Account,
        record.Debit,
        record.Credit,
        escapeCsvValue(record.Memo),
      ].join(',');
    })
    .join('\n');

  return header + rows;
}

/**
 * Format decimal amount for CSV (2 decimal places)
 */
function formatAmount(amount: Decimal): string {
  return amount.toFixed(2);
}

/**
 * Escape CSV value (quote if contains comma, quote, or newline)
 */
function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate filename for export
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Filename (e.g., "journal-entries-2024-01-15.csv")
 */
export function generateFilename(startDate: string, endDate?: string): string {
  if (endDate && endDate !== startDate) {
    // Date range: journal-entries-2024-01-15-to-2024-01-22.csv
    return `journal-entries-${startDate}-to-${endDate}.csv`;
  }

  // Single date: journal-entries-2024-01-15.csv
  return `journal-entries-${startDate}.csv`;
}

/**
 * Validate journal entries before CSV generation
 *
 * @param entries - Journal entries to validate
 * @returns Validation errors (empty array if valid)
 */
export function validateEntries(entries: JournalEntry[]): string[] {
  const errors: string[] = [];

  if (entries.length === 0) {
    errors.push('No journal entries to export');
    return errors;
  }

  // Calculate totals
  const totalDebit = entries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );
  const totalCredit = entries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  // Check if balanced
  if (!totalDebit.equals(totalCredit)) {
    errors.push(
      `Journal entries do not balance: Debit ${totalDebit.toFixed(2)} != Credit ${totalCredit.toFixed(2)}`
    );
  }

  // Validate individual entries
  entries.forEach((entry, index) => {
    if (!entry.date) {
      errors.push(`Entry ${index + 1}: Missing date`);
    }

    if (!entry.account) {
      errors.push(`Entry ${index + 1}: Missing account code`);
    }

    if (!entry.reference) {
      errors.push(`Entry ${index + 1}: Missing reference`);
    }

    // Each entry should have either debit OR credit (not both non-zero)
    const hasDebit = entry.debit.greaterThan(0);
    const hasCredit = entry.credit.greaterThan(0);

    if (hasDebit && hasCredit) {
      errors.push(
        `Entry ${index + 1}: Has both debit and credit (${entry.debit.toFixed(2)}, ${entry.credit.toFixed(2)})`
      );
    }

    if (!hasDebit && !hasCredit) {
      errors.push(`Entry ${index + 1}: Has neither debit nor credit`);
    }
  });

  return errors;
}

/**
 * Generate summary statistics for export
 */
export function generateSummary(entries: JournalEntry[]): {
  entryCount: number;
  totalDebit: Decimal;
  totalCredit: Decimal;
  balanced: boolean;
  dateRange: { start: string; end: string };
  accounts: Set<string>;
} {
  const totalDebit = entries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );

  const totalCredit = entries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  const dates = entries.map((entry) => entry.date).sort();
  const accounts = new Set(entries.map((entry) => entry.account));

  return {
    entryCount: entries.length,
    totalDebit,
    totalCredit,
    balanced: totalDebit.equals(totalCredit),
    dateRange: {
      start: dates[0] || '',
      end: dates[dates.length - 1] || '',
    },
    accounts,
  };
}
