import { promises as fs } from 'fs';
import path from 'path';
import type { SyncConfig, AccountMappings } from '../types/journal-entry';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Ensures shop directory structure exists
 */
async function ensureShopDirectory(shop: string): Promise<string> {
  const shopDir = path.join(DATA_DIR, shop);
  const exportsDir = path.join(shopDir, 'exports');

  await fs.mkdir(shopDir, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });

  return shopDir;
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
      description: 'Customer discounts and promotions',
    },
    accounts_receivable: {
      accountCode: '1200-00',
      accountName: 'Accounts Receivable',
      description: 'Customer receivables',
    },
    cash_account: {
      accountCode: '1000-00',
      accountName: 'Cash - Shopify Account',
      description: 'Shopify payouts to bank',
    },
    clearing_account: {
      accountCode: '1250-00',
      accountName: 'Shopify Clearing Account',
      description: 'Temporary holding for unreconciled transactions',
    },
    payment_processing_fees: {
      accountCode: '6100-00',
      accountName: 'Payment Processing Fees',
      description: 'Shopify fees, gateway fees, etc.',
    },
    shopify_fees: {
      accountCode: '6110-00',
      accountName: 'Shopify Transaction Fees',
      description: 'Shopify platform transaction fees',
    },
    refunds_given: {
      accountCode: '4900-00',
      accountName: 'Sales Returns & Refunds',
      description: 'Customer refunds',
    },
    cogs: {
      accountCode: '5000-00',
      accountName: 'Cost of Goods Sold',
      description: 'Product costs',
    },
    inventory: {
      accountCode: '1400-00',
      accountName: 'Inventory Asset',
      description: 'Inventory on hand',
    },
  };
}

/**
 * Read shop configuration
 */
export async function getShopConfig(shop: string): Promise<SyncConfig> {
  try {
    const shopDir = await ensureShopDirectory(shop);
    const configPath = path.join(shopDir, 'config.json');

    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data) as SyncConfig;
  } catch (error) {
    // Return default config if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return getDefaultConfig(shop);
    }
    throw error;
  }
}

/**
 * Save shop configuration
 */
export async function saveShopConfig(shop: string, config: SyncConfig): Promise<void> {
  const shopDir = await ensureShopDirectory(shop);
  const configPath = path.join(shopDir, 'config.json');

  await fs.writeFile(
    configPath,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

/**
 * Read account mappings
 */
export async function getAccountMappings(shop: string): Promise<AccountMappings> {
  try {
    const shopDir = await ensureShopDirectory(shop);
    const mappingsPath = path.join(shopDir, 'mappings.json');

    const data = await fs.readFile(mappingsPath, 'utf-8');
    return JSON.parse(data) as AccountMappings;
  } catch (error) {
    // Return default mappings if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return getDefaultMappings();
    }
    throw error;
  }
}

/**
 * Save account mappings
 */
export async function saveAccountMappings(
  shop: string,
  mappings: AccountMappings
): Promise<void> {
  const shopDir = await ensureShopDirectory(shop);
  const mappingsPath = path.join(shopDir, 'mappings.json');

  await fs.writeFile(
    mappingsPath,
    JSON.stringify(mappings, null, 2),
    'utf-8'
  );
}

/**
 * List all export files for a shop
 */
export async function listExports(shop: string): Promise<string[]> {
  try {
    const exportsDir = path.join(DATA_DIR, shop, 'exports');
    const files = await fs.readdir(exportsDir);

    // Filter for CSV files and sort by date (newest first)
    return files
      .filter(file => file.endsWith('.csv'))
      .sort((a, b) => b.localeCompare(a));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get path to export file
 */
export function getExportPath(shop: string, filename: string): string {
  return path.join(DATA_DIR, shop, 'exports', filename);
}

/**
 * Check if export file exists
 */
export async function exportExists(shop: string, filename: string): Promise<boolean> {
  try {
    const exportPath = getExportPath(shop, filename);
    await fs.access(exportPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete export file
 */
export async function deleteExport(shop: string, filename: string): Promise<void> {
  const exportPath = getExportPath(shop, filename);
  await fs.unlink(exportPath);
}

/**
 * Read export file contents
 */
export async function readExport(shop: string, filename: string): Promise<string> {
  const exportPath = getExportPath(shop, filename);
  return fs.readFile(exportPath, 'utf-8');
}

/**
 * Write export file
 */
export async function writeExport(
  shop: string,
  filename: string,
  content: string
): Promise<string> {
  const shopDir = await ensureShopDirectory(shop);
  const exportPath = path.join(shopDir, 'exports', filename);

  await fs.writeFile(exportPath, content, 'utf-8');

  return exportPath;
}

/**
 * Get export file stats
 */
export async function getExportStats(shop: string, filename: string) {
  const exportPath = getExportPath(shop, filename);
  const stats = await fs.stat(exportPath);

  return {
    filename,
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
  };
}

/**
 * Initialize shop with default configuration
 */
export async function initializeShop(shop: string): Promise<void> {
  const shopDir = await ensureShopDirectory(shop);

  // Create default config if it doesn't exist
  const configPath = path.join(shopDir, 'config.json');
  try {
    await fs.access(configPath);
  } catch {
    await saveShopConfig(shop, getDefaultConfig(shop));
  }

  // Create default mappings if they don't exist
  const mappingsPath = path.join(shopDir, 'mappings.json');
  try {
    await fs.access(mappingsPath);
  } catch {
    await saveAccountMappings(shop, getDefaultMappings());
  }
}
