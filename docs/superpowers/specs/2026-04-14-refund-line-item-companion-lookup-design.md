# Fix: Refund Line Item Companion Lookup

## Problem

When Shopify creates a cancel-then-refund sequence, it produces two separate refund objects:

1. **Cancel-type refund**: Has `refund_line_items` (product/tax breakdown) but no `transactions` (no money moved)
2. **Actual refund**: Has a payment `transaction` (money returned to customer) but no `refund_line_items`

The current code matches the refund transaction to refund #2 (correct), but since #2 has no line items, falls back to a proportional calculation using `order.totalPrice` as denominator. When the order has uncaptured CC authorizations, `totalPrice` is inflated, producing wrong sales/tax splits that don't balance.

**Example (Order #80598):**
- Order total: $54.40 (includes $9.47 uncaptured CC auth)
- GC refund: $16.26
- Current: $16.26 / $54.40 = 0.299 → sales $13.12 + tax $1.20 = $14.32 (imbalance $1.94)
- Correct: sales $14.90 + tax $1.36 = $16.26 (from cancel refund's line items)

## Solution

When a refund has transactions but no `refund_line_items`, search `order.refunds` for a **companion refund** — one that has `refund_line_items` but no transactions, and whose line item totals (subtotal + tax) match the refund transaction amount within $0.02.

Use the companion's line items for the sales/tax breakdown.

## File Changed

`app/services/order-centric-journal-generator.server.ts`

## Change Location

Inside `createRefundJournalEntries()`, at the point where the code checks `if (refund?.refund_line_items && refund.refund_line_items.length > 0)` (currently ~line 827). Before falling through to the proportional fallback, insert a companion lookup.

## Logic

```
if refund has no refund_line_items (or empty):
  search order.refunds for a companion where:
    - companion.transactions is empty (cancel-type)
    - companion.refund_line_items is non-empty
    - sum(companion.refund_line_items.subtotal + total_tax) matches totalRefundAmount within $0.02
  if found:
    use companion.refund_line_items for refundedSubtotal and refundedTax
  else:
    fall through to existing proportional fallback (unchanged)
```

## Scope

- Single function change in one file
- No new files, no API changes, no data model changes
- Existing proportional fallback remains as the safety net
- The cancel-type refund itself is already handled correctly (filtered out by `isCancellation` check at line ~667 since it has no transactions)

## Verification

Run the Jan 16 export for the client's store and confirm:
- Order #80598 RF entries: sales $14.90, tax $1.36 (matching Kari's spreadsheet)
- No error report generated for Jan 16
- All other dates' JE files unchanged
