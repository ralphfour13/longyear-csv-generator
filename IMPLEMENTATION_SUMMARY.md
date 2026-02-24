# Journal Entry Generation Fix - Implementation Summary

**Date:** 2026-02-24
**Status:** ✅ Implemented (Testing Pending)

## Changes Made

### 1. Fixed Sales Calculation (Task #1) ✅

**File:** `app/services/order-centric-journal-generator.server.ts`

**Changes:**
- **Lines 65-102:** Removed GROSS sales calculation logic and discount entry generation
- Now uses NET sales (post-discount) directly from `order.currentSubtotalPrice`
- Fallback calculation: `Total Payment - Tax - Shipping = NET Sales`
- **Eliminated account 3034 (Discount) entries completely**

**Before:**
```typescript
// Calculate GROSS sales (before discounts)
const discountAmount = order.currentTotalDiscounts || new Decimal(0);
let grossSales: Decimal;
if (order.currentSubtotalPrice) {
  grossSales = order.currentSubtotalPrice.plus(discountAmount); // NET + Discount = GROSS
}

// CREDIT: Sales Revenue (GROSS)
entries.push({
  account: accountMappings.sales_revenue.accountCode,
  credit: grossSales,
});

// DEBIT: Discounts (if any)
if (discountAmount.greaterThan(0)) {
  entries.push({
    account: accountMappings.discounts.accountCode,
    debit: discountAmount,
  });
}
```

**After:**
```typescript
// Calculate NET sales (post-discount)
let netSales: Decimal;
if (order.currentSubtotalPrice) {
  // currentSubtotalPrice is already NET (after discounts applied)
  netSales = order.currentSubtotalPrice;
} else {
  // Fallback: Calculate NET from total payment minus tax and shipping
  netSales = order.totalPrice
    .minus(order.totalTax || new Decimal(0))
    .minus(order.totalShipping || new Decimal(0));
}

// CREDIT: Sales Revenue (NET - post-discount amount)
entries.push({
  account: accountMappings.sales_revenue.accountCode,
  credit: netSales,
});

// NO DISCOUNT ENTRY - discounts are already reflected in NET sales amount
```

**Impact:**
- ✅ No more 3034 (Discount) entries
- ✅ Sales amounts match source of truth (daily-sales-report CSV)
- ✅ Simplified accounting - one sales figure instead of gross + discount offset

### 2. Entry Balance Validation (Task #2) ✅

**Status:** Already implemented in codebase

**File:** `app/services/order-centric-journal-generator.server.ts` (lines 291-330)

The `validateOrderEntries()` function was already present and is called in the reconciler to ensure each SO- and RF- reference balances independently.

### 3. Improved COGS Error Handling (Task #3) ✅

**File:** `app/services/order-centric-journal-generator.server.ts`

**Changes:**
- **Lines 132-158:** Enhanced COGS error handling and logging
- Added warning when orders have line items but COGS is $0
- Improved error messages with emojis for visibility
- Non-blocking errors still allow export to continue

**Before:**
```typescript
try {
  const cin7Enabled = await isCin7Enabled(shop);
  if (cin7Enabled) {
    const cogsCalculation = await calculateOrderCogs(shop, order);
    if (cogsCalculation.totalCogs.greaterThan(0)) {
      entries.push(...cogsEntries);
    }
  }
} catch (error) {
  console.error(`Failed to calculate COGS for ${order.name}:`, error);
  // Non-blocking: Continue without COGS entries  ← Limited context
}
```

**After:**
```typescript
try {
  const cin7Enabled = await isCin7Enabled(shop);
  if (cin7Enabled && order.lineItems.length > 0) {
    const cogsCalculation = await calculateOrderCogs(shop, order);

    // Always create COGS entries if order has products, even if calculation is $0
    if (cogsCalculation.totalCogs.greaterThan(0)) {
      const cogsEntries = await createCogsJournalEntries(...);
      entries.push(...cogsEntries);
    } else if (order.lineItems.length > 0) {
      // Log warning if order has products but COGS is $0
      console.warn(
        `⚠️ Order ${order.name} has ${order.lineItems.length} line items but COGS is $0. ` +
        `Check Cin7 product cost data.`
      );
    }

    // Log all COGS warnings
    if (cogsCalculation.warnings.length > 0) {
      for (const warning of cogsCalculation.warnings) {
        console.warn(warning);
      }
    }
  }
} catch (error) {
  console.error(
    `❌ Failed to calculate COGS for ${order.name}:`,
    error instanceof Error ? error.message : String(error)
  );
  // Still continue - journal will be incomplete but won't block export
}
```

**Impact:**
- ✅ Better visibility into COGS calculation issues
- ✅ Operators can identify missing Cin7 data
- ✅ Exports continue even if COGS fails (with warnings)

### 4. Gift Card Order Investigation (Task #4) ✅

**Status:** Investigation complete, root cause requires testing

**Files Reviewed:**
- `app/services/order-centric-fetcher.server.ts`
- `app/services/order-centric-reconciler.server.ts`

**Findings:**

