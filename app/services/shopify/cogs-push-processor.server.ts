import { Cin7ProductService } from '../cin7/cin7-product-service.server';
import { updateJobProgress } from '../background-jobs.server';
import {
  fetchActiveVariants,
  updateInventoryItemCost,
  type ShopifyVariant,
} from './product-cost-updater.server';

/**
 * COGS Push Processor
 *
 * Pulls COGS (Cin7 AverageCost) for every active Shopify variant's SKU and writes
 * it into the Shopify "Cost per item" field (InventoryItem cost).
 *
 * Per product decision: when Cin7 has no cost for a SKU, the cost is zero, or the
 * variant has no SKU, the existing Shopify cost is LEFT UNCHANGED and the SKU is
 * recorded in the report so it can be flagged loudly. Cin7 fallback cost is NOT
 * applied here.
 */

export interface CogsPushSkipped {
  sku: string | null;
  productTitle: string;
  reason: 'no Cin7 match' | 'zero cost' | 'missing SKU';
}

export interface CogsPushFailed {
  sku: string | null;
  productTitle: string;
  error: string;
}

export interface CogsPushResult {
  success: boolean;
  message: string;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  totalVariants: number;
  skipped: CogsPushSkipped[];
  failed: CogsPushFailed[];
  ranAt: string;
}

// Number of concurrent Shopify cost-update mutations in flight. Conservative to
// stay within Shopify's GraphQL cost-based rate limit (retryShopifyAPI handles
// throttle backoff per call).
const WRITE_CONCURRENCY = 3;

export async function processCogsPush(
  shop: string,
  accessToken: string,
  jobId: string,
): Promise<CogsPushResult> {
  const skipped: CogsPushSkipped[] = [];
  const failed: CogsPushFailed[] = [];
  let updatedCount = 0;

  // Phase 1: enumerate active variants.
  // The COGS push doesn't fit the export-oriented phase-weight model in
  // calculateOverallProgress (it has no transactionsFetched/filesGenerated), so we
  // set overallPercentage explicitly: fetching 0-10%, Cin7 lookup 10-40%, writing 40-99%.
  await updateJobProgress(jobId, {
    phase: 'fetching',
    phaseLabel: 'Loading Shopify products',
    currentActivity: 'Fetching active product variants...',
    startTime: Date.now(),
    overallPercentage: 2,
  });

  const variants = await fetchActiveVariants(shop, accessToken, async (count) => {
    await updateJobProgress(jobId, {
      phase: 'fetching',
      phaseLabel: 'Loading Shopify products',
      currentActivity: `Fetched ${count} variants...`,
      ordersFound: count,
      overallPercentage: 8,
    });
  });

  const totalVariants = variants.length;

  // Variants with a usable SKU; record the SKU-less ones up front
  const withSku: ShopifyVariant[] = [];
  for (const v of variants) {
    if (!v.sku) {
      skipped.push({ sku: null, productTitle: v.productTitle, reason: 'missing SKU' });
    } else {
      withSku.push(v);
    }
  }

  // Phase 2: pull COGS from Cin7 (cache-first, rate-limited)
  await updateJobProgress(jobId, {
    phase: 'cogs',
    phaseLabel: 'Pulling COGS from Cin7',
    currentActivity: `Looking up ${withSku.length} SKUs in Cin7...`,
    ordersFound: totalVariants,
    ordersProcessed: 0,
    overallPercentage: 15,
  });

  const cin7 = new Cin7ProductService(shop);
  await cin7.initialize();

  // Use the raw lookup so a missing/error SKU stays null (skip + flag), never a
  // silently-substituted fallback cost.
  const uniqueSkus = Array.from(new Set(withSku.map((v) => v.sku as string)));
  const costMap = await cin7.batchGetRawCosts(uniqueSkus);

  // Phase 3: write costs to Shopify (40% -> 99%)
  await updateJobProgress(jobId, {
    phase: 'generating',
    phaseLabel: 'Updating Shopify costs',
    currentActivity: 'Writing costs to Shopify...',
    ordersFound: totalVariants,
    ordersProcessed: 0,
    overallPercentage: 40,
  });

  let processed = 0;
  for (let i = 0; i < withSku.length; i += WRITE_CONCURRENCY) {
    const batch = withSku.slice(i, i + WRITE_CONCURRENCY);

    await Promise.all(
      batch.map(async (variant) => {
        const sku = variant.sku as string;
        const cost = costMap.get(sku) ?? null;

        // No-match safety: never overwrite with a missing or zero cost
        if (cost === null) {
          skipped.push({ sku, productTitle: variant.productTitle, reason: 'no Cin7 match' });
          return;
        }
        if (cost.isZero() || cost.isNegative()) {
          skipped.push({ sku, productTitle: variant.productTitle, reason: 'zero cost' });
          return;
        }

        try {
          await updateInventoryItemCost(
            shop,
            accessToken,
            variant.inventoryItemId,
            cost.toNumber(),
          );
          updatedCount++;
        } catch (error) {
          failed.push({
            sku,
            productTitle: variant.productTitle,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    processed += batch.length;
    const writeFraction = withSku.length > 0 ? processed / withSku.length : 1;
    await updateJobProgress(jobId, {
      phase: 'generating',
      phaseLabel: 'Updating Shopify costs',
      currentActivity: `Updated ${updatedCount}, skipped ${skipped.length}, failed ${failed.length}`,
      ordersFound: totalVariants,
      ordersProcessed: processed,
      overallPercentage: Math.min(99, 40 + Math.round(writeFraction * 59)),
    });
  }

  const skippedCount = skipped.length;
  const failedCount = failed.length;

  return {
    success: true,
    message: `Updated ${updatedCount} of ${totalVariants} variants (${skippedCount} skipped, ${failedCount} failed)`,
    updatedCount,
    skippedCount,
    failedCount,
    totalVariants,
    skipped,
    failed,
    ranAt: new Date().toISOString(),
  };
}
