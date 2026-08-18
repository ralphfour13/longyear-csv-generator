import { Decimal } from 'decimal.js';
import type { JournalEntry } from '../../types/journal-entry';
import type { CogsCalculation } from '../../types/cin7';
import { getAccountMappings } from '../storage.server';

/**
 * COGS Journal Entry Generator
 *
 * Generates journal entries for Cost of Goods Sold transactions.
 *
 * Entry structure for sales:
 *   DEBIT:  COGS (4000.000) - Expense recognition
 *   CREDIT: Inventory (1310.000) - Asset reduction
 *
 * Entry structure for refunds (reversal):
 *   DEBIT:  Inventory (1310.000) - Restore inventory
 *   CREDIT: COGS (4000.000) - Reverse expense
 */

/**
 * Create COGS journal entries for an order
 *
 * @param shop - Shop domain
 * @param orderName - Order name (e.g., "#80819")
 * @param cogsCalculation - COGS calculation result
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @returns Array of journal entries (2 entries: COGS debit, Inventory credit)
 */
export async function createCogsJournalEntries(
  shop: string,
  orderName: string,
  cogsCalculation: CogsCalculation,
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const reference = `SO-${orderName}`;
  const accountMappings = await getAccountMappings(shop);

  // Skip if no COGS
  if (cogsCalculation.totalCogs.lessThanOrEqualTo(0)) {
    return entries;
  }

  // DEBIT: COGS (Expense account)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.cogs.accountCode,
    accountName: accountMappings.cogs.accountName,
    debit: cogsCalculation.totalCogs,
    credit: new Decimal(0),
    memo: `COGS - Order ${orderName}`,
  });

  // CREDIT: Inventory (Asset reduction)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.inventory.accountCode,
    accountName: accountMappings.inventory.accountName,
    debit: new Decimal(0),
    credit: cogsCalculation.totalCogs,
    memo: `Inventory - Order ${orderName}`,
  });

  return entries;
}

/**
 * Create COGS refund entries (reverse original COGS entries)
 *
 * @param shop - Shop domain
 * @param orderName - Order name (e.g., "#80819")
 * @param cogsCalculation - COGS calculation result
 * @param targetDate - Target date for journal entry (MM/DD/YYYY format)
 * @returns Array of journal entries (2 entries: Inventory debit, COGS credit)
 */
export async function createCogsRefundEntries(
  shop: string,
  orderName: string,
  cogsCalculation: CogsCalculation,
  targetDate: string
): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const reference = `RF-${orderName}`;
  const accountMappings = await getAccountMappings(shop);

  // Skip if no COGS
  if (cogsCalculation.totalCogs.lessThanOrEqualTo(0)) {
    return entries;
  }

  // DEBIT: Inventory (Restore inventory)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.inventory.accountCode,
    accountName: accountMappings.inventory.accountName,
    debit: cogsCalculation.totalCogs,
    credit: new Decimal(0),
    memo: `Inventory Restore - Refund ${orderName}`,
  });

  // CREDIT: COGS (Reverse expense)
  entries.push({
    date: targetDate,
    reference,
    account: accountMappings.cogs.accountCode,
    accountName: accountMappings.cogs.accountName,
    debit: new Decimal(0),
    credit: cogsCalculation.totalCogs,
    memo: `COGS Reversal - Refund ${orderName}`,
  });

  return entries;
}
