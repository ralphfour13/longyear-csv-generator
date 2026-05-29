import { Decimal } from 'decimal.js';
import { Cin7Client } from './cin7-client.server';
import { cin7Cache } from './cin7-cache.server';
import { getCin7Config } from './cin7-credential-manager.server';

/**
 * Cin7 Product Service
 *
 * High-level service for fetching product costs from Cin7.
 * Implements cache-first strategy with fallback cost support.
 */

export class Cin7ProductService {
  private shop: string;
  private client: Cin7Client | null = null;
  private config: Awaited<ReturnType<typeof getCin7Config>> | null = null;
  private initialized = false;

  constructor(shop: string) {
    this.shop = shop;
  }

  /**
   * Initialize the service by loading config and creating client
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.config = await getCin7Config(this.shop);

    if (!this.config.enabled) {
      this.initialized = true;
      return;
    }

    if (!this.config.accountId || !this.config.apiKey) {
      throw new Error('Cin7 is enabled but credentials are not configured');
    }

    this.client = new Cin7Client(this.config.accountId, this.config.apiKey);
    this.initialized = true;
  }

  /**
   * Get product cost by SKU
   *
   * @param sku - Product SKU
   * @returns Product cost, or null if not found and no fallback
   */
  async getProductCost(sku: string): Promise<Decimal | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Return null if Cin7 is not enabled
    if (!this.config?.enabled || !this.client) {
      return null;
    }

    // Check cache first
    if (this.config.cacheEnabled) {
      const cachedCost = cin7Cache.get(this.shop, sku);
      if (cachedCost !== null) {
        return cachedCost;
      }
    }

    // Fetch from Cin7 API
    try {
      const product = await this.client.getProduct(sku);

      if (product && product.AverageCost !== undefined) {
        const cost = new Decimal(product.AverageCost);

        // Cache the result
        if (this.config.cacheEnabled) {
          cin7Cache.set(this.shop, sku, cost, this.config.cacheDurationHours);
        }

        return cost;
      }

      // Product not found - check for fallback
      if (this.config.useFallback && this.config.fallbackCost) {
        const fallbackCost = new Decimal(this.config.fallbackCost);

        // Cache fallback cost too
        if (this.config.cacheEnabled) {
          cin7Cache.set(this.shop, sku, fallbackCost, this.config.cacheDurationHours);
        }

        return fallbackCost;
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch cost for SKU ${sku}:`, error);

      // On error, use fallback if configured
      if (this.config.useFallback && this.config.fallbackCost) {
        return new Decimal(this.config.fallbackCost);
      }

      return null;
    }
  }

  /**
   * Get the ACTUAL Cin7 cost for a SKU, live, with no caching or fallback.
   *
   * Always queries Cin7 in real time (never reads or writes cin7Cache) and
   * returns null whenever Cin7 has no cost for the SKU (or the lookup errors),
   * regardless of the configured fallback. Use this when costs must be current
   * and a missing cost must be surfaced rather than silently filled — e.g. the
   * COGS push, which must leave the Shopify cost unchanged and flag the SKU.
   *
   * @param sku - Product SKU
   * @returns The live Cin7 AverageCost, or null if not found / on error
   */
  async getRawProductCost(sku: string): Promise<Decimal | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.config?.enabled || !this.client) {
      return null;
    }

    try {
      const product = await this.client.getProduct(sku);

      if (product && product.AverageCost !== undefined) {
        return new Decimal(product.AverageCost);
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch cost for SKU ${sku}:`, error);
      return null;
    }
  }

  /**
   * Batch get product costs with controlled concurrency
   *
   * @param skus - Array of SKUs
   * @returns Map of SKU to cost (null if not found)
   */
  async batchGetCosts(skus: string[]): Promise<Map<string, Decimal | null>> {
    return this.batchGet(skus, (sku) => this.getProductCost(sku));
  }

  /**
   * Batch get ACTUAL Cin7 costs (no fallback substitution) with controlled concurrency.
   *
   * @param skus - Array of SKUs
   * @returns Map of SKU to cost (null if not found in Cin7 / on error)
   */
  async batchGetRawCosts(skus: string[]): Promise<Map<string, Decimal | null>> {
    return this.batchGet(skus, (sku) => this.getRawProductCost(sku));
  }

  private async batchGet(
    skus: string[],
    lookup: (sku: string) => Promise<Decimal | null>,
  ): Promise<Map<string, Decimal | null>> {
    const results = new Map<string, Decimal | null>();

    // Process with limited concurrency (2 at a time) to avoid overwhelming rate limiter
    // Very conservative to stay well under Cin7's 300 req/min limit
    const CONCURRENCY = 2;
    for (let i = 0; i < skus.length; i += CONCURRENCY) {
      const batch = skus.slice(i, i + CONCURRENCY);
      const promises = batch.map(async (sku) => {
        const cost = await lookup(sku);
        results.set(sku, cost);
      });
      await Promise.all(promises);

      // Log progress for large batches (reduced verbosity)
      if (i > 0 && i % 100 === 0) {
        console.log(`  Fetched ${i}/${skus.length} SKU costs...`);
      }
    }

    return results;
  }

  /**
   * Clear cache for this shop
   */
  clearCache(): void {
    cin7Cache.clearShop(this.shop);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return cin7Cache.getStats(this.shop);
  }
}
