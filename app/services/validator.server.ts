import { Decimal } from 'decimal.js';
import type {
  JournalEntry,
  AccountMappings,
  SyncConfig,
  Payout,
  BalanceTransaction,
  ValidationError,
} from '../types/journal-entry';

/**
 * Validation service for journal entries, configurations, and data integrity
 */

/**
 * Validate journal entries balance to payout amount
 *
 * @param entries - Journal entries to validate
 * @param payoutAmount - Expected payout amount
 * @returns Validation result with errors
 */
export function validateEntriesBalanceToPayout(
  entries: JournalEntry[],
  payoutAmount: Decimal
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  // Calculate totals
  const totalDebit = entries.reduce(
    (sum, entry) => sum.plus(entry.debit),
    new Decimal(0)
  );

  const totalCredit = entries.reduce(
    (sum, entry) => sum.plus(entry.credit),
    new Decimal(0)
  );

  // Check if debits equal credits
  if (!totalDebit.equals(totalCredit)) {
    errors.push({
      field: 'journal_entries',
      message: `Debits (${totalDebit.toFixed(2)}) do not equal credits (${totalCredit.toFixed(2)})`,
      value: { totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2) },
    });
  }

  // Check if cash debit equals payout amount
  const cashDebit = entries
    .filter((entry) => entry.account.includes('1000') && entry.debit.greaterThan(0))
    .reduce((sum, entry) => sum.plus(entry.debit), new Decimal(0));

  if (!cashDebit.equals(payoutAmount)) {
    errors.push({
      field: 'cash_account',
      message: `Cash debit (${cashDebit.toFixed(2)}) does not equal payout amount (${payoutAmount.toFixed(2)})`,
      value: { cashDebit: cashDebit.toFixed(2), payoutAmount: payoutAmount.toFixed(2) },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate individual journal entry
 */
export function validateJournalEntry(entry: JournalEntry): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check required fields
  if (!entry.date) {
    errors.push({ field: 'date', message: 'Date is required' });
  }

  if (!entry.reference) {
    errors.push({ field: 'reference', message: 'Reference is required' });
  }

  if (!entry.account) {
    errors.push({ field: 'account', message: 'Account code is required' });
  }

  if (!entry.memo) {
    errors.push({ field: 'memo', message: 'Memo is required' });
  }

  // Validate date format (MM/DD/YYYY)
  if (entry.date) {
    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dateRegex.test(entry.date)) {
      errors.push({
        field: 'date',
        message: 'Date must be in MM/DD/YYYY format',
        value: entry.date,
      });
    }
  }

  // Check that entry has either debit OR credit (not both, not neither)
  const hasDebit = entry.debit.greaterThan(0);
  const hasCredit = entry.credit.greaterThan(0);

  if (hasDebit && hasCredit) {
    errors.push({
      field: 'amounts',
      message: 'Entry cannot have both debit and credit',
      value: { debit: entry.debit.toFixed(2), credit: entry.credit.toFixed(2) },
    });
  }

  if (!hasDebit && !hasCredit) {
    errors.push({
      field: 'amounts',
      message: 'Entry must have either debit or credit',
      value: { debit: entry.debit.toFixed(2), credit: entry.credit.toFixed(2) },
    });
  }

  // Validate amounts are non-negative
  if (entry.debit.lessThan(0)) {
    errors.push({
      field: 'debit',
      message: 'Debit amount cannot be negative',
      value: entry.debit.toFixed(2),
    });
  }

  if (entry.credit.lessThan(0)) {
    errors.push({
      field: 'credit',
      message: 'Credit amount cannot be negative',
      value: entry.credit.toFixed(2),
    });
  }

  return errors;
}

/**
 * Validate all journal entries
 */
export function validateAllEntries(entries: JournalEntry[]): {
  valid: boolean;
  errors: Array<{ entryIndex: number; errors: ValidationError[] }>;
} {
  const allErrors: Array<{ entryIndex: number; errors: ValidationError[] }> = [];

  entries.forEach((entry, index) => {
    const errors = validateJournalEntry(entry);
    if (errors.length > 0) {
      allErrors.push({ entryIndex: index, errors });
    }
  });

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Validate sync configuration
 */
export function validateSyncConfig(config: SyncConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate shop
  if (!config.shop || config.shop.trim() === '') {
    errors.push({ field: 'shop', message: 'Shop domain is required' });
  }

  // Validate scheduled time format (HH:mm)
  if (config.scheduledTime) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(config.scheduledTime)) {
      errors.push({
        field: 'scheduledTime',
        message: 'Scheduled time must be in HH:mm format (e.g., 02:00)',
        value: config.scheduledTime,
      });
    }
  }

  // Validate sync schedule
  if (!['nightly', 'manual'].includes(config.syncSchedule)) {
    errors.push({
      field: 'syncSchedule',
      message: 'Sync schedule must be "nightly" or "manual"',
      value: config.syncSchedule,
    });
  }

  // Validate auto export date
  if (!['yesterday', 'today', 'last_7_days', 'custom'].includes(config.autoExportDate)) {
    errors.push({
      field: 'autoExportDate',
      message: 'Invalid auto export date option',
      value: config.autoExportDate,
    });
  }

  return errors;
}

