import { Decimal } from 'decimal.js';
import type { CogsCalculation } from './cin7';

/**
 * Sage 50 Journal Entry
 * Represents a single line in a journal entry (either debit or credit)
 */
export interface JournalEntry {
  date: string; // Format: MM/DD/YYYY
  reference: string; // e.g., "SO-1001", "PO-456", "RF-1001"
  account: string; // Account code from mappings (e.g., "4000-00")
  accountName?: string; // Account name for reference
  debit: Decimal; // Debit amount
  credit: Decimal; // Credit amount
  memo: string; // Description/memo line
}

/**
 * Account Mapping Configuration
 * Maps business logic to Sage 50 account codes
 */
export interface AccountMapping {
  accountCode: string; // e.g., "4000-00"
  accountName: string; // e.g., "Sales Revenue"
  description?: string; // Optional description
}

/**
 * Account Mappings Collection
 */
export interface AccountMappings {
  sales_revenue: AccountMapping;
  sales_tax: AccountMapping;
  shipping_revenue: AccountMapping;
  discounts: AccountMapping;
  accounts_receivable: AccountMapping;
  cash_account: AccountMapping;
  clearing_account: AccountMapping;
  payment_processing_fees: AccountMapping;
  shopify_fees: AccountMapping;
  refunds_given: AccountMapping;
  cogs: AccountMapping;
  inventory: AccountMapping;
  // Payment method specific accounts
  gift_card_liability: AccountMapping; // 2320-00 - Gift Card Liability
  store_credit_liability: AccountMapping; // 2340-00 - Store Credit Liability
  cash_register: AccountMapping; // 1061-00 - Cash Register
  cogs_inventory_writeoff: AccountMapping; // 1310-00 - COGS - Inventory Write-off (for Charge gateway)
  undeposited_funds: AccountMapping; // 1051-00 - Undeposited Funds (for checks)
  [key: string]: AccountMapping; // Allow dynamic account types
}

/**
 * Sync Configuration
 * Stored in config.json per shop
 */
export interface SyncConfig {
  shop: string; // Shop domain (e.g., "example-shop.myshopify.com")
  syncEnabled: boolean;
  syncSchedule: 'nightly' | 'manual';
  scheduledTime: string; // 24-hour format: "02:00"
  autoExportDate: 'yesterday' | 'today' | 'last_7_days' | 'custom';
  transactionTypes: {
    orders: boolean;
    refunds: boolean;
    payments: boolean;
    inventory: boolean;
  };
  csvFormat: 'standard' | 'extended';
  lastExportDate?: string; // ISO date string (optional tracking)
  emailEnabled?: boolean; // Enable email notifications for scheduled exports
  emailRecipients?: string; // Comma-separated email addresses
  // Files to generate during export (default true if not set)
  generateDailySales?: boolean;
  generatePayoutsOrders?: boolean;
  generateJournalDetails?: boolean;
  generateJournalSummary?: boolean;
  generateCogsDetails?: boolean;
  generateReconciliation?: boolean;
}

/**
 * Shopify Payout
 * What actually hit the bank account (anchor point)
 */
export interface Payout {
  id: string; // Shopify payout ID
  status: string; // "paid", "pending", "failed"
  date: string; // ISO date string
  amount: Decimal; // Total payout amount (what hit bank)
  currency: string; // e.g., "USD"
  balanceTransactions?: BalanceTransaction[]; // Detailed breakdown
}

/**
 * Shopify Balance Transaction
 * Detailed breakdown of what's in each payout
 */
export interface BalanceTransaction {
  id: string;
  type: 'charge' | 'refund' | 'adjustment' | 'reserve' | 'payout';
  sourceOrderId?: string; // Order ID if applicable
  sourceType?: string; // "Order", "Refund", etc.
  net: Decimal; // Net amount after fees
  fee: Decimal; // Total fees
  gross: Decimal; // Gross amount before fees
  currency: string;
  processedAt: string; // ISO timestamp
  order?: Order; // Populated order details
  feeBreakdown?: FeeBreakdown; // Detailed fee components
}

/**
 * Fee Breakdown
 * Detailed components of transaction fees
 */
export interface FeeBreakdown {
  shopifyFee: Decimal;
  gatewayFee: Decimal;
  chargebackFee?: Decimal;
  otherFees?: Decimal;
  total: Decimal;
}

/**
 * Shopify Order (simplified)
 */
