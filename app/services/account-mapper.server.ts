import type { JournalEntry, AccountMappings } from '../types/journal-entry';

/**
 * Apply account mappings to journal entries
 *
 * Replaces default account codes with user-configured mappings
 *
 * @param entries - Journal entries with default account codes
 * @param mappings - User-configured account mappings
 * @returns Journal entries with mapped account codes
 */
export function applyAccountMappings(
  entries: JournalEntry[],
  mappings: AccountMappings
): JournalEntry[] {
  // Map of default codes to mapping keys
  const codeToKey: Record<string, keyof AccountMappings> = {
    '4000-00': 'sales_revenue',
    '2200-00': 'sales_tax',
    '4100-00': 'shipping_revenue',
    '4050-00': 'discounts',
    '1200-00': 'accounts_receivable',
    '1000-00': 'cash_account',
    '1250-00': 'clearing_account',
    '6100-00': 'payment_processing_fees',
    '6110-00': 'shopify_fees',
    '4900-00': 'refunds_given',
    '5000-00': 'cogs',
    '1400-00': 'inventory',
  };

  return entries.map((entry) => {
    // Find mapping key for this account code
    const mappingKey = codeToKey[entry.account];

    if (mappingKey && mappings[mappingKey]) {
      // Apply mapping
      return {
        ...entry,
        account: mappings[mappingKey].accountCode,
        accountName: mappings[mappingKey].accountName,
      };
    }

    // No mapping found, return as-is
    return entry;
  });
}

/**
 * Validate that all required account mappings exist
 *
 * @param mappings - Account mappings to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateAccountMappings(mappings: AccountMappings): string[] {
  const errors: string[] = [];

  const requiredMappings: Array<keyof AccountMappings> = [
    'sales_revenue',
    'sales_tax',
    'cash_account',
    'clearing_account',
    'payment_processing_fees',
  ];

  for (const key of requiredMappings) {
    if (!mappings[key]) {
      errors.push(`Missing required account mapping: ${key}`);
      continue;
    }

    const mapping = mappings[key];

    if (!mapping.accountCode || mapping.accountCode.trim() === '') {
      errors.push(`Account mapping ${key} is missing account code`);
    }

    if (!mapping.accountName || mapping.accountName.trim() === '') {
      errors.push(`Account mapping ${key} is missing account name`);
    }
  }

  return errors;
}

/**
 * Get account code for a specific mapping key
 *
 * @param mappings - Account mappings
 * @param key - Mapping key
 * @param defaultCode - Default code to use if mapping not found
 * @returns Account code
 */
export function getAccountCode(
  mappings: AccountMappings,
  key: keyof AccountMappings,
  defaultCode: string
): string {
  return mappings[key]?.accountCode || defaultCode;
}

/**
 * Get account name for a specific mapping key
 *
 * @param mappings - Account mappings
 * @param key - Mapping key
 * @param defaultName - Default name to use if mapping not found
 * @returns Account name
 */
export function getAccountName(
  mappings: AccountMappings,
  key: keyof AccountMappings,
  defaultName: string
): string {
  return mappings[key]?.accountName || defaultName;
}
