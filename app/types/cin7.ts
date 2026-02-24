import { Decimal } from 'decimal.js';

/**
 * Cin7 Configuration
 * Stored in data/{shop}/cin7-config.json (encrypted)
 */
export interface Cin7Config {
  enabled: boolean;
  accountId: string; // Encrypted
  apiKey: string; // Encrypted
  cacheEnabled: boolean;
  cacheDurationHours: number;
  fallbackCost?: string; // Optional fallback cost as string
  useFallback: boolean;
  lastTested?: string; // ISO timestamp
}

/**
 * Cin7 Product Response
 * From GET /product?sku={sku} endpoint
 */
export interface Cin7Product {
  ID: string;
  SKU: string;
  Name: string;
  AverageCost?: number;
  Category?: string;
  Brand?: string;
}

/**
 * COGS Calculation Result
 * Per-order COGS breakdown
 */
export interface CogsCalculation {
  orderId: string;
  orderName: string;
  totalCogs: Decimal;
  lineItems: CogsLineItem[];
  warnings: string[];
}

/**
 * COGS Line Item
 * Per-product COGS detail
 */
export interface CogsLineItem {
  productTitle: string;
  sku: string;
  quantity: number;
  unitCost: Decimal;
  totalCost: Decimal;
}

/**
 * COGS Detail Entry (for CSV export)
 */
export interface CogsDetailEntry {
  orderNumber: string;
  orderDate: string;
  productTitle: string;
  sku: string;
  quantity: number;
  unitCost: string;
  totalCost: string;
  orderTotalCogs: string;
}

/**
 * Cin7 API Error
 */
export class Cin7ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'Cin7ApiError';
  }
}

/**
 * Cin7 Rate Limit Error
 */
export class Cin7RateLimitError extends Error {
  constructor(
    public retryAfterSeconds: number,
    message: string
  ) {
    super(message);
    this.name = 'Cin7RateLimitError';
  }
}
