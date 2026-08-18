import { promises as fs } from "fs";
import path from "path";
import type { SyncConfig, AccountMappings } from "../types/journal-entry";
// import { put, list, del } from "@vercel/blob";

const DATA_DIR = process.env.VERCEL
  ? "/tmp/data"
  : path.join(process.cwd(), "data");

/**
 * Ensures shop directory structure exists
 */
async function ensureShopDirectory(shop: string): Promise<string> {
  const shopDir = path.join(DATA_DIR, shop);
  const exportsDir = path.join(shopDir, "exports");

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
    syncSchedule: "manual",
    scheduledTime: "02:00",
    autoExportDate: "yesterday",
    transactionTypes: {
      orders: true,
      refunds: true,
      payments: true,
      inventory: false,
    },
    csvFormat: "standard",
    emailEnabled: false,
    emailRecipients: "",
  };
}

/**
 * Get default account mappings
 */
function getDefaultMappings(): AccountMappings {
  return {
    sales_revenue: {
      accountCode: "3000.000",
      accountName: "Merchandise Sales",
      description: "Product sales revenue",
    },
    sales_tax: {
      accountCode: "2110.000",
      accountName: "Sales Tax",
      description: "Collected sales tax",
    },
    shipping_revenue: {
      accountCode: "3040.000",
      accountName: "Shipping Income",
      description: "Shipping charges",
    },
    discounts: {
      accountCode: "3034.000",
      accountName: "Transaction/Merchandise Discount",
      description: "Customer discounts and promotions",
    },
    accounts_receivable: {
      accountCode: "1200.000",
      accountName: "Accounts Receivable",
      description: "Outstanding invoices issued but not yet received in cash",
    },
    cash_account: {
      accountCode: "1051.000",
      accountName: "Cash/Check",
      description: "Cash and check payments",
    },
    clearing_account: {
      accountCode: "1061.000",
      accountName: "Credit Card/PayPal",
      description:
        "Credit card and PayPal payments (AR clearing for Shopify Payments)",
    },
    payment_processing_fees: {
      accountCode: "5450.000",
      accountName: "Bank Fees",
      description: "Payment processing and bank fees",
    },
    shopify_fees: {
      accountCode: "5450.000",
      accountName: "Bank Fees",
      description: "Shopify transaction fees (combined with bank fees)",
    },
    refunds_given: {
      accountCode: "3035.000",
      accountName: "Refund",
      description: "Customer refunds",
    },
    cogs: {
      accountCode: "4000.000",
      accountName: "Cost of Goods Sold",
      description: "Cost of goods sold",
    },
    inventory: {
      accountCode: "1310.000",
      accountName: "Inventory",
      description: "Receipt & Voucher Inventory",
    },
    // Payment method specific accounts
    gift_card_liability: {
      accountCode: "2320.000",
      accountName: "Gift Cards/Gift Certificates",
      description: "Gift Cards/Gift Certificates Sold/Redeemed",
    },
    store_credit_liability: {
      accountCode: "2340.000",
      accountName: "Store Credit/Store Credit Adjustments",
      description: "Store credit given/taken",
    },
    cash_register: {
      accountCode: "1051.000",
      accountName: "Cash/Check",
      description: "Cash and check payments at point of sale",
    },
    cogs_inventory_writeoff: {
      accountCode: "4005.000",
      accountName: "Inventory Adjustment/Memo Offset/Transfer Offset",
      description:
        "Inventory adjustments for manual charges (e.g., travel giveaways)",
    },
    undeposited_funds: {
      accountCode: "1051.000",
      accountName: "Cash/Check",
      description: "Checks received but not yet deposited",
    },
  };
}

/**
 * Read shop configuration
 */
export async function getShopConfig(shop: string): Promise<SyncConfig> {
  try {
    const shopDir = await ensureShopDirectory(shop);
    const configPath = path.join(shopDir, "config.json");

    const data = await fs.readFile(configPath, "utf-8");
    return JSON.parse(data) as SyncConfig;
  } catch (error) {
    // Return default config if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return getDefaultConfig(shop);
    }
    throw error;
  }
}

