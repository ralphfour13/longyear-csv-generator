# Journal Entry Discrepancy Analysis
**Date**: 2026-02-23
**Target Date Analyzed**: 2026-01-29

## Summary of Discrepancies

| Category | Expected | Actual | Difference |
|----------|----------|--------|------------|
| Cash (1051.000) | $454.99 | $454.99 | ✅ $0.00 |
| Card (1061.000) | $7,309.89 | $7,107.08 | ❌ -$202.81 |
| Gift Card (2320.000) | $119.65 | $28.39 | ❌ -$91.26 |
| Store Credit (2340.000) | $37.16 | $37.16 | ✅ $0.00 |
| Charge (4005.000) | $191.56 | $191.56 | ✅ $0.00 |
| Tax (2110.000) | -$340.53 | -$324.56 | ❌ -$15.97 |
| Shipping (3040.000) | -$19.50 | -$19.50 | ✅ $0.00 |
| Refunds (3035.000) | $1,557.55 | $1,553.11 | ❌ -$4.44 |

**Total Missing**: 3 orders

## Missing Orders

### Order #81195 - Refund-Only Transaction
- **Total**: $7.33
- **Gateway**: shopify_payments
- **Amount**: -$2.22 (refund)
- **Kind**: refund
- **Issue**: Original sale was on a prior date; only refund occurred on 01/29
- **Impact**: Missing $2.22 refund + missing $0.65 tax adjustment

### Order #81322 - Split Payment (Partial Capture)
- **Total**: $59.52
- **Gateway**: gift_card (visible transaction)
- **Gift Card Amount**: $16.26
- **Missing Amount**: $43.26 (likely card payment on different date)
- **Tax**: $5.02
- **Issue**: Only gift card portion ($16.26) captured on 01/29; card portion likely captured on different date
- **Impact**: Missing $16.26 gift card + $5.02 tax = $21.28 total

### Order #81334 - Split Payment (Partial Capture)
- **Total**: $120.25
- **Gateway**: gift_card (visible transaction)
- **Gift Card Amount**: $75.00
- **Missing Amount**: $45.25 (likely card payment on different date)
- **Tax**: $10.30
- **Issue**: Only gift card portion ($75.00) captured on 01/29; card portion likely captured on different date
- **Impact**: Missing $75.00 gift card + $10.30 tax = $85.30 total

---

## Root Cause Analysis

### Problem 1: Refund-Only Transactions Are Excluded

**Location**: `app/services/order-centric-reconciler.server.ts` lines 85-98

**Code Flow**:
```typescript
const lastCaptureDate = getOrderCaptureDate(order);

if (!lastCaptureDate) {
  // No captures at all, skip this order
  continue; // ← PROBLEM: Skips refund-only orders
}

if (lastCaptureDate !== targetDate) {
  // This order's last capture is on a different date, skip for now
  continue;
}
```

**Problem**:
- The reconciler first checks if the order has any capture/sale transactions
- If there are NO capture transactions (refund-only), it skips the order entirely at line 91
- Refund processing code (lines 144-157) is never reached for refund-only orders
- This causes standalone refunds (where the original sale was on a prior date) to be completely excluded

**Example**:
- Order #81195: Original sale on 01/26, refund on 01/29
- On 01/29, this order has ONLY a refund transaction, NO capture transaction
- Code skips it because `getOrderCaptureDate()` returns `null`
- Result: Refund never appears in journal entries

**Impact**:
- Missing refunds: $2.22
- Missing tax adjustments: $0.65
- Total missing for refund-only: $2.87

---

### Problem 2: Split-Payment Orders with Captures on Different Dates

**Location**: `app/services/order-centric-reconciler.server.ts` lines 85-98 (LAST-CAPTURE-DATE RULE)

**Code Flow**:
```typescript
// LAST-CAPTURE-DATE RULE: Order posts on the date of its LAST captured payment
const lastCaptureDate = getOrderCaptureDate(order);

if (lastCaptureDate !== targetDate) {
  // This order's last capture is on a different date, skip for now
  continue; // ← PROBLEM: Skips orders with partial captures
}

// Get ALL capture transactions for this order (not just today's)
const captureTransactions = order.transactions?.filter(
  (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
) || [];
```