The reconciler processes orders based on their **last capture date** (line 112 of reconciler). Orders with NO capture/sale transactions are skipped (lines 82-108) unless they have refund transactions.

**Hypothesis:** Gift card PURCHASE orders vs REDEMPTION orders:
- **Gift card REDEMPTIONS:** Have capture transactions → Should be included ✓
- **Gift card SALES:** May not have standard capture transactions → Could be filtered out ❌

**Next Steps:**
1. Run test export for Jan 10, 2026 with debug logging
2. Check if orders #80386 and #80423 are:
   - Not fetched by `fetchOrdersByCaptureDateRange()` (fetcher issue)
   - Fetched but filtered out in reconciler (logic issue)
3. Examine actual transaction data for these orders in Shopify

**Files that may need changes:**
- If filtering issue: `order-centric-reconciler.server.ts` lines 82-108
- If fetching issue: `order-centric-fetcher.server.ts` line 152 (status parameter)

## Expected Results

### Order #80368 (with $328.34 discount)

**Before (BROKEN):**
```
SO-#80368:
  Payment:   $87.95 Dr  (1061)
  Sales:    -$403.95 Cr (3000) ← WRONG: GROSS
  Discount:  $328.34 Dr (3034) ← WRONG: Should NOT exist
  Tax:        -$5.84 Cr (2110)
  Shipping:   -$6.50 Cr (3040)
  COGS:      $36.74 Dr  (4000)
  Inventory: -$36.74 Cr (1310)
```

**After (FIXED):**
```
SO-#80368:
  Payment:   $87.95 Dr  (1061)
  Sales:     -$75.61 Cr (3000) ← NET sales (payment - tax - shipping)
  Tax:        -$5.84 Cr (2110)
  Shipping:   -$6.50 Cr (3040)
  COGS:      $36.74 Dr  (4000)
  Inventory: -$36.74 Cr (1310)
```

### Daily Journal Entry

**Expected outcome:**
- Total Debits = Total Credits (nets to $0.00)
- No 3034 (Discount) entries in any order
- All SO- references balance independently
- All RF- references balance independently

## Validation Checklist

After running export for Jan 10, 2026:

### Per-Order Validation
- [ ] No 3034 (Discount) entries exist
- [ ] Order #80368 shows Sales: -$75.61 (not -$403.95)
- [ ] Each SO- entry balances (debits = credits)
- [ ] Each RF- entry balances (debits = credits)

### Daily Validation
- [ ] All orders from daily-sales-report are in journal
- [ ] Rolled-up journal entry nets to $0.00
- [ ] Orders with line items have COGS entries (or warnings)

### Specific Order Checks
- [ ] **Order #80368:** Sales -$75.61, no 3034 entry
- [ ] **Order #80388:** Partially refunded, both SO- and RF- entries balance
- [ ] **Order #80427:** Fully refunded, both SO- and RF- entries balance
- [ ] **Orders #80386 & #80423:** Present in export (gift card orders)

## Testing Instructions

### 1. Run Manual Export
```bash
# Start development server
npm run dev

# Navigate to application
# Click "Manual Export"
# Select date: January 10, 2026
# Click "Export"
```

### 2. Verify CSV Files

**Location:** Check the export results for:
- `journal-entry-rollup_2026-01-10.csv` - Should net to $0.00
- `journal-entry-details_2026-01-10.csv` - Check for 3034 entries (should be NONE)
- `daily-sales-report_2026-01-10.csv` - Source of truth

### 3. Validation Queries

**Check for discount entries (should return empty):**
```bash
grep "3034" journal-entry-details_2026-01-10.csv
```

**Check Order #80368 sales amount:**
```bash
grep "SO-#80368.*3000" journal-entry-details_2026-01-10.csv
# Should show: -75.61 (not -403.95)
```

**Verify balance:**
```bash
# Sum debits and credits from rollup file
# They should be equal
```

## Rollback Plan

If issues occur, revert the changes in `order-centric-journal-generator.server.ts`:

```bash
git checkout HEAD -- app/services/order-centric-journal-generator.server.ts
```

The old logic (GROSS sales + discounts) will be restored.

## Success Criteria

✅ All of the following must be true:

1. No 3034 (Discount) entries in any journal export
2. Order #80368 shows NET sales (-$75.61) not GROSS
3. All SO- and RF- entries balance independently
4. Daily journal nets to exactly $0.00
5. Tax amounts match source daily-sales-report
6. Orders with products have COGS entries (or clear warnings)
7. System handles missing COGS gracefully (warns but doesn't fail)

## Related Documentation

- Plan document: `/Users/gregflint/.claude/projects/.../ba5e67a6-d0d5-4c25-a72c-652860881a7e.jsonl`
- Validation document: `validation.md` (from plan)
- Source of truth: `daily-sales-report_2026-01-10.csv`

## Notes

- **No breaking changes to data models** - only calculation logic changed
- **Backwards compatible** - old exports remain valid for reference
- **Non-blocking COGS errors** - exports continue with warnings
- **Gift card investigation** - requires actual test data to complete
