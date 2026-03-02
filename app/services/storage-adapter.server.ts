/**
 * Storage Adapter
 *
 * Automatically uses the right storage backend:
 * - Local filesystem for development
 * - Vercel Blob for Vercel deployment
 */

// Detect environment
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

// Import appropriate storage implementation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
let storage: any;

if (IS_VERCEL) {
  // Use Vercel Blob storage
  console.log('Using Vercel Blob storage');
  storage = await import('./storage-vercel.server');
} else {
  // Use filesystem storage
  console.log('Using filesystem storage');
  storage = await import('./storage.server');
}

// Re-export all storage functions
export const {
  getShopConfig,
  saveShopConfig,
  getAccountMappings,
  saveAccountMappings,
  listExports,
  writeExport,
  readExport,
  exportExists,
  getExportStats,
  getExportPath,
  deleteExport,
  initializeShop,
} = storage;
