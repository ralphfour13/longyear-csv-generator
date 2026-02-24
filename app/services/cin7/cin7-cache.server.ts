import { Decimal } from 'decimal.js';

/**
 * Cin7 Product Cache
 *
 * In-memory cache for Cin7 product costs with TTL expiration.
 * Implements per-shop isolation and automatic cleanup.
 */

interface CacheEntry {
  cost: Decimal;
  expiry: number; // Unix timestamp (ms)
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * Global cache instance (per Node.js process)
 */
class Cin7Cache {
  private cache: Map<string, CacheEntry>;
  private hits: number;
  private misses: number;

  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cached cost for a SKU
   *
   * @param shop - Shop domain
   * @param sku - Product SKU
   * @returns Cached cost, or null if not found/expired
   */
  get(shop: string, sku: string): Decimal | null {
    const key = this.getCacheKey(shop, sku);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.cost;
  }

  /**
   * Set cached cost for a SKU
   *
   * @param shop - Shop domain
   * @param sku - Product SKU
   * @param cost - Product cost
   * @param ttlHours - Time to live in hours
   */
  set(shop: string, sku: string, cost: Decimal, ttlHours: number): void {
    const key = this.getCacheKey(shop, sku);
    const expiry = Date.now() + ttlHours * 60 * 60 * 1000;

    this.cache.set(key, { cost, expiry });
  }

  /**
   * Clear cache for a specific shop
   *
   * @param shop - Shop domain
   */
  clearShop(shop: string): void {
    const prefix = `${shop}:`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear entire cache
   */
  clearAll(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   *
   * @param shop - Optional shop domain to filter stats
   * @returns Cache statistics
   */
  getStats(shop?: string): CacheStats {
    let size = this.cache.size;

    if (shop) {
      const prefix = `${shop}:`;
      size = 0;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          size++;
        }
      }
    }

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      size,
      hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimals
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Get cache key
   */
  private getCacheKey(shop: string, sku: string): string {
    return `${shop}:${sku.toUpperCase()}`;
  }
}

/**
 * Global cache instance
 */
const globalCache = new Cin7Cache();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  globalCache.cleanup();
}, 5 * 60 * 1000);

/**
 * Export cache instance
 */
export { globalCache as cin7Cache };
