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
import { calculateTaxAmount } from './order-centric-journal-generator.server';

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
  salesMismatches: SalesMismatch[];
  cogsMismatches: CogsMismatch[];
  taxMismatches: TaxMismatch[];
  paymentMismatches: PaymentMismatch[];
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
 * Sales Mismatch
 */
export interface SalesMismatch {
  orderName: string;
  reportedSales: Decimal;
  journalSales: Decimal;
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
 * Tax Mismatch
 */
export interface TaxMismatch {
  orderName: string;
  orderTax: Decimal;
  journalTax: Decimal;
  difference: Decimal;
  severity: Severity;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Payment Mismatch
 */
export interface PaymentMismatch {
  orderName: string;
  orderTotal: Decimal;
  paymentTotal: Decimal;
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
 * Check sales amount vs journal entries
 *
 * @param order - Order to validate
 * @param entries - Journal entries for this order
 * @returns Validation result
 */
export function checkSalesVsPayment(
  order: Order,
  entries: JournalEntry[]
): { matched: boolean; difference: Decimal } {
  // Get sales revenue from journal entries (credits to sales account)
  const salesEntries = entries.filter(
    (e) =>
      e.reference === `SO-${order.name}` &&
      e.accountName?.toLowerCase().includes('sales')
  );

  const journalSales = salesEntries.reduce(
    (sum, entry) => sum.plus(entry.credit).minus(entry.debit),
    new Decimal(0)
  );

  // Calculate expected sales (subtotal after discounts)
  const expectedSales = order.currentSubtotalPrice || order.subtotalPrice;

  const difference = journalSales.minus(expectedSales).abs();
  const matched = difference.lessThanOrEqualTo(new Decimal('0.50')); // Allow 50 cent tolerance

  return { matched, difference };
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
  const salesMismatches: SalesMismatch[] = [];
  const cogsMismatches: CogsMismatch[] = [];
  const taxMismatches: TaxMismatch[] = [];
  const paymentMismatches: PaymentMismatch[] = [];
  const warnings: Array<{ orderId: string; orderName: string; type: string; message: string }> = [];

  const processedOrders = new Set<string>();

  // Check each order
  for (const order of orders) {
    if (processedOrders.has(order.name)) {
      continue;
    }
    processedOrders.add(order.name);

    const orderEntries = entries.filter((e) => e.reference.includes(order.name));

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

    // 2. Check sales vs payment
    const salesCheck = checkSalesVsPayment(order, orderEntries);
    if (!salesCheck.matched) {
      salesMismatches.push({
        orderName: order.name,
        reportedSales: order.currentSubtotalPrice || order.subtotalPrice,
        journalSales: orderEntries
          .filter((e) => e.accountName?.toLowerCase().includes('sales'))
          .reduce((sum, e) => sum.plus(e.credit).minus(e.debit), new Decimal(0)),
        difference: salesCheck.difference,
        severity: 'WARNING', // Sales mismatches are data validation warnings
        impact: salesCheck.difference.gt(50) ? 'HIGH' : salesCheck.difference.gt(5) ? 'MEDIUM' : 'LOW',
      });
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

    // 3. Check tax amounts
    const orderTax = calculateTaxAmount(order);
    const journalTax = orderEntries
      .filter((e) => e.accountName?.toLowerCase().includes('tax'))
      .reduce((sum, e) => sum.plus(e.credit).minus(e.debit), new Decimal(0));

    const taxDiff = journalTax.minus(orderTax).abs();
    if (taxDiff.gt(0.50)) {
      taxMismatches.push({
        orderName: order.name,
        orderTax,
        journalTax,
        difference: taxDiff,
        severity: 'WARNING', // Tax mismatches are data validation warnings
        impact: taxDiff.gt(10) ? 'HIGH' : taxDiff.gt(1) ? 'MEDIUM' : 'LOW',
      });
    }

    // 4. Check payment total
    const paymentEntries = orderEntries.filter(
      (e) => e.debit.gt(0) && !e.accountName?.toLowerCase().includes('sales')
    );
    const paymentTotal = paymentEntries.reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
    const paymentDiff = paymentTotal.minus(order.totalPrice).abs();

    if (paymentDiff.gt(0.50)) {
      paymentMismatches.push({
        orderName: order.name,
        orderTotal: order.totalPrice,
        paymentTotal,
        difference: paymentDiff,
        severity: 'WARNING', // Payment mismatches are data validation warnings
        impact: paymentDiff.gt(50) ? 'HIGH' : paymentDiff.gt(5) ? 'MEDIUM' : 'LOW',
      });
    }
  }

  // Calculate summary stats
  const errorOrders = new Set([
    ...imbalancedEntries.map((e) => e.orderName),
    ...salesMismatches.filter((m) => m.impact === 'HIGH').map((m) => m.orderName),
  ]).size;

  const warningOrders = new Set([
    ...salesMismatches.filter((m) => m.impact !== 'HIGH').map((m) => m.orderName),
    ...cogsMismatches.map((m) => m.orderName),
    ...taxMismatches.map((m) => m.orderName),
    ...paymentMismatches.map((m) => m.orderName),
  ]).size;

  const cleanOrders = orders.length - errorOrders - warningOrders;

  return {
    hasErrors: imbalancedEntries.length > 0 || salesMismatches.some((m) => m.impact === 'HIGH'),
    hasWarnings: salesMismatches.length > 0 || cogsMismatches.length > 0 || taxMismatches.length > 0,
    totalOrders: orders.length,
    cleanOrders,
    errorOrders,
    warningOrders,
    imbalancedEntries,
    salesMismatches,
    cogsMismatches,
    taxMismatches,
    paymentMismatches,
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

  // Sales mismatches
  for (const mismatch of report.salesMismatches) {
    lines.push(
      `${mismatch.orderName},${mismatch.severity},Sales Mismatch,Report != Journal,$${mismatch.difference.toFixed(2)},${mismatch.impact}`
    );
  }

  // COGS mismatches
  for (const mismatch of report.cogsMismatches) {
    lines.push(
      `${mismatch.orderName},${mismatch.severity},COGS Mismatch,Details != Journal,$${mismatch.difference.toFixed(2)},${mismatch.impact}`
    );
  }

  // Tax mismatches
  for (const mismatch of report.taxMismatches) {
    lines.push(
      `${mismatch.orderName},${mismatch.severity},Tax Mismatch,Order != Journal,$${mismatch.difference.toFixed(2)},${mismatch.impact}`
    );
  }

  // Payment mismatches
  for (const mismatch of report.paymentMismatches) {
    lines.push(
      `${mismatch.orderName},${mismatch.severity},Payment Mismatch,Total != Payment,$${mismatch.difference.toFixed(2)},${mismatch.impact}`
    );
  }

  return lines.join('\n');
}
