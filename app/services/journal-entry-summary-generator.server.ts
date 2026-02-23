import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../types/journal-entry';

/**
 * Generate summarized journal entry file (one line per account)
 *
 * This aggregates all journal entries for the day into a single line per account,
 * showing the net activity for each account code.
 *
 * Format: Date, Account, Amount, Memo
 * Amount convention: Positive = Debit, Negative = Credit
 *
 * @param entries - Journal entries to summarize
 * @param targetDate - The date for the journal entry (MM/DD/YYYY format)
 * @returns CSV content string
 */
export function generateJournalEntrySummary(
  entries: JournalEntry[],
  targetDate: string
): string {
  // Group entries by account
  const accountGroups = new Map<string, {
    accountName: string;
    totalDebit: Decimal;
    totalCredit: Decimal;
  }>();

  for (const entry of entries) {
    const existing = accountGroups.get(entry.account);

    if (existing) {
      existing.totalDebit = existing.totalDebit.plus(entry.debit);
      existing.totalCredit = existing.totalCredit.plus(entry.credit);
    } else {
      accountGroups.set(entry.account, {
        accountName: entry.accountName,
        totalDebit: entry.debit,
        totalCredit: entry.credit,
      });
    }
  }

  // Build CSV rows
  const rows: string[] = [];

  for (const [account, data] of accountGroups.entries()) {
    // Calculate net signed amount (positive = debit, negative = credit)
    const netAmount = data.totalDebit.minus(data.totalCredit);

    // Only include accounts with non-zero activity
    if (!netAmount.equals(0)) {
      rows.push([
        targetDate,
        account,
        netAmount.toFixed(2),
        escapeCsvValue(data.accountName),
      ].join(','));
    }
  }

  // Sort by account code for consistent output
  rows.sort((a, b) => {
    const accountA = a.split(',')[1];
    const accountB = b.split(',')[1];
    return accountA.localeCompare(accountB);
  });

  // Add header
  const header = 'Date,Account,Amount,Memo\n';

  return header + rows.join('\n');
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