export interface Order {
  id: string; // Order ID
  orderNumber: number; // Display order number
  name: string; // e.g., "#1001"
  createdAt: string; // ISO timestamp
  totalPrice: Decimal; // Total including tax and shipping
  subtotalPrice: Decimal; // Subtotal before tax/shipping
  currentSubtotalPrice?: Decimal; // Current subtotal (after edits/removals)
  currentTotalDiscounts?: Decimal; // Current discounts (after edits)
  currentTotalPrice?: Decimal; // Current total (after edits)
  currentTotalTax?: Decimal; // Current tax (after edits/removals)
  totalTax: Decimal; // Total tax amount
  totalShipping: Decimal; // Shipping charges
  totalDiscounts: Decimal; // Discount amount
  currency: string;
  financialStatus: string; // "paid", "pending", "refunded", etc.
  closedAt?: string; // ISO timestamp when order was closed (fully paid + fulfilled)
  fulfilledAt?: string; // ISO timestamp of last fulfillment (actual ship date)
  sourceName?: string; // "pos", "web", "shopify_draft_order", etc.
  lineItems: OrderLineItem[];
  transactions?: Transaction[]; // Payment transactions
  refunds?: Refund[]; // Refund details (for proper tax splitting)
}

/**
 * Order Line Item
 */
export interface OrderLineItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  sku?: string; // Product SKU (for COGS lookup)
  quantity: number;
  price: Decimal;
  totalDiscount: Decimal;
  taxable: boolean;
  taxes: Array<{
    title: string;
    rate: number;
    price: Decimal;
  }>;
}

/**
 * Payment Transaction
 */
export interface Transaction {
  id: string;
  orderId: string;
  kind: 'sale' | 'refund' | 'capture' | 'authorization' | 'void';
  gateway: string; // "shopify_payments", "paypal", etc.
  status: string; // "success", "pending", "failure"
  amount: Decimal;
  currency: string;
  processedAt: string; // ISO timestamp
  fees: TransactionFee[];
}

/**
 * Transaction Fee Details
 */
export interface TransactionFee {
  type: 'shopify_fee' | 'gateway_fee' | 'chargeback_fee';
  amount: Decimal;
  currency: string;
}

/**
 * Order Adjustment
 * Represents adjustments made during refunds (e.g., refund discrepancies)
 */
export interface OrderAdjustment {
  id: string;
  kind: 'refund_discrepancy' | 'shipping_refund' | 'other';
  amount: string; // String amount (may be negative)
  reason?: string;
  tax_amount?: string;
}

/**
 * Refund
 * Contains refund transactions and line items for proper tax splitting
 */
export interface Refund {
  id: string;
  orderId: string;
  createdAt: string;
  processedAt: string;
  transactions: Transaction[]; // Refund transactions
  refund_line_items: RefundLineItem[]; // Line items being refunded
  order_adjustments?: OrderAdjustment[]; // Adjustments like refund discrepancies
  note?: string; // Refund note/reason
}

/**
 * Refund Line Item
 * Detailed breakdown of what was refunded (enables proper tax splitting)
 */
export interface RefundLineItem {
  id: string;
  line_item_id: string;
  quantity: number;
  restock_type: 'no_restock' | 'cancel' | 'return' | 'legacy_restock'; // Indicates if canceled vs refunded
  subtotal: Decimal; // Subtotal amount refunded (pre-tax)
  total_tax: Decimal; // Tax amount refunded
  line_item: {
    id: string;
    title: string;
    sku?: string;
  };
}

/**
 * Export History Entry
 */
export interface ExportHistoryEntry {
  id: string; // Unique ID
  date: string; // Export date (ISO)
  filename: string; // CSV filename (DEPRECATED: use files array)
  files: GeneratedFile[]; // NEW: Array of generated files
  entryCount: number; // Number of journal entries
  totalDebit: Decimal; // Total debit amount
  totalCredit: Decimal; // Total credit amount
  balanced: boolean; // Whether debits = credits
  createdAt: string; // ISO timestamp
  downloadUrl: string; // URL to download CSV (DEPRECATED: use files array)
}

/**
 * Generated File
 * Metadata for a single generated file in multi-file export
 */
export interface GeneratedFile {
  type: 'daily-sales' | 'payouts-orders' | 'journal-entries-details' | 'journal-entry-summary' | 'daily-reconciliation' | 'error-report' | 'cogs-details' | 'order-json' | 'error-orders-json';
  filename: string;
  downloadUrl: string;
  rowCount: number;
  error?: string; // If generation failed
}

