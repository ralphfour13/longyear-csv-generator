# Parallel COGS Fetching - Validation Plan

## Overview

This document outlines the validation strategy for the parallel COGS fetching optimization implemented in `app/services/order-centric-reconciler.server.ts`.

## Implementation Summary

**Change:** Run Cin7 COGS fetching in parallel with Shopify transaction fetching using `Promise.all()`.

**Expected Improvement:** ~40-50 seconds per export (eliminates sequential COGS wait time).

**Affected Function:** `reconcileOrdersByDate()` in `order-centric-reconciler.server.ts`

## Reference Export

**File:** `/Users/gregflint/Downloads/export-2026-01-08-9irgf.zip`
**Date:** January 8, 2026
**Orders Processed:** 670
**COGS Line Items:** 217
**Journal Entry Lines:** 239
**Errors/Warnings:** 1661

## Validation Strategy

### Phase 1: Correctness Verification

Run a new export for the same date (2026-01-08) and compare outputs:

#### 1. Journal Entry Comparison
```bash
# Extract both exports
unzip -q export-2026-01-08-9irgf.zip -d /tmp/reference
unzip -q export-2026-01-08-NEW.zip -d /tmp/new

# Compare journal entries (should be identical)
diff /tmp/reference/journal-entry_2026-01-08.csv /tmp/new/journal-entry_2026-01-08.csv

# Compare detailed journal entries
diff /tmp/reference/journal-entry-details_2026-01-08.csv /tmp/new/journal-entry-details_2026-01-08.csv
```

**Expected Result:** No differences (files should be identical)

#### 2. COGS Data Comparison
```bash
# Compare COGS details
diff /tmp/reference/cogs-details_2026-01-08.csv /tmp/new/cogs-details_2026-01-08.csv
```

**Expected Result:** No differences (COGS calculations should be identical)

#### 3. Order Data Comparison
```bash
# Compare order counts
jq -r 'length' /tmp/reference/order-data_2026-01-08.json
jq -r 'length' /tmp/new/order-data_2026-01-08.json

# Compare first 5 orders (should be identical)
jq -r '.[0:5]' /tmp/reference/order-data_2026-01-08.json > /tmp/ref_orders.json
jq -r '.[0:5]' /tmp/new/order-data_2026-01-08.json > /tmp/new_orders.json
diff /tmp/ref_orders.json /tmp/new_orders.json
```

**Expected Result:** Same order count, same order data

### Phase 2: Performance Verification

Analyze console logs from the new export:

#### 1. Look for Parallel Execution Logs
```
[Reconcile] Starting parallel operations: transactions + COGS...
[Reconcile] Track A: Fetching transactions for 670 orders...
[Reconcile] Track B: Fetching COGS data from Cin7...
```

#### 2. Check Timing Information
```
[Reconcile] Track B completed: COGS data collected for X orders
[Export] Transaction fetch progress: 670/670 orders (670 success, 0 failed)
[Reconcile] ✓ Both operations completed in X.X seconds
```

#### 3. Calculate Time Savings
**Reference Timing (Sequential):**
- Bulk operations: ~30 seconds
- Transaction fetching: ~5-8 minutes (670 orders × 555ms delay)
- COGS fetching: ~40-50 seconds
- Total: ~7-9 minutes

**New Timing (Parallel):**
- Bulk operations: ~30 seconds
- Parallel execution: ~5-8 minutes (same as longest track)
- Total: ~6-7.5 minutes

**Expected Savings:** 40-50 seconds

### Phase 3: Error Handling Verification

#### 1. Test COGS Failure Scenario
Temporarily disable Cin7 credentials and verify:
- Export completes successfully
- No COGS data in output
- Warning logged but no error thrown

#### 2. Test Transaction Failure Scenario
Verify existing error handling still works:
- Failed transactions logged with order details
- Orders with failed transactions still processed (with empty transactions array)
- Error report includes transaction failures

#### 3. Test Partial COGS Failure
Verify graceful degradation:
- Orders with missing COGS data have $0 cost
- COGS calculation errors logged per order
- Export continues despite individual COGS failures

### Phase 4: Consistency Checks

#### 1. Balance Verification
```bash
# Check journal entry balance from error report
grep "Journal Imbalance" /tmp/new/error-report_2026-01-08.csv

# Should show same imbalances as reference (or fewer if we fixed anything)
grep "Journal Imbalance" /tmp/reference/error-report_2026-01-08.csv
```

