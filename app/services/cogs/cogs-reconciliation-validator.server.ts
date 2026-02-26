import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../../types/journal-entry';
import type { CogsCalculation } from '../../types/cin7';

/**
 * COGS Reconciliation Validator
 *
 * Validates that COGS amounts in journal entries match COGS calculations
 * used for CSV exports. Detects discrepancies caused by removed items,
 * partial fulfillments, or calculation errors.
 */

export interface CogsDiscrepancy {
  orderId: string;
  orderName: string;
  journalEntryCogs: Decimal;
  csvCogs: Decimal;
  difference: Decimal;
  percentDifference: number;
}

export interface CogsValidationResult {
  valid: boolean;
  totalOrders: number;
  matchingOrders: number;
  discrepancies: CogsDiscrepancy[];
  totalJeCogs: Decimal;
  totalCsvCogs: Decimal;
  totalDifference: Decimal;
}

/**
 * Validate COGS consistency between journal entries and CSV calculations
 *
 * @param journalEntries - All journal entries for the date
 * @param cogsDataMap - Map of order ID to COGS calculation (for CSV)
 * @returns Validation result with discrepancies
 */
export function validateCogsConsistency(
  journalEntries: JournalEntry[],
  cogsDataMap: Map<string, CogsCalculation>
): CogsValidationResult {
  const discrepancies: CogsDiscrepancy[] = [];
  let totalJeCogs = new Decimal(0);
  let totalCsvCogs = new Decimal(0);

  // Group journal entries by order
  const orderCogsMap = extractOrderCogsFromJournalEntries(journalEntries);

  // Compare each order's COGS
  for (const [orderId, cogsData] of cogsDataMap.entries()) {
    const jeCogs = orderCogsMap.get(orderId) || new Decimal(0);
    const csvCogs = cogsData.totalCogs;

    totalJeCogs = totalJeCogs.plus(jeCogs);
    totalCsvCogs = totalCsvCogs.plus(csvCogs);

    // Allow for small rounding differences (1 cent)
    const difference = jeCogs.minus(csvCogs).abs();
    if (difference.greaterThan(new Decimal('0.01'))) {
      const percentDiff = csvCogs.greaterThan(0)
        ? difference.dividedBy(csvCogs).times(100).toNumber()
        : 0;

      discrepancies.push({
        orderId,
        orderName: cogsData.orderName,
        journalEntryCogs: jeCogs,
        csvCogs,
        difference,
        percentDifference: percentDiff,
      });
    }
  }

  // Check for orders in JE but not in CSV (shouldn't happen but worth checking)
  for (const [orderId, jeCogs] of orderCogsMap.entries()) {
    if (!cogsDataMap.has(orderId) && jeCogs.greaterThan(0)) {
      discrepancies.push({
        orderId,
        orderName: `Order ${orderId}`,
        journalEntryCogs: jeCogs,
        csvCogs: new Decimal(0),
        difference: jeCogs,
        percentDifference: 100,
      });
    }
  }

  const totalDifference = totalJeCogs.minus(totalCsvCogs).abs();

  return {
    valid: discrepancies.length === 0,
    totalOrders: cogsDataMap.size,
    matchingOrders: cogsDataMap.size - discrepancies.length,
    discrepancies,
    totalJeCogs,
    totalCsvCogs,
    totalDifference,
  };
}

/**
 * Extract COGS amounts from journal entries by order
 * COGS entries are debits to account 4000.000 (or mapped equivalent)
 *
 * @param journalEntries - All journal entries
 * @returns Map of order ID to COGS amount
 */
function extractOrderCogsFromJournalEntries(
  journalEntries: JournalEntry[]
): Map<string, Decimal> {
  const orderCogsMap = new Map<string, Decimal>();

  // COGS entries are:
  // - Reference starts with "SO-" (sales order)
  // - Account is 4000.000 or starts with 4000 (COGS account)
  // - Debit side (COGS is an expense/debit)
  for (const entry of journalEntries) {
    if (
      entry.reference.startsWith('SO-') &&
      (entry.account === '4000.000' || entry.account.startsWith('4000')) &&
      entry.debit.greaterThan(0)
    ) {
      // Extract order name from reference (SO-#1234 -> #1234)
      const orderName = entry.reference.substring(3); // Remove "SO-"

      // Find order ID (need to look up from order name)
      // For now, use order name as key (will need order ID mapping if needed)
      const currentCogs = orderCogsMap.get(orderName) || new Decimal(0);
      orderCogsMap.set(orderName, currentCogs.plus(entry.debit));
    }
  }

  return orderCogsMap;
}

/**
 * Format validation result as human-readable report
 *
 * @param result - Validation result
 * @returns Formatted report string
 */
export function formatValidationReport(result: CogsValidationResult): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('COGS RECONCILIATION VALIDATION REPORT');
  lines.push('='.repeat(80));
  lines.push('');

  lines.push(`Total Orders: ${result.totalOrders}`);
  lines.push(`Matching Orders: ${result.matchingOrders}`);
  lines.push(`Discrepancies: ${result.discrepancies.length}`);
  lines.push('');

  lines.push(`Total JE COGS:  $${result.totalJeCogs.toFixed(2)}`);
  lines.push(`Total CSV COGS: $${result.totalCsvCogs.toFixed(2)}`);
  lines.push(`Difference:     $${result.totalDifference.toFixed(2)}`);
  lines.push('');

  if (result.valid) {
    lines.push('✅ VALIDATION PASSED: All COGS amounts match!');
  } else {
    lines.push('❌ VALIDATION FAILED: COGS discrepancies detected');
    lines.push('');
    lines.push('DISCREPANCIES:');
    lines.push('-'.repeat(80));

    for (const disc of result.discrepancies) {
      lines.push(
        `Order ${disc.orderName}: ` +
          `JE=$${disc.journalEntryCogs.toFixed(2)}, ` +
          `CSV=$${disc.csvCogs.toFixed(2)}, ` +
          `Diff=$${disc.difference.toFixed(2)} ` +
          `(${disc.percentDifference.toFixed(1)}%)`
      );
    }
  }

  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Log validation result to console with formatting
 *
 * @param result - Validation result
 */
export function logValidationResult(result: CogsValidationResult): void {
  const report = formatValidationReport(result);
  console.log('\n' + report + '\n');

  // Also log individual discrepancies at warning level
  if (!result.valid) {
    for (const disc of result.discrepancies) {
      console.warn(
        `⚠️ COGS Mismatch - ${disc.orderName}: ` +
          `JE=$${disc.journalEntryCogs.toFixed(2)} vs CSV=$${disc.csvCogs.toFixed(2)} ` +
          `(Diff: $${disc.difference.toFixed(2)})`
      );
    }
  }
}