/**
 * CSV Export Request
 */
export interface ExportRequest {
  shop: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
  transactionTypes: string[]; // ["orders", "refunds", "payments"]
}

/**
 * Reconciliation Result
 * Result of payout-first reconciliation
 */
export interface ReconciliationResult {
  payout: Payout;
  journalEntries: JournalEntry[];
  enrichedTransactions: EnrichedTransaction[]; // NEW: For multi-file export
  totalDebit: Decimal;
  totalCredit: Decimal;
  balanced: boolean; // true if totalDebit === totalCredit === payout.amount
  errors: string[];
  warnings: string[];
}

/**
 * Enriched Transaction
 * Combines balance transaction, order, and enriched data for multi-file exports
 */
export interface EnrichedTransaction {
  // From balance transaction
  balanceTransaction: {
    id: string;
    type: string;
    sourceOrderId?: string;
    processedAt: string; // Capture date
    net: Decimal;
    fee: Decimal;
    gross: Decimal;
  };

  // From order (if applicable)
  order?: {
    id: string;
    name: string;
    createdAt: string;
    totalPrice: Decimal; // Total including tax and shipping
    subtotalPrice: Decimal; // Subtotal before tax/shipping
    currentTotalPrice: Decimal;
    currentSubtotalPrice?: Decimal; // Current subtotal (after edits)
    currentTotalTax?: Decimal; // Current tax (after edits/removals)
    totalTax: Decimal;
    totalShipping: Decimal;
    totalDiscounts: Decimal;
    financialStatus: string;
    lineItems: OrderLineItem[]; // Needed for Daily Reconciliation Report notes
    hasActualRefunds?: boolean; // True if order has actual refunds (not just cancellations)
    isMultiCaptureSplit?: boolean; // True if this order's captures are split across multiple dates
  };

  // Enriched data for Daily Sales Report
  enrichedData?: {
    tags: string;
    taxLines: Array<{ title: string; rate: string; price: Decimal }>;
    shippingAddress: { address1: string; address2: string; zip: string; city: string; provinceCode?: string; province?: string; countryCode?: string };
    transactions: Array<{
      kind: string;
      processedAt: string;
      amount: Decimal;
      gateway: string;
      paymentMethod?: string;
    }>;
    paymentBreakdown: {
      cash: Decimal;
      charge: Decimal;
      giftCard: Decimal;
      storeCredit: Decimal;
      check: Decimal;
      card: Decimal;
    };
    fulfillmentStatus: string;
    financialStatus: string;
    totalRefunded: Decimal;
    sourceName?: string;
  };

  // JE-derived summary: authoritative sales/tax/shipping from the journal entry lines.
  // Used by DR and DSR generators to ensure all export files match the JE exactly.
  jeSummary?: {
    netSales: Decimal;      // Net sales (3000 account, credit - debit)
    tax: Decimal;           // Tax (2110 account, credit - debit)
    shipping: Decimal;      // Shipping (3040 account, credit - debit)
    giftCardLiability: Decimal; // Gift card liability (2320 account, credit - debit)
    storeCredit: Decimal;   // Store credit (2340 account)
    totalPayment: Decimal;  // Total payment (sum of debit accounts: 1051 + 1061 + 2320 + 2340)
  };

  // Payout context
  payout: {
    id: string;
    date: string;
    amount: Decimal;
  };
}

/**
 * Validation Error
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Export Job Status
 */
export interface ExportJob {
  id: string;
  shop: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startDate: string;
  endDate: string;
  progress: number; // 0-100
  createdAt: string;
  completedAt?: string;
  error?: string;
  resultFilename?: string;
}

/**
 * Order-Centric Reconciliation Result
 * Extended with COGS warnings
 */
export interface OrderCentricReconciliationResult {
  journalEntries: JournalEntry[];
  enrichedTransactions: EnrichedTransaction[];
  orders: Order[]; // Fetched orders from Shopify (to avoid duplicate fetching)
  processedOrderIds: Set<string>; // Orders that actually generated journal entries
  balanced: boolean;
  errors: string[];
  warnings: string[];
  cogsWarnings?: string[]; // COGS-specific warnings
  cogsDataMap?: Map<string, CogsCalculation>; // Pre-calculated COGS data (shared with COGS detail CSV)
  orderCount: number;
  captureCount: number;
}
