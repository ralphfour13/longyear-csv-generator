import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../types/journal-entry';

/**
 * Generate summarized journal entry file in Sage 50 import format
 *
 * This aggregates all journal entries for the day into a single line per account,
 * showing the net activity for each account code.
 *
 * Sage 50 Format: 1,MM/DD/YY,GEN,INV,,Account,Amount
 * - Column 1: Transaction type (1 = Journal Entry)
 * - Column 2: Date (MM/DD/YY format)
 * - Column 3: Source (GEN = General)
 * - Column 4: Journal type (INV = Invoice)
 * - Column 5: Empty field
 * - Column 6: Account number
 * - Column 7: Signed amount (positive = debit, negative = credit)
 *
 * @param entries - Journal entries to summarize
 * @param targetDate - The date for the journal entry (MM/DD/YYYY format)
 * @returns Sage 50 import file content (no header)
 */
export function generateJournalEntrySummary(
  entries: JournalEntry[],
  targetDate: string
): string {
  // Convert date from MM/DD/YYYY to MM/DD/YY format
  const dateParts = targetDate.split('/');
  const month = dateParts[0];
  const day = dateParts[1];
  const year = dateParts[2].slice(-2); // Get last 2 digits of year
  const sage50Date = `${month}/${day}/${year}`;

  // Group entries by account
  const accountGroups = new Map<string, {
    totalDebit: Decimal;
    totalCredit: Decimal;
  }>();

  for (const entry of entries) {
    const existing = accountGroups.get(entry.account);

    if (existing) {
      // Round each entry to 2 decimal places BEFORE aggregating
      // This matches the CSV detail file which rounds per-entry via toFixed(2)
      existing.totalDebit = existing.totalDebit.plus(entry.debit.toDecimalPlaces(2));
      existing.totalCredit = existing.totalCredit.plus(entry.credit.toDecimalPlaces(2));
    } else {
      accountGroups.set(entry.account, {
        totalDebit: entry.debit.toDecimalPlaces(2),
        totalCredit: entry.credit.toDecimalPlaces(2),
      });
    }
  }

  // Build Sage 50 format rows
  const rows: string[] = [];

  for (const [account, data] of accountGroups.entries()) {
    // Calculate net signed amount (positive = debit, negative = credit)
    const netAmount = data.totalDebit.minus(data.totalCredit);

    // Only include accounts with non-zero activity
    if (!netAmount.equals(0)) {
      // Sage 50 format: 1,MM/DD/YY,GEN,INV,,Account,Amount
      rows.push([
        '1',                    // Transaction type (1 = Journal Entry)
        sage50Date,             // Date in MM/DD/YY format
        'GEN',                  // Source (GEN = General)
        'INV',                  // Journal type (INV = Invoice)
        '',                     // Empty field
        account,                // Account number
        netAmount.toFixed(2),   // Signed amount
      ].join(','));
    }
  }

  // Sort by account code for consistent output
  rows.sort((a, b) => {
    const accountA = a.split(',')[5]; // Account is in position 5 (0-indexed)
    const accountB = b.split(',')[5];
    return accountA.localeCompare(accountB);
  });

  // NO HEADER - Sage 50 format is raw data only
  return rows.join('\n');
}
