# Refund COGS Reversal Fix

## Problem Summary

Order #80158 had a journal entry imbalance of $3.25 because refund processing was not reversing COGS (Cost of Goods Sold) and inventory entries when items were returned to inventory.

### Issue Details

**Order #80158 Timeline:**
1. **Original Sale** (Jan 5, 13:44:41): $125.18
   - Payment received: $125.18 (Credit Card)
   - COGS recorded: $38.24
   - Inventory reduced: $38.24

2. **Refund** (Jan 5, 14:28:56): $3.25 (Chenille item returned)
   - Payment refunded: $3.25
   - Sales reversed: $3.25
   - **MISSING**: COGS reversal ($2.03)
   - **MISSING**: Inventory restoration ($2.03)

### Root Cause

The `createRefundJournalEntries()` function in `/app/services/order-centric-journal-generator.server.ts` explicitly skipped COGS reversal for ALL refunds (lines 426-429):

```typescript
// NOTE: COGS entries are NOT reversed for refunds
// When items are refunded, the COGS remains recognized (expense already incurred)
// Inventory doesn't necessarily return (could be damaged, restocking fee, etc.)
// Only the revenue side (sales and payment) is reversed
```

While this logic is valid for damaged/non-restocked items, it created imbalances when items were actually returned to inventory (`restock_type: 'return'`).

## Solution Implemented

### Changes Made

1. **Added new imports** (lines 1-9):
   - `createCogsRefundEntries` from `cogs-journal-generator.server`
   - `Cin7ProductService` for cost lookups
   - `extractSkuFromLineItem` for SKU extraction
   - `CogsCalculation` type

2. **Added `calculateRefundCogs()` helper function** (lines 547-651):
   - Calculates COGS only for items with `restock_type === 'return'`
   - Looks up unit costs from Cin7 for each returned item
   - Returns a `CogsCalculation` object with total COGS for returned items

3. **Modified `createRefundJournalEntries()` to include COGS reversal** (lines 429-463):
   - Checks if Cin7 is enabled
   - Calls `calculateRefundCogs()` to get COGS for returned items
   - Uses `createCogsRefundEntries()` to generate reversal journal entries
   - Only creates entries if `totalCogs > 0`

### Journal Entry Structure (After Fix)

**For a refund with returned items:**
```
RF-#80158: Refund - Order #80158
  1061.000 (Credit Card)     -$3.25 Cr  [Payment refund]
  1310.000 (Inventory)       +$2.03 Dr  [Inventory restore] ← NEW

SO-#80158: Reversals
  3000.000 (Sales)           +$3.25 Dr  [Sales reversal]
  4000.000 (COGS)            -$2.03 Cr  [COGS reversal] ← NEW

Total: Debits = $5.28, Credits = $5.28 ✓ Balanced
```

### Restock Type Handling

The fix respects Shopify's `restock_type` field:

| Restock Type | COGS Reversed? | Reason |
|-------------|----------------|---------|
| `return` | ✅ YES | Item returned to inventory, COGS should be reversed |
| `no_restock` | ❌ NO | Item not returned (damaged, defective, etc.) |
| `cancel` | ❌ NO | Order cancelled, may not have been shipped |
| `legacy_restock` | ❌ NO | Legacy type, conservative approach |

## Testing Recommendations

### Test Case 1: Refund with Return
- Order with 1 item @ $10 (COGS: $5)
- Refund with `restock_type: 'return'`
- **Expected**: 4 entries (payment, sales, inventory, COGS)
- **Validation**: Debits = Credits

### Test Case 2: Refund without Return
- Order with 1 item @ $10 (COGS: $5)
- Refund with `restock_type: 'no_restock'`
- **Expected**: 2 entries (payment, sales only)
- **Validation**: Debits = Credits

### Test Case 3: Partial Refund
- Order with 3 items (COGS: $15 total)
- Refund 1 item with `restock_type: 'return'` (COGS: $5)
- **Expected**: COGS reversal for 1 item only ($5)

### Test Case 4: Multiple Refunds
- Order with 3 items (COGS: $15 total)
- Refund 1: 1 item returned (COGS: $5)
- Refund 2: 1 item not returned (COGS: $5)
- **Expected**: COGS reversal for first refund only

## Files Modified

1. `/app/services/order-centric-journal-generator.server.ts`
   - Added imports (lines 1-9)
   - Added `calculateRefundCogs()` function (lines 547-651)
   - Modified `createRefundJournalEntries()` to call COGS reversal logic (lines 429-463)

## Impact

### Orders Affected
This fix will affect all future refunds where:
- Items are returned to inventory (`restock_type === 'return'`)
- Cin7 integration is enabled
- COGS data is available in Cin7

### Historical Data
Orders processed before this fix (like #80158) will remain unchanged in the database. To correct historical imbalances, you would need to:
1. Re-process affected orders with the new logic
2. Manually adjust journal entries in Sage 50
3. Create correcting entries for the missing COGS reversals

## Deployment

1. ✅ Code changes implemented
2. ✅ TypeScript type checking passed
3. ⏳ Testing in development environment
4. ⏳ Deploy to production
5. ⏳ Monitor first few refunds with returns

## Related Documentation

- [COGS Calculator](/app/services/cogs/cogs-calculator.server.ts)
- [COGS Journal Generator](/app/services/cogs/cogs-journal-generator.server.ts)
- [Cin7 Integration](/app/services/cin7/)

---

**Date Implemented**: March 3, 2026
**Issue Reference**: Order #80158 - $3.25 Journal Imbalance
**Implemented By**: Claude Code Assistant
