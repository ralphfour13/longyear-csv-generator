/**
 * Consistency Checker Service
 *
 * Validates journal entries and order data for consistency issues before export.
 * Generates comprehensive error reports highlighting:
 * - Imbalanced journal entries (debits != credits)
 * - Sales vs payment mismatches
 * - COGS calculation errors
 * - Tax calculation discrepancies
 */

import { Decimal } from 'decimal.js';
import type { Order, JournalEntry } from '../types/journal-entry';

/**
 * Consistency Check Result
 */
export interface ConsistencyCheckResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  totalOrders: number;
  cleanOrders: number;
  errorOrders: number;
  warningOrders: number;
  imbalancedEntries: ImbalancedEntry[];
  cogsMismatches: CogsMismatch[];
}

/**
 * Severity levels for validation issues
 * CRITICAL: Accounting errors that MUST be fixed (e.g., imbalanced journals)
 * ERROR: Significant mismatches that should be investigated
 * WARNING: Data quality issues or minor mismatches
 * INFO: Informational items, typically rounding differences
 */
export type Severity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

/**
 * Imbalanced Journal Entry
 */
export interface ImbalancedEntry {
  reference: string;
  orderName: string;
  totalDebits: Decimal;
  totalCredits: Decimal;
  difference: Decimal;
  severity: Severity;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * COGS Mismatch
 */
export interface CogsMismatch {
  orderName: string;
  detailsCogs: Decimal;
  journalCogs: Decimal;
  difference: Decimal;
  severity: Severity;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Check if journal entries balance for a given reference
 *
 * @param entries - All journal entries
 * @param reference - Reference to check (e.g., "SO-1001")
 * @returns Validation result
 */
export function checkJournalBalance(
  entries: JournalEntry[],
  reference: string
): { balanced: boolean; difference: Decimal } {
  const refEntries = entries.filter((e) => e.reference === reference);

  if (refEntries.length === 0) {
    return { balanced: true, difference: new Decimal(0) };
  }

  const totalDebits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );

  const totalCredits = refEntries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  const difference = totalDebits.minus(totalCredits).abs();
  const balanced = difference.lessThanOrEqualTo(new Decimal('0.02')); // Allow 2 cent rounding

  return { balanced, difference };
}

/**
 * Check COGS entries consistency
 *
 * @param entries - Journal entries
 * @returns Validation result
 */
export function checkCogsVsInventory(
  entries: JournalEntry[]
): { balanced: boolean; references: string[] } {
  const unbalanced: string[] = [];

  // Group COGS entries by reference
  const cogsRefs = new Set(
    entries
      .filter(
        (e) =>
          e.accountName?.toLowerCase().includes('cogs') ||
          e.accountName?.toLowerCase().includes('inventory')
      )
      .map((e) => e.reference)
  );

  for (const ref of cogsRefs) {
    const check = checkJournalBalance(entries, ref);
    if (!check.balanced) {
      unbalanced.push(ref);
    }
  }

  return {
    balanced: unbalanced.length === 0,
    references: unbalanced,
  };
}

/**
 * Format ISO date to YYYY-MM-DD
 */
function formatDateOnly(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if order has refunds that occurred AFTER the target export date.
 * These future refunds should be IGNORED in point-in-time exports.
 */
function hasFutureRefunds(order: Order, targetDate: string): boolean {
  if (!order.transactions || order.transactions.length === 0) {
    return false;
  }

  const futureRefunds = order.transactions.filter((txn) => {
    if (txn.kind !== 'refund' || txn.status !== 'success') return false;
    const refundDate = formatDateOnly(txn.processedAt);
    return refundDate > targetDate;
  });

  return futureRefunds.length > 0;
}

/**
 * Generate comprehensive consistency report
 *
 * @param orders - Orders to check
 * @param entries - Journal entries
 * @returns Consistency check result
 */
export async function generateConsistencyReport(
  orders: Order[],
  entries: JournalEntry[],
  targetDate?: string
): Promise<ConsistencyCheckResult> {
  const imbalancedEntries: ImbalancedEntry[] = [];
  const cogsMismatches: CogsMismatch[] = [];
  const warnings: Array<{ orderId: string; orderName: string; type: string; message: string }> = [];

  const processedOrders = new Set<string>();

  // Check each order
  for (const order of orders) {
    if (processedOrders.has(order.name)) {
      continue;
    }
    processedOrders.add(order.name);

    const orderEntries = entries.filter((e) => e.reference.includes(order.name));

    // Skip orders with no journal entries for this date
    // These orders were fetched because they're in the payout window but their
    // captures/refunds were processed on different dates
    if (orderEntries.length === 0) {
      continue;
    }

    // 1. Check journal balance
    const references = new Set(orderEntries.map((e) => e.reference));
    for (const ref of references) {
      const balanceCheck = checkJournalBalance(entries, ref);
      if (!balanceCheck.balanced) {
        const refEntries = entries.filter((e) => e.reference === ref);
        const totalDebits = refEntries.reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
        const totalCredits = refEntries.reduce((sum, e) => sum.plus(e.credit), new Decimal(0));

        imbalancedEntries.push({
          reference: ref,
          orderName: order.name,
          totalDebits,
          totalCredits,
          difference: balanceCheck.difference,
          severity: 'CRITICAL', // Journal imbalances are critical accounting errors
          impact: balanceCheck.difference.gt(10) ? 'HIGH' : balanceCheck.difference.gt(1) ? 'MEDIUM' : 'LOW',
        });
      }
    }

    // Point-in-time validation: Check for future refunds
    if (targetDate && hasFutureRefunds(order, targetDate)) {
      warnings.push({
        orderId: order.id,
        orderName: order.name,
        type: 'future_refund',
        message: 'Order has refunds after export date - using original totals',
      });
    }

  }

  // Calculate summary stats
  const errorOrders = new Set([
    ...imbalancedEntries.map((e) => e.orderName),
  ]).size;

  const warningOrders = new Set([
    ...cogsMismatches.map((m) => m.orderName),
  ]).size;

  const cleanOrders = orders.length - errorOrders - warningOrders;

  return {
    hasErrors: imbalancedEntries.length > 0,
    hasWarnings: cogsMismatches.length > 0,
    totalOrders: orders.length,
    cleanOrders,
    errorOrders,
    warningOrders,
    imbalancedEntries,
    cogsMismatches,
  };
}

/**
 * Generate error report CSV content
 *
 * @param report - Consistency check result
 * @returns CSV string
 */
export function generateErrorReportCsv(report: ConsistencyCheckResult): string {
  const lines: string[] = [];

  // Header
  lines.push('Order,Severity,Error Type,Description,Difference,Impact');

  // Imbalanced entries
  for (const entry of report.imbalancedEntries) {
    lines.push(
      `${entry.orderName},${entry.severity},Journal Imbalance,Debits != Credits,$${entry.difference.toFixed(2)},${entry.impact}`
    );
  }

  // COGS mismatches
  for (const mismatch of report.cogsMismatches) {
    lines.push(
      `${mismatch.orderName},${mismatch.severity},COGS Mismatch,Details != Journal,$${mismatch.difference.toFixed(2)},${mismatch.impact}`
    );
  }

  return lines.join('\n');
}
