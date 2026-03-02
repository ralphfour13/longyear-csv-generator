import type { Cin7Product } from '../../types/cin7';
import { Cin7ApiError, Cin7RateLimitError } from '../../types/cin7';

/**
 * Cin7 API Client
 *
 * HTTP client for Cin7 Core (Dear Systems) API v2.
 * Includes rate limiting (300 req/min) and retry logic.
 *
 * API Docs: https://dearinventory.docs.apiary.io/
 */

const BASE_URL = 'https://inventory.dearsystems.com/ExternalApi/v2';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// Very conservative rate limit: 120/min (2 req/sec) - leaves 60% headroom for Cin7's 300/min limit
const CONSERVATIVE_RATE_LIMIT = 120;

/**
 * Global rate limit state shared across all client instances
 */
class GlobalRateLimitState {
  private static instance: GlobalRateLimitState;
  private cooldownUntil: number = 0;

  static getInstance(): GlobalRateLimitState {
    if (!GlobalRateLimitState.instance) {
      GlobalRateLimitState.instance = new GlobalRateLimitState();
    }
    return GlobalRateLimitState.instance;
  }

  /**
   * Set a global cooldown period
   */
  setCooldown(seconds: number): void {
    const cooldownMs = seconds * 1000;
    this.cooldownUntil = Date.now() + cooldownMs;
    console.warn(`⚠️ Cin7 rate limit hit. Pausing ALL requests for ${seconds} seconds...`);
  }

  /**
   * Check if we're in a cooldown period
   */
  async waitForCooldown(): Promise<void> {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      const waitMs = this.cooldownUntil - now;
      console.warn(`⏳ Waiting ${Math.ceil(waitMs / 1000)}s for rate limit cooldown...`);
      await sleep(waitMs);
    }
  }

  /**
   * Check if currently in cooldown
   */
  isInCooldown(): boolean {
    return Date.now() < this.cooldownUntil;
  }
}

/**
 * Token Bucket Rate Limiter
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(capacity: number, refillPerMinute: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.refillRate = refillPerMinute / 60000; // Convert to per millisecond
  }

  /**
   * Wait until a token is available, then consume it
   */
  async wait(): Promise<void> {
    // Check global cooldown first
    await GlobalRateLimitState.getInstance().waitForCooldown();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Calculate wait time until next token is available
      const tokensNeeded = 1 - this.tokens;
      const waitMs = Math.ceil(tokensNeeded / this.refillRate);
      await sleep(Math.min(waitMs, 1000)); // Cap at 1 second chunks
    }
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Cin7 API Client
 */
export class Cin7Client {
  private baseUrl: string;
  private accountId: string;
  private apiKey: string;
  private rateLimiter: TokenBucket;

  constructor(accountId: string, apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.CIN7_BASE_URL || BASE_URL;
    this.accountId = accountId;
    this.apiKey = apiKey;
    // Very conservative: 10 token capacity, 120 req/min (2 req/sec with small bursts)
    this.rateLimiter = new TokenBucket(10, CONSERVATIVE_RATE_LIMIT);
  }

  /**
   * Get product by SKU
   *
   * @param sku - Product SKU
   * @returns Product details, or null if not found
   * @throws Cin7ApiError on API errors
   * @throws Cin7RateLimitError if rate limited (429)
   */
  async getProduct(sku: string): Promise<Cin7Product | null> {
    return this.retryWithBackoff(async () => {
      await this.rateLimiter.wait();

      const url = `${this.baseUrl}/product?sku=${encodeURIComponent(sku)}`;
      const response = await fetch(url, {
        headers: {
          'api-auth-accountid': this.accountId,
          'api-auth-applicationkey': this.apiKey,
        },
      });

      // Handle 404 - product not found
      if (response.status === 404) {
        return null;
      }

      // Handle 429 - rate limited
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        // Set global cooldown to pause all requests
        GlobalRateLimitState.getInstance().setCooldown(retryAfter);
        throw new Cin7RateLimitError(retryAfter, 'Rate limit exceeded');
      }

      // Handle other errors
      if (!response.ok) {
        throw new Cin7ApiError(
          response.status,
          response.statusText,
          `Failed to fetch product ${sku}: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      // Cin7 returns an object with Products array
      const products = data.Products;
      if (!products || products.length === 0) {
        return null;
      }

      return products[0] as Cin7Product;
    });
  }

  /**
   * Test connection to Cin7 API
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to fetch a non-existent product
      // 404 = valid auth, 401/403 = invalid auth
      await this.getProduct('TEST-NONEXISTENT');
      return true;
    } catch (error) {
      if (error instanceof Cin7ApiError) {
        // 401/403 = auth failure
        if (error.status === 401 || error.status === 403) {
          return false;
        }
        // Other errors might be transient, consider auth valid
        return true;
      }
      return false;
    }
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    attempt = 1
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      // Don't retry rate limit errors - let caller handle
      if (error instanceof Cin7RateLimitError) {
        throw error;
      }

      // Don't retry 4xx errors (except 429)
      if (error instanceof Cin7ApiError && error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Retry 5xx errors and network errors
      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `Cin7 API request failed (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delayMs}ms...`,
          error instanceof Error ? error.message : String(error)
        );
        await sleep(delayMs);
        return this.retryWithBackoff(fn, attempt + 1);
      }

      throw error;
    }
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
