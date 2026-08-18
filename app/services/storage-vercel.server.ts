/**
 * Vercel-compatible storage service
 * Uses Vercel Blob Storage for serverless deployment
 */

import { put, list, del, head } from '@vercel/blob';
import type { SyncConfig, AccountMappings } from '../types/journal-entry';

const BLOB_PREFIX = 'sage50-sync';

/**
 * Options shared by every write.
 *
 * - `addRandomSuffix: false` keeps pathnames deterministic, so a blob can be read
 *   back by the same path it was written to.
 * - `allowOverwrite: true` is required by @vercel/blob v2, which throws on writing
 *   an existing pathname otherwise. Config, mappings and re-run exports all overwrite.
 */
const PUT_OPTIONS = {
  access: 'public' as const,
  addRandomSuffix: false,
  allowOverwrite: true,
};

/**
 * Read a blob's text by pathname.
 *
 * A blob's public URL is not `https://blob.vercel-storage.com/<pathname>` — it lives on
 * a store-specific host, so that URL 404s for every store. Resolve the real URL with
 * head() first, then fetch it. Returns null when the blob does not exist.
 */
async function readBlobText(pathname: string): Promise<string | null> {
  let meta;
  try {
    meta = await head(pathname);
  } catch {
    return null; // Not found.
  }

  const response = await fetch(meta.downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Blob ${pathname} resolved to ${meta.downloadUrl} but fetch failed: ${response.status} ${response.statusText}`
    );
  }
  return await response.text();
}

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
  const blobPath = `${BLOB_PREFIX}/${shop}/config.json`;
  const text = await readBlobText(blobPath);

  if (text === null) {
    return getDefaultConfig(shop);
  }

  try {
    return JSON.parse(text) as SyncConfig;
  } catch (error) {
    // Don't silently fall back to defaults on a corrupt config — that would look like
    // the merchant's settings reset themselves.
    throw new Error(
      `Stored config for ${shop} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Save shop configuration to Vercel Blob
 */
export async function saveShopConfig(shop: string, config: SyncConfig): Promise<void> {
  const blobPath = `${BLOB_PREFIX}/${shop}/config.json`;

  await put(blobPath, JSON.stringify(config, null, 2), {
    ...PUT_OPTIONS,
    contentType: 'application/json',
  });
}

/**
 * Read account mappings from Vercel Blob
 */
export async function getAccountMappings(shop: string): Promise<AccountMappings> {
  const blobPath = `${BLOB_PREFIX}/${shop}/mappings.json`;
  const text = await readBlobText(blobPath);

  if (text === null) {
    return getDefaultMappings();
  }

  try {
    return JSON.parse(text) as AccountMappings;
  } catch (error) {
    // Account mappings drive which GL accounts every journal line posts to. Falling
    // back to defaults here would silently produce a wrong-but-plausible export.
    throw new Error(
      `Stored account mappings for ${shop} are not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
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
    ...PUT_OPTIONS,
    contentType: 'application/json',
  });
}

/**
 * List all export files for a shop
 */
export async function listExports(shop: string): Promise<string[]> {
  try {
    const prefix = `${BLOB_PREFIX}/${shop}/exports/`;
    const blobs = [];

    // list() is paginated; without following the cursor a shop with many exports
    // would silently show only the first page.
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return blobs
      .map((blob) => ({
        name: blob.pathname.split('/').pop()!,
        uploadedAt: new Date(blob.uploadedAt).getTime(),
      }))
      // Match the filesystem backend, which lists .csv and .txt.
      .filter(({ name }) => name.endsWith('.csv') || name.endsWith('.txt'))
      .sort((a, b) => b.uploadedAt - a.uploadedAt) // Newest first.
      .map(({ name }) => name);
  } catch (error) {
    console.error(`[Blob] Failed to list exports for ${shop}:`, error);
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
    ...PUT_OPTIONS,
    contentType: contentTypeFor(filename),
  });

  return blob.url;
}

/** Exports are not all CSV — the journal summary is .txt and order data is .json. */
function contentTypeFor(filename: string): string {
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.txt')) return 'text/plain';
  return 'text/csv';
}

/**
 * Read export file from Vercel Blob
 */
export async function readExport(shop: string, filename: string): Promise<string> {
  const blobPath = `${BLOB_PREFIX}/${shop}/exports/${filename}`;
  const text = await readBlobText(blobPath);

  if (text === null) {
    throw new Error(`Export file not found: ${filename}`);
  }

  return text;
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

/**
 * Seed a shop's config and mappings if they don't exist yet.
 *
 * The storage adapter calls this on install; it was missing from this backend, so on
 * Vercel the call threw before any shop could be initialised. There are no directories
 * to create in blob storage, so this only writes the defaults.
 */
export async function initializeShop(shop: string): Promise<void> {
  const configPath = `${BLOB_PREFIX}/${shop}/config.json`;
  if ((await readBlobText(configPath)) === null) {
    await saveShopConfig(shop, getDefaultConfig(shop));
  }

  const mappingsPath = `${BLOB_PREFIX}/${shop}/mappings.json`;
  if ((await readBlobText(mappingsPath)) === null) {
    await saveAccountMappings(shop, getDefaultMappings());
  }
}
