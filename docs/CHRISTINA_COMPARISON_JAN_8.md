# Christina's Reference Data Comparison - January 8, 2026

## Overview

Comparing our export for 2026-01-08 with Christina's reference file:
- **Christina's File:** `/Users/gregflint/Downloads/ChristinaFiles/new jan totals (1)-1-8.csv`
- **Our Export:** `export-2026-01-08-9irgf.zip`

## Key Findings

### Order Count Discrepancy

| Metric | Christina's File | Our Export | Difference |
|--------|-----------------|------------|------------|
| **Total Orders** | 124 | 54 | -70 orders |
| **Total Amount** | $5,625.71 | $5,487.33 | -$138.38 |
| **Order Range** | #80165 - #80320 | #80165 - #80320 | Same |

### Why the Difference?

**Our Implementation:** Uses the **Last-Capture-Date Rule**
- Orders post on the date of their **LAST captured payment**
- Ensures split-payment orders post as a complete unit
- Only orders with `lastCaptureDate === targetDate` are included

**Christina's Data:** Appears to use **ANY capture activity**
- Includes orders with ANY capture on the target date
- May include orders whose last capture is on a different date
- May include partial transactions for split-payment orders

### Example Analysis

**Order #80304** (in Christina's file, not in our export):
```
sale:   2026-01-08 14:30:36  $1.03   (capture)
refund: 2026-01-08 14:31:18  -$1.03  (refund)
```

This order had both a sale and refund on Jan 8, but net zero impact. Our export may exclude it or handle it differently based on the last-capture-date logic.

## File Format Differences

### Christina's Format
```
Name,Tags,Tax 1: Title,Tax 1: Rate,Tax 1: Price,...
#80165,Packing Slips Printed,California State Tax,0.06,3.10,...
```

- Tax rates shown as decimals (0.06 for 6%)
- Multiple tax columns (up to 3)
- Column header format: "Tax 1: Title", "Tax 1: Rate", etc.

### Our Export Format
```
Name,Tags,Tax 1 Title,Tax 1 Rate,Tax 1 Price,...
#80165,Packing Slips Printed,California State Tax,6.00%,3.10,...
```

- Tax rates shown as percentages (6.00%)
- Multiple tax columns (up to 5)
- Column header format: "Tax 1 Title", "Tax 1 Rate", etc. (no colons)

## Validation Strategy

### Option 1: Compare Only Matching Orders

Extract orders that appear in both files and compare:

```bash
# Get order numbers from both files
cut -d',' -f1 /tmp/detailed-sales-report_2026-01-08.csv | tail -n +2 | sort > /tmp/our_orders.txt
cut -d',' -f1 "/Users/gregflint/Downloads/ChristinaFiles/new jan totals (1)-1-8.csv" | tail -n +2 | sort | uniq > /tmp/christina_orders.txt

# Find common orders
comm -12 /tmp/our_orders.txt /tmp/christina_orders.txt > /tmp/common_orders.txt

# Count common orders
wc -l /tmp/common_orders.txt
```

### Option 2: Investigate Missing Orders

Find orders in Christina's file but not in ours:

```bash
comm -13 /tmp/our_orders.txt /tmp/christina_orders.txt > /tmp/missing_orders.txt
```

For each missing order, check:
1. What was the capture date?
2. Was this a split-payment order?
3. What was the LAST capture date?

### Option 3: Verify Last-Capture-Date Logic

For orders in both files, verify:
1. Capture timestamps match
2. Transaction amounts match
3. Tax calculations match
4. Total amounts match

## Questions for Christina

1. **Date Filtering Rule:** Does Christina's file include ALL orders with ANY capture on Jan 8, or only orders with their LAST capture on Jan 8?

2. **Split-Payment Orders:** How does Christina handle orders with multiple payment legs across different dates?

3. **Refund Handling:** Order #80304 shows same-day sale and refund. Should this be included in the daily export?

4. **Expected Order Count:** Is 124 orders the expected count for Jan 8? Or should it be 54?

5. **Total Amount:** Is $5,625.71 the expected total, or $5,487.33?

## Implementation Differences

### Our Last-Capture-Date Rule (Current)

**Advantages:**
- ✅ Split-payment orders post as complete units (all legs balance)
- ✅ Consistent with order-centric accounting (post when order is "complete")
- ✅ Avoids partial journal entries for incomplete orders
- ✅ Clear reconciliation with Sage 50 (one entry per order)

**Disadvantages:**
- ❌ May exclude orders with early payment legs on target date
- ❌ Different order count than Christina's report
- ❌ May not match Shopify's "orders captured today" report

### Any-Capture-Activity Rule (Christina's approach?)

**Advantages:**
- ✅ Matches Shopify's daily capture report
- ✅ Includes all payment activity for the day
- ✅ Higher order count (more visibility)

**Disadvantages:**
- ❌ Split-payment orders may appear on multiple days
- ❌ Journal entries may not balance within a single day
- ❌ Complex to reconcile with Sage 50 (partial entries)

## Recommendation

**Before proceeding with parallelization validation:**

1. **Clarify business requirements:** Which date filtering rule is correct?
   - Last-capture-date (our current implementation)
   - Any-capture-activity (Christina's apparent approach)

2. **Validate reference data:** Confirm Christina's file is the "source of truth"
   - Is her 124 order count correct?
   - Is $5,625.71 the expected total?

3. **Reconcile discrepancies:** Understand why 70 orders are different
   - Are they split-payment orders?
   - Are they refund-only transactions?
   - Are they orders with captures on multiple dates?

4. **Align implementations:** Once business rule is clear, verify our implementation matches

## Technical Notes

### Current Implementation (order-centric-reconciler.server.ts)

```typescript
// LAST-CAPTURE-DATE RULE (lines 175-188)
const lastCaptureDate = getOrderCaptureDate(order);

if (lastCaptureDate !== targetDate) {
  // This order's last capture is on a different date, skip for now
  // It will be processed when we run reconciliation for that date
  continue;
}
```

### Alternative Implementation (Any-Capture-Activity)

```typescript
// ANY-CAPTURE-ACTIVITY RULE (potential change)
const capturesOnDate = order.transactions?.filter(
  txn => (txn.kind === 'capture' || txn.kind === 'sale') &&
         txn.status === 'success' &&
         formatDateOnly(txn.processedAt) === targetDate
);

if (capturesOnDate.length > 0) {
  // Include this order (has at least one capture on target date)
  processOrder(order, capturesOnDate);
}
```

## Impact on Parallelization

**The parallelization optimization is independent of this date filtering logic.**

- ✅ Parallel COGS fetching works with either filtering approach
- ✅ Performance improvement (~40-50 seconds) applies to both
- ✅ No changes needed to parallelization code

However, we should validate against the **correct business rule** before deploying.

## Next Steps

1. **Ask user for clarification:** Which date filtering rule is correct?
2. **Investigate missing orders:** Analyze the 70 orders in Christina's file but not ours
3. **Compare matching orders:** Verify amounts match for the 54 orders in both files
4. **Document decision:** Update CLAUDE.md with confirmed business rule
5. **Proceed with validation:** Once business rule is confirmed, validate parallelization

## File Paths for Reference

```bash
# Christina's reference files
/Users/gregflint/Downloads/ChristinaFiles/new\ jan\ totals\ (1)-1-*.csv

# Our export
/Users/gregflint/Downloads/export-2026-01-08-9irgf.zip

# Extracted files
/tmp/detailed-sales-report_2026-01-08.csv
/tmp/journal-entry_2026-01-08.csv
/tmp/cogs-details_2026-01-08.csv
```
