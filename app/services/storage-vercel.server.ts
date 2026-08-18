/**
 * Vercel-compatible storage service
 * Uses Vercel Blob Storage for serverless deployment
 */

import { put, list, del, head } from '@vercel/blob';
import type { SyncConfig, AccountMappings } from '../types/journal-entry';

const BLOB_PREFIX = 'sage50-sync';

/**
 * Get default sync configuration
 */
function getDefaultConfig(shop: string): SyncConfig {
  return {
    shop,
    syncEnabled: false,
    syncSchedule: 'manual',
    scheduledTime: '02:00',
    autoExportDate: 'yesterday',
    transactionTypes: {
      orders: true,
      refunds: true,
      payments: true,
      inventory: false,
    },
    csvFormat: 'standard',
  };
}

/**
 * Get default account mappings
 */
function getDefaultMappings(): AccountMappings {
  return {
    sales_revenue: {
      accountCode: '4000-00',
      accountName: 'Sales Revenue',
      description: 'Product sales revenue',
    },
    sales_tax: {
      accountCode: '2200-00',
      accountName: 'Sales Tax Payable',
      description: 'Collected sales tax',
    },
    shipping_revenue: {
      accountCode: '4100-00',
      accountName: 'Shipping Revenue',
      description: 'Shipping charges',
    },
    discounts: {
      accountCode: '4050-00',
      accountName: 'Discounts Given',
      description: 'Customer discounts',
    },
    accounts_receivable: {
      accountCode: '1200-00',
      accountName: 'Accounts Receivable',
    },
    cash_account: {
      accountCode: '1000-00',
      accountName: 'Cash - Shopify Account',
      description: 'Shopify payouts to bank',
    },
    clearing_account: {
      accountCode: '1250-00',
      accountName: 'Shopify Clearing Account',
      description: 'Temporary holding account',
    },
    payment_processing_fees: {
      accountCode: '6100-00',
      accountName: 'Payment Processing Fees',
      description: 'Gateway fees',
    },
    shopify_fees: {
      accountCode: '6110-00',
      accountName: 'Shopify Transaction Fees',
    },
    refunds_given: {
      accountCode: '4900-00',
      accountName: 'Sales Returns & Refunds',
    },
    cogs: {
      accountCode: '5000-00',
      accountName: 'Cost of Goods Sold',
    },
    inventory: {
      accountCode: '1400-00',
      accountName: 'Inventory Asset',
    },
    gift_card_liability: {
      accountCode: '2300-00',
      accountName: 'Gift Card Liability',
    },
    store_credit_liability: {
      accountCode: '2310-00',
      accountName: 'Store Credit Liability',
    },
    cash_register: {
      accountCode: '1010-00',
      accountName: 'Cash Register',
    },
    cogs_inventory_writeoff: {
      accountCode: '5100-00',
      accountName: 'COGS Inventory Write-off',
    },
    undeposited_funds: {
      accountCode: '1050-00',
      accountName: 'Undeposited Funds',
    },
  };
}

/**
 * Read shop configuration from Vercel Blob
 */
export async function getShopConfig(shop: string): Promise<SyncConfig> {
  try {
    const blobPath = `${BLOB_PREFIX}/${shop}/config.json`;
    const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`);

    if (response.ok) {
      return await response.json() as SyncConfig;
    }

    // Return default if not found
    return getDefaultConfig(shop);
  } catch {
    return getDefaultConfig(shop);
  }
}

/**
 * Save shop configuration to Vercel Blob
 */
export async function saveShopConfig(shop: string, config: SyncConfig): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${shop}/config.json`;

  await put(blobPath, JSON.stringify(config, null, 2), {
    access: 'public',
    contentType: 'application/json',
  });
}

/**
 * Read account mappings from Vercel Blob
 */
export async function getAccountMappings(shop: string): Promise<AccountMappings> {
  try {
    const blobPath = `${BLOB_PREFIX}/${shop}/mappings.json`;
    const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`);

    if (response.ok) {
      return await response.json() as AccountMappings;
    }

    return getDefaultMappings();
  } catch {
    return getDefaultMappings();
  }
}

/**
 * Save account mappings to Vercel Blob
 */
export async function saveAccountMappings(
  shop: string,
  mappings: AccountMappings
): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${shop}/mappings.json`;

  await put(blobPath, JSON.stringify(mappings, null, 2), {
    access: 'public',
    contentType: 'application/json',
  });
}

/**
 * List all export files for a shop
 */
export async function listExports(shop: string): Promise<string[]> {
  try {
    const prefix = `${BLOB_PREFIX}/${shop}/exports/`;
    const { blobs } = await list({ prefix });

    return blobs
      .map((blob) => blob.pathname.split('/').pop()!)
      .filter((name) => name.endsWith('.csv'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Write export file to Vercel Blob
 */
export async function writeExport(
  shop: string,
  filename: string,
  content: string
): Promise<string> {
  const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;

  const blob = await put(blobPath, content, {
    access: 'public',
    contentType: 'text/csv',
  });

  return blob.url;
}

/**
 * Read export file from Vercel Blob
 */
export async function readExport(shop: string, filename: string): Promise<string> {
  const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;
  const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`);

  if (!response.ok) {
    throw new Error(`Export file not found: ${filename}`);
  }

  return await response.text();
}

/**
 * Check if export exists
 */
export async function exportExists(shop: string, filename: string): Promise<boolean> {
  try {
    const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;
    await head(blobPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get export file stats
 */
export async function getExportStats(shop: string, filename: string) {
  const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;

  try {
    const metadata = await head(blobPath);

    return {
      filename,
      size: metadata.size,
      created: new Date(metadata.uploadedAt),
      modified: new Date(metadata.uploadedAt),
    };
  } catch {
    throw new Error(`Export file not found: ${filename}`);
  }
}

/**
 * Get blob path helper
 */
export function getExportPath(shop: string, filename: string): string {
  return `${BLOB_PREFIX}/${shop}/exports/${filename}`;
}

/**
 * Delete export file
 */
export async function deleteExport(shop: string, filename: string): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;
  await del(blobPath);
}
