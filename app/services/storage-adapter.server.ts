/**
 * Storage Adapter
 *
 * Automatically uses the right storage backend:
 * - Local filesystem for development
 * - Vercel Blob for Vercel deployment
 */

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

async function getStorageModule() {
  if (IS_VERCEL) {
    console.log('Using Vercel Blob storage');
    return import('./storage-vercel.server');
  }

  console.log('Using filesystem storage');
  return import('./storage.server');
}

export async function getShopConfig(shop: string) {
  return (await getStorageModule()).getShopConfig(shop);
}

export async function saveShopConfig(shop: string, config: unknown) {
  return (await getStorageModule()).saveShopConfig(shop, config);
}

export async function getAccountMappings(shop: string) {
  return (await getStorageModule()).getAccountMappings(shop);
}

export async function saveAccountMappings(shop: string, mappings: unknown) {
  return (await getStorageModule()).saveAccountMappings(shop, mappings);
}

export async function listExports(shop: string) {
  return (await getStorageModule()).listExports(shop);
}

export async function writeExport(shop: string, filename: string, content: string) {
  return (await getStorageModule()).writeExport(shop, filename, content);
}

export async function readExport(shop: string, filename: string) {
  return (await getStorageModule()).readExport(shop, filename);
}

export async function exportExists(shop: string, filename: string) {
  return (await getStorageModule()).exportExists(shop, filename);
}

export async function getExportStats(shop: string, filename: string) {
  return (await getStorageModule()).getExportStats(shop, filename);
}

export async function getExportPath(shop: string, filename: string) {
  return (await getStorageModule()).getExportPath(shop, filename);
}

export async function deleteExport(shop: string, filename: string) {
  return (await getStorageModule()).deleteExport(shop, filename);
}

export async function initializeShop(shop: string) {
  return (await getStorageModule()).initializeShop(shop);
}
