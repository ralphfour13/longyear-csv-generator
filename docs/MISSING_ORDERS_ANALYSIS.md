# Missing Orders Analysis - Jan 8, 2026

## Summary

Three orders (#80211, #80223, #80224) are missing from the `detailed-sales-report_2026-01-08.csv` but ARE present in Christina's reference file and should be included in the Jan 8 export.

## Missing Orders

| Order | Capture Date | Capture Time | Amount | Status |
|-------|--------------|--------------|---------|---------|
| #80211 | 2026-01-08 | 13:23:53 | $31.28 | ✓ Captured Jan 8 |
| #80223 | 2026-01-08 | 13:01:33 | $34.69 | ✓ Captured Jan 8 |
| #80224 | 2026-01-08 | 13:14:24 | $46.10 | ✓ Captured Jan 8 |
| **Total Missing** | | | **$112.07** | |

## What Makes These Orders Special

All three orders have a unique pattern:
- **Items removed BEFORE capture** (partial order cancellation)
- **Restock refunds with NO refund transactions**
- **totalPrice ≠ currentTotalPrice**

### Order #80211 Example

```json
{
  "name": "#80211",
  "created_at": "2026-01-06",
  "total_price": "95.91",          // Original order total (3 items)
  "current_total_price": "31.28",  // After items removed (1 item)
  "refunds": [
    {
      "created_at": "2026-01-08T13:23:34",
      "processed_at": "2026-01-08T13:23:34",
      "transactions": [],  // ← NO REFUND TRANSACTION!
      "refund_line_items": [
        // 2 items removed before capture
      ]
    }
  ],
  "transactions": [
    {
      "kind": "authorization",
      "processed_at": "2026-01-06T16:09:43",
      "amount": "95.91"  // Full amount authorized
    },
    {
      "kind": "capture",
      "processed_at": "2026-01-08T13:23:53",  // Only captured reduced amount
      "amount": "31.28"  // After items removed
    }
  ]
}
```

**What Happened:**
1. Jan 6: Customer ordered 3 items ($95.91 total), payment authorized
2. Jan 8: Staff removed 2 items before fulfillment (restock refund, no payment transaction)
3. Jan 8: Captured payment for remaining item ($31.28)

## Current Export Behavior

**What We Fetch:** ✅
- Orders ARE in `order-data_2026-01-08.json` (670 orders total)
- Transactions ARE populated correctly

**What We Include:** ❌
- Orders NOT in `detailed-sales-report_2026-01-08.csv` (53 orders only)
- Orders ARE in `error-report_2026-01-08.csv` with warnings:
  - Payment Mismatch: Total != Payment
  - Sales Mismatch: Report != Journal
  - Tax Mismatch: Order != Journal

**Root Cause:** Orders with pre-capture item removals trigger validation warnings and may be excluded from reports.

## Expected Behavior (Christina's File)

Christina's file INCLUDES these orders:
- #80211: $31.28 captured on Jan 8 ✓
- #80223: $34.69 captured on Jan 8 ✓
- #80224: $46.10 captured on Jan 8 ✓

**Her file shows:**
- Captured amount matches `currentTotalPrice` (not `totalPrice`)
- Orders treated as normal Jan 8 captures
- No special handling for pre-capture item removal

## Code Analysis

### getOrderCaptureDate() Logic

Located in: `app/services/order-centric-fetcher.server.ts:587`

```typescript
// Get the EARLIEST capture date for split payments
const earliestCapture = captureTransactions.reduce((earliest, txn) => {
  const txnDate = new Date(txn.processedAt);
  const earliestDate = new Date(earliest.processedAt);
  return txnDate < earliestDate ? txn : earliest;
});

const captureDate = formatDateOnly(earliestCapture.processedAt);
return captureDate; // Should return "2026-01-08" for all three orders
```

**Test Result:**
```
Order: #80211
Earliest capture date: 2026-01-08
Should be included in 2026-01-08 export: true ✓
```

### Where Orders Get Filtered Out

The missing orders:
1. ✅ Pass date filtering (capture date === "2026-01-08")
2. ✅ Have valid transactions populated
3. ❌ Generate validation warnings (payment/sales/tax mismatches)
4. ❌ NOT added to `enrichedTransactions` array
5. ❌ NOT included in detailed-sales-report

**Hypothesis:** Orders may be excluded in `processOrderCaptures()` or validation logic due to mismatch between `totalPrice` and `currentTotalPrice`.

## Impact Analysis

### Financial Impact
- **Missing Revenue:** $112.07 not in detailed-sales-report
- **Orders Affected:** 3 out of 53 (5.6%)
- **Pattern:** Pre-capture item removals (likely common in retail)

### Comparison with Christina
- **Christina's Count:** 54 unique orders
- **Our Count:** 53 orders (missing 3, but may include 2 she doesn't have)
- **Net Difference:** -1 order, -$112.07

## Recommendations

### Option 1: Fix the Export Logic (Recommended)

Modify the export to handle pre-capture item removals correctly:

1. **Use `currentTotalPrice`** instead of `totalPrice` when available
2. **Capture validation** should expect `currentTotalPrice === sum(capture amounts)`
3. **Include orders** with pre-capture refunds in detailed-sales-report

**Pros:**
- ✅ Matches Christina's expected behavior
- ✅ Correctly handles common retail scenario (item removal before capture)
- ✅ Includes all captured revenue in reports

**Cons:**
- ❌ Requires code changes to validation logic
- ❌ May need to update tests

### Option 2: Document as Known Limitation

Add documentation that orders with pre-capture item removals may not appear in detailed-sales-report.

**Pros:**
- ✅ No code changes required

**Cons:**
- ❌ Missing orders in reports (incorrect accounting)
- ❌ Doesn't match Christina's expectations
- ❌ Validation warnings persist

## Next Steps

1. **Confirm with Christina:** Are these 3 orders expected in the Jan 8 export?
2. **Determine correct behavior:** Should we use `totalPrice` or `currentTotalPrice`?
3. **Fix validation logic:** Update payment/sales/tax mismatch detection
4. **Re-test export:** Verify missing orders now appear in detailed-sales-report
5. **Validate parallelization:** Once logic is correct, test parallel COGS fetching

## Files to Modify (if fixing)

1. **`app/services/payment-method-analyzer.server.ts`**
   - Update `validatePaymentTotal()` to use `currentTotalPrice`

2. **`app/services/order-centric-journal-generator.server.ts`**
   - Use `currentTotalPrice` for journal entry amounts

3. **`app/services/consistency-checker.server.ts`**
   - Update validation to handle pre-capture refunds

4. **`app/services/order-centric-reconciler.server.ts`**
   - Ensure orders with pre-capture refunds are processed

## Test Cases

After fix, verify:
- [ ] Order #80211 appears in detailed-sales-report with $31.28
- [ ] Order #80223 appears in detailed-sales-report with $34.69
- [ ] Order #80224 appears in detailed-sales-report with $46.10
- [ ] No validation warnings for these orders
- [ ] Total matches Christina's $5,625.71

## Related Issues

- **Payment Mismatch warnings** for orders with pre-capture item removals
- **Sales/Tax Mismatch warnings** due to `totalPrice` vs `currentTotalPrice`
- **Detailed-sales-report** missing valid captured orders