/**
 * Validate account mappings
 */
export function validateAccountMappings(mappings: AccountMappings): ValidationError[] {
  const errors: ValidationError[] = [];

  const requiredMappings: Array<keyof AccountMappings> = [
    'sales_revenue',
    'sales_tax',
    'cash_account',
    'clearing_account',
    'payment_processing_fees',
  ];

  for (const key of requiredMappings) {
    if (!mappings[key]) {
      errors.push({
        field: key,
        message: `Missing required account mapping: ${key}`,
      });
      continue;
    }

    const mapping = mappings[key];

    if (!mapping.accountCode || mapping.accountCode.trim() === '') {
      errors.push({
        field: `${key}.accountCode`,
        message: `Account code is required for ${key}`,
      });
    }

    if (!mapping.accountName || mapping.accountName.trim() === '') {
      errors.push({
        field: `${key}.accountName`,
        message: `Account name is required for ${key}`,
      });
    }

    // Validate account code format (basic pattern: XXXX-XX)
    if (mapping.accountCode) {
      const codeRegex = /^\d{4}-\d{2}$/;
      if (!codeRegex.test(mapping.accountCode)) {
        errors.push({
          field: `${key}.accountCode`,
          message: `Invalid account code format. Expected XXXX-XX (e.g., 4000-00)`,
          value: mapping.accountCode,
        });
      }
    }
  }

  return errors;
}

/**
 * Validate payout data
 */
export function validatePayout(payout: Payout): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!payout.id) {
    errors.push({ field: 'id', message: 'Payout ID is required' });
  }

  if (!payout.date) {
    errors.push({ field: 'date', message: 'Payout date is required' });
  }

  if (payout.amount.lessThanOrEqualTo(0)) {
    errors.push({
      field: 'amount',
      message: 'Payout amount must be greater than zero',
      value: payout.amount.toFixed(2),
    });
  }

  if (!payout.currency) {
    errors.push({ field: 'currency', message: 'Currency is required' });
  }

  if (!['paid', 'pending', 'failed'].includes(payout.status)) {
    errors.push({
      field: 'status',
      message: 'Invalid payout status',
      value: payout.status,
    });
  }

  return errors;
}

/**
 * Validate balance transaction
 */
export function validateBalanceTransaction(txn: BalanceTransaction): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!txn.id) {
    errors.push({ field: 'id', message: 'Transaction ID is required' });
  }

  if (!txn.type) {
    errors.push({ field: 'type', message: 'Transaction type is required' });
  }

  if (!txn.processedAt) {
    errors.push({ field: 'processedAt', message: 'Processed date is required' });
  }

  // Validate that gross - fee = net
  const calculatedNet = txn.gross.minus(txn.fee);
  if (!calculatedNet.equals(txn.net)) {
    errors.push({
      field: 'amounts',
      message: 'Net amount does not equal gross minus fee',
      value: {
        gross: txn.gross.toFixed(2),
        fee: txn.fee.toFixed(2),
        net: txn.net.toFixed(2),
        calculated: calculatedNet.toFixed(2),
      },
    });
  }

  return errors;
}

/**
 * Validate date range
 */
export function validateDateRange(
  startDate: string,
  endDate: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRegex.test(startDate)) {
    errors.push({
      field: 'startDate',
      message: 'Start date must be in YYYY-MM-DD format',
      value: startDate,
    });
  }

  if (!dateRegex.test(endDate)) {
    errors.push({
      field: 'endDate',
      message: 'End date must be in YYYY-MM-DD format',
      value: endDate,
    });
  }

  // Validate that dates are valid
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime())) {
    errors.push({
      field: 'startDate',
      message: 'Invalid start date',
      value: startDate,
    });
  }

  if (isNaN(end.getTime())) {
    errors.push({
      field: 'endDate',
      message: 'Invalid end date',
      value: endDate,
    });
  }

  // Validate that end date is not before start date
  if (start > end) {
    errors.push({
      field: 'dateRange',
      message: 'End date cannot be before start date',
      value: { startDate, endDate },
    });
  }

  // Validate that date range is not too large (max 90 days)
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > 90) {
    errors.push({
      field: 'dateRange',
      message: 'Date range cannot exceed 90 days',
      value: { startDate, endDate, days: daysDiff },
    });
  }

  return errors;
}

/**
 * Comprehensive validation for export request
 */
export function validateExportRequest(
  startDate: string,
  endDate: string,
  config: SyncConfig,
  mappings: AccountMappings
): {
  valid: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];

  // Validate date range
  errors.push(...validateDateRange(startDate, endDate));

  // Validate config
  errors.push(...validateSyncConfig(config));

  // Validate mappings
  errors.push(...validateAccountMappings(mappings));

  return {
    valid: errors.length === 0,
    errors,
  };
}