**Expected Result:** Same or fewer balance issues

#### 2. COGS Consistency
```bash
# Count COGS line items
wc -l /tmp/reference/cogs-details_2026-01-08.csv
wc -l /tmp/new/cogs-details_2026-01-08.csv
```

**Expected Result:** Same line count (217 lines)

#### 3. Sales Report Consistency
```bash
# Compare detailed sales reports
diff /tmp/reference/detailed-sales-report_2026-01-08.csv /tmp/new/detailed-sales-report_2026-01-08.csv
```

**Expected Result:** No differences

## Validation Checklist

- [ ] **Correctness**
  - [ ] Journal entries match reference export (byte-for-byte)
  - [ ] COGS details match reference export
  - [ ] Order data matches reference export (same count, same content)
  - [ ] All CSV files have same line counts

- [ ] **Performance**
  - [ ] Console logs show parallel execution (Track A/B labels)
  - [ ] Total export time reduced by 40-50 seconds
  - [ ] COGS completes before transactions finish
  - [ ] No increase in errors or warnings

- [ ] **Error Handling**
  - [ ] Export succeeds when Cin7 disabled (no COGS data)
  - [ ] Transaction failures handled gracefully
  - [ ] Partial COGS failures don't block export
  - [ ] Error report includes all expected failures

- [ ] **Consistency**
  - [ ] Journal entries balance (Debits = Credits)
  - [ ] COGS calculations match Cin7 costs
  - [ ] Sales reports consistent across files
  - [ ] No new errors introduced

## Success Criteria

The optimization is considered successful if:

1. ✅ **Output Identical:** All export files match reference (except bulk JSONL timestamps)
2. ✅ **Time Saved:** Export completes 40-50 seconds faster
3. ✅ **Logs Clear:** Console logs show parallel execution with timing
4. ✅ **No Regressions:** No new errors or warnings introduced
5. ✅ **Error Handling:** Graceful degradation when COGS fails

## Rollback Plan

If validation fails:

1. Revert commit: `git revert 609ec1e`
2. Test original sequential flow
3. Investigate discrepancies
4. Fix issues and re-test

## Notes

- **COGS Data Note:** The batch processor calls `collectCogsData()` again after reconciliation to filter by processed orders. This means COGS is currently fetched twice when Cin7 is enabled. Future optimization: return COGS data from `reconcileOrdersByDate()` to avoid duplicate work.

- **REST API Fallback:** When bulk operations fail and REST API is used, transactions are already included in orders, so parallel execution is skipped. This maintains backward compatibility.

- **Timing Variability:** Actual time savings may vary based on:
  - Number of orders (670 in reference)
  - Number of unique SKUs (affects Cin7 batch fetch time)
  - Network latency to Shopify/Cin7 APIs
  - Shopify rate limit throttling

## Test Command

```bash
# Run export for validation date
npm run export -- --shop your-shop.myshopify.com --date 2026-01-08

# Or via web UI
# Navigate to http://localhost:3000/export
# Select date: 2026-01-08
# Click "Export"
```

## Expected Console Output

```
[Export] Attempting bulk operations for 2026-01-08...
[Export] ✓ Bulk operations completed successfully
[Reconcile] Starting parallel operations: transactions + COGS...
[Reconcile] Track A: Fetching transactions for 670 orders...
[Reconcile] Track B: Fetching COGS data from Cin7...
[Export] Transaction fetch progress: 50/670 orders (50 success, 0 failed)
[Export] Transaction fetch progress: 100/670 orders (100 success, 0 failed)
... (more progress logs)
[Reconcile] Track B completed: COGS data collected for 670 orders
[Export] Transaction fetch progress: 650/670 orders (650 success, 0 failed)
[Export] ✓ Transaction fetch complete: 670 success, 0 failed out of 670 total
[Reconcile] ✓ Both operations completed in 420.5 seconds
```

## Comparison Commands

Use the `analyze-export` script for automated comparison:

```bash
npm run analyze-export -- \
  --reference /Users/gregflint/Downloads/export-2026-01-08-9irgf.zip \
  --export /path/to/new-export.zip \
  --date 2026-01-08
```

This will automatically compare all key files and report any differences.
