import type { Decimal } from 'decimal.js';

/**
 * Request parameters for generating a sales tax report
 */
export interface SalesTaxReportRequest {
  periodType: 'month' | 'quarter';
  year: number;
  month?: number; // 1-12, required when periodType is 'month'
  quarter?: number; // 1-4, required when periodType is 'quarter'
}

/**
 * Row in the sales tax report CSV
 */
export interface SalesTaxReportRow {
  orderNumber: string;
  orderDate: string;
  captureDate: string;
  source: string; // "POS" or "Online"
  shipToCity: string;
  shipToState: string;
  grossSales: string;
  discountAmount: string;
  shippingCharged: string;
  taxableAmount: string;
  nonTaxableAmount: string;
  exemptReason: string;
  tax1Title: string;
  tax1Rate: string;
  tax1Amount: string;
  tax2Title: string;
  tax2Rate: string;
  tax2Amount: string;
  tax3Title: string;
  tax3Rate: string;
  tax3Amount: string;
  tax4Title: string;
  tax4Rate: string;
  tax4Amount: string;
  tax5Title: string;
  tax5Rate: string;
  tax5Amount: string;
  totalTaxCollected: string;
  refundAmount: string;
  refundTaxAmount: string;
}

/**
 * Shop address for POS orders (from Shopify shop settings)
 */
export interface ShopAddress {
  city: string;
  province: string;
  provinceCode: string;
}

/**
 * Processed order data for tax report generation
 * Built from EnrichedTransaction data collected day-by-day
 */
export interface SalesTaxOrderSummary {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  captureDate: string;
  sourceName: string;
  tags: string;
  shipToCity: string;
  shipToState: string;
  grossSales: Decimal;
  discountAmount: Decimal;
  shippingCharged: Decimal;
  taxableAmount: Decimal;
  nonTaxableAmount: Decimal;
  exemptReason: string;
  taxLines: Array<{ title: string; rate: string; price: Decimal }>;
  totalTaxCollected: Decimal;
  refundAmount: Decimal;
  refundTaxAmount: Decimal;
}