**Problem**:
- The LAST-CAPTURE-DATE RULE states: "Order posts on the date of its LAST captured payment"
- This is designed to ensure split-payment orders post as a complete unit (all legs balance)
- However, if different payment methods are captured on different dates, the order only posts on the LAST capture date
- Any partial captures on earlier dates are completely excluded from those dates' journal entries

**Scenario for Orders #81322 and #81334**:
1. **01/29**: Gift card portion captured ($16.26 for #81322, $75.00 for #81334)
2. **01/30 or later**: Card portion captured ($43.26 for #81322, $45.25 for #81334)
3. **Result on 01/29 export**:
   - `lastCaptureDate = 01/30` (not 01/29)
   - Code skips these orders at line 94-97
   - Gift card transactions on 01/29 never appear in journal entries
4. **Result on 01/30 export**:
   - Order would post with BOTH payment legs (gift card from 01/29 + card from 01/30)
   - All amounts balance correctly
   - BUT: The 01/29 journal entries are incomplete

**Alternative Scenario** (if card capture never happened):
- Gift card captured on 01/29
- Card authorization exists but never captured (failed, cancelled, or pending)
- Order's last capture date is 01/29, so it should post...
- BUT: If Shopify API doesn't return the authorization (only captures), the order appears to have only one payment method
- This might explain why the "visible" payment doesn't equal the order total

**Impact**:
- Missing gift card transactions: $91.26
- Missing card portion: $88.51 (portion captured on different date)
- Missing tax: $15.32
- Total missing for split payments: $195.09

---

## Design Decision Trade-Off

The LAST-CAPTURE-DATE RULE was intentionally implemented to solve a different problem:

**Problem it solves**:
- Split-payment orders where card is captured on 01/29 ($100) and gift card on 01/30 ($50)
- Without LAST-CAPTURE-DATE RULE:
  - 01/29 journal: Only $100 card (incomplete, doesn't balance against sales)
  - 01/30 journal: Only $50 gift card (incomplete, doesn't balance against sales)
  - Neither journal entry balances properly!
- With LAST-CAPTURE-DATE RULE:
  - 01/29 journal: Nothing (order skipped)
  - 01/30 journal: $100 card + $50 gift card = $150 total (complete, balances against sales)
  - Journal entry balances correctly! ✅

**Problem it creates**:
- If partial captures happen BEFORE the last capture, those early captures don't show up on their capture dates
- Accountants expect to see activity on the date it occurred, not delayed until all captures are complete
- This creates timing discrepancies in daily reconciliation

---

## Recommended Solutions

### Solution 1: Create Partial Journal Entries for Split-Payment Orders (Preferred)

**Approach**: Post each payment leg on its capture date, even if incomplete

**Change Location**: `app/services/order-centric-reconciler.server.ts` lines 85-110

**Logic**:
```typescript
// Remove LAST-CAPTURE-DATE RULE check
// Instead: Process ALL captures that occurred on target date

const capturesOnTargetDate = order.transactions?.filter(
  (txn) => {
    if ((txn.kind !== 'capture' && txn.kind !== 'sale') || txn.status !== 'success') {
      return false;
    }
    const txnDate = formatDateOnly(txn.processedAt);
    return txnDate === targetDate;
  }
) || [];

if (capturesOnTargetDate.length === 0) {
  continue; // No captures on target date
}

// Create journal entries for ONLY the payments captured on target date
// DO NOT include sales/tax/shipping (those only post when order is complete)
```

**Journal Entry Pattern** (for split payments):
```
01/29 entries for Order #81322 (gift card captured):
  2320.000 (Gift Card)     +16.26 Dr
  1200.000 (AR - Pending)  -16.26 Cr  ← Track as receivable until complete

01/30 entries for Order #81322 (card captured, order complete):
  1200.000 (AR - Pending)  +16.26 Dr  ← Clear pending AR
  1061.000 (Card)          +43.26 Dr  ← Card payment
  3000.000 (Sales)         -54.50 Cr  ← Revenue recognized when complete
  2110.000 (Tax)            -5.02 Cr  ← Tax recognized when complete
```

**Pros**:
- Every capture appears on its capture date (accurate daily reconciliation)
- Split-payment orders still balance overall (just across multiple days)
- No missing transactions in daily exports

**Cons**:
- More complex accounting (need AR clearing account)
- Revenue recognition delayed until order is complete
- Multiple journal entries per order

---

### Solution 2: Create Standalone Refund Entries (For Order #81195)

**Approach**: Process refund-only transactions independently

**Change Location**: `app/services/order-centric-reconciler.server.ts` lines 82-170

**Logic**:
```typescript
// BEFORE the main order loop, handle refund-only orders
for (const order of orders) {
  // Check if this is a refund-only order (no captures, only refunds)
  const captureTransactions = order.transactions?.filter(
    (txn) => (txn.kind === 'capture' || txn.kind === 'sale') && txn.status === 'success'
  ) || [];

  if (captureTransactions.length === 0) {
    // This is potentially a refund-only order
    const refundTransactions = filterRefundTransactions(order, targetDate);
    if (refundTransactions.length > 0) {
      // Process refund-only transactions
      await processOrderRefunds(
        shop,
        accessToken,
        order,
        refundTransactions,
        targetDate,
        journalEntries,
        enrichedTransactions,
        warnings
      );
      continue; // Skip rest of processing for this order
    }
  }

  // Continue with normal capture processing...
}
```

**Journal Entry Pattern** (for refund-only):
```
01/29 entries for Order #81195 (refund only):
  RF-#81195
    3035.000 (Refunds)          +2.22 Dr
    2110.000 (Tax Liability)    +0.65 Dr  ← Tax reversed
    1061.000 (Card)             -2.87 Cr  ← Refund payment
```

**Pros**:
- Simple to implement
- Handles standalone refunds correctly
- No change to split-payment logic

**Cons**:
- Only solves Problem 1, not Problem 2
- Doesn't address split-payment timing issues

---

### Solution 3: Hybrid Approach (Recommended)

**Combine Solution 1 and Solution 2:**

1. **Handle refund-only orders** with Solution 2 logic
2. **Handle split-payment orders** with Solution 1 logic (partial entries)

**Benefits**:
- Solves both problems
- All transactions appear on their actual dates
- Orders still balance overall (just across multiple days)

**Implementation Priority**:
1. Implement Solution 2 first (refund-only orders) - Quick win, low complexity
2. Implement Solution 1 second (split payments) - Higher complexity, requires new GL account

---

## Testing Requirements

After implementing fixes, test with these scenarios:

1. **Refund-only order** (like #81195)
   - Original sale on prior date
   - Refund on target date
   - Verify refund appears in journal entries

2. **Split-payment order - same day captures**
   - Card captured on 01/29 at 10:00 AM
   - Gift card captured on 01/29 at 2:00 PM
   - Verify both appear in 01/29 journal

3. **Split-payment order - different day captures**
   - Gift card captured on 01/29
   - Card captured on 01/30
   - Verify partial entries on both dates
   - Verify overall balance across both days

4. **Complete order - single payment**
   - Verify existing logic still works correctly

5. **Mixed scenario**
   - Multiple orders with various payment methods
   - Some split, some complete, some refunds
   - Verify all transactions appear on correct dates

---

## Data Integrity Verification

After implementing fixes, verify totals match:

| Account | Expected | Should Match |
|---------|----------|--------------|
| Cash (1051.000) | $454.99 | ✅ Already correct |
| Card (1061.000) | $7,309.89 | After fix: $7,107.08 + $202.81 = $7,309.89 |
| Gift Card (2320.000) | $119.65 | After fix: $28.39 + $91.26 = $119.65 |
| Store Credit (2340.000) | $37.16 | ✅ Already correct |
| Tax (2110.000) | -$340.53 | After fix: -$324.56 - $15.97 = -$340.53 |
| Refunds (3035.000) | $1,557.55 | After fix: $1,553.11 + $4.44 = $1,557.55 |

---

## Files to Modify

1. **app/services/order-centric-reconciler.server.ts**
   - Main reconciliation logic
   - Add refund-only order handling
   - Modify split-payment logic

2. **app/services/order-centric-journal-generator.server.ts** (if using Solution 1)
   - Add partial journal entry generation
   - Add AR clearing account logic

3. **app/types/journal-entry.ts** (if using Solution 1)
   - Add AR clearing account mapping

4. **app/services/storage.server.ts** (if using Solution 1)
   - Add default AR clearing account

---

**Next Steps**: Review recommendations and decide on implementation approach.