/**
 * Save shop configuration
 */
export async function saveShopConfig(
  shop: string,
  config: SyncConfig,
): Promise<void> {
  const shopDir = await ensureShopDirectory(shop);
  const configPath = path.join(shopDir, "config.json");

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Read account mappings
 */
export async function getAccountMappings(
  shop: string,
): Promise<AccountMappings> {
  try {
    const shopDir = await ensureShopDirectory(shop);
    const mappingsPath = path.join(shopDir, "mappings.json");

    const data = await fs.readFile(mappingsPath, "utf-8");
    return JSON.parse(data) as AccountMappings;
  } catch (error) {
    // Return default mappings if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
  mappings: AccountMappings,
): Promise<void> {
  const shopDir = await ensureShopDirectory(shop);
  const mappingsPath = path.join(shopDir, "mappings.json");

  await fs.writeFile(mappingsPath, JSON.stringify(mappings, null, 2), "utf-8");
}

/**
 * List all export files for a shop
 * Sorted by file creation time (newest first)
 * DEVELOPMENT ONLY: This function is not used in production, but can be useful for debugging and testing.
 */
export async function listExports(shop: string): Promise<string[]> {
  try {
    const exportsDir = path.join(DATA_DIR, shop, "exports");
    const files = await fs.readdir(exportsDir);

    // Filter for CSV and TXT files
    const csvFiles = files.filter(
      (file) => file.endsWith(".csv") || file.endsWith(".txt"),
    );

    // Get file stats for sorting by creation time
    const filesWithStats = await Promise.all(
      csvFiles.map(async (file) => {
        const filePath = path.join(exportsDir, file);
        const stats = await fs.stat(filePath);
        return {
          filename: file,
          birthtime: stats.birthtime.getTime(),
          mtime: stats.mtime.getTime(),
        };
      }),
    );

    // Sort by modification time (newest first) - mtime changes when file is written
    return filesWithStats
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** PRODUCTION ONLY: This function is not used in development, but can be useful for debugging and testing. */
// export async function listExports(shop: string): Promise<string[]> {
//   const { blobs } = await list({ prefix: `${shop}/exports/` });
//   return blobs.map((b) => b.pathname.split("/").pop()!);
// }

/**
 * Get path to export file
 */
export function getExportPath(shop: string, filename: string): string {
  return path.join(DATA_DIR, shop, "exports", filename);
}

/**
 * Check if export file exists
 */
export async function exportExists(
  shop: string,
  filename: string,
): Promise<boolean> {
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
export async function deleteExport(
  shop: string,
  filename: string,
): Promise<void> {
  const exportPath = getExportPath(shop, filename);
  await fs.unlink(exportPath);
}

/**
 * Read export file contents
 */
export async function readExport(
  shop: string,
  filename: string,
): Promise<string> {
  const exportPath = getExportPath(shop, filename);
  return fs.readFile(exportPath, "utf-8");
}

/**
 * Write export file
 * development only: This function is not used in production, but can be useful for debugging and testing.
 */
export async function writeExport(
  shop: string,
  filename: string,
  content: string,
): Promise<string> {
  const shopDir = await ensureShopDirectory(shop);
  const exportPath = path.join(shopDir, "exports", filename);

  await fs.writeFile(exportPath, content, "utf-8");

  return exportPath;
}

/** PRODUCTION ONLY: This function is not used in development, but can be useful for debugging and testing. */
// export async function writeExport(
//   shop: string,
//   filename: string,
//   content: string,
// ): Promise<string> {
//   const blob = await put(`${shop}/exports/${filename}`, content, {
//     access: "public",
//   });

//   return blob.url;
// }

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
  const configPath = path.join(shopDir, "config.json");
  try {
    await fs.access(configPath);
  } catch {
    await saveShopConfig(shop, getDefaultConfig(shop));
  }

  // Create default mappings if they don't exist
  const mappingsPath = path.join(shopDir, "mappings.json");
  try {
    await fs.access(mappingsPath);
  } catch {
    await saveAccountMappings(shop, getDefaultMappings());
  }
}
