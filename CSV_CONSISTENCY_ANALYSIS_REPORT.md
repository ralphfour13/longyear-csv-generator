# CSV Consistency Analysis Report

**Analysis Date**: March 1, 2026
**Period Analyzed**: January 6-10, 2026 (5 days)
**Total Orders**: 223

---

## Executive Summary

### Overall Results

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Orders** | 223 | 100% |
| **Orders with Errors** | 42 | 18.8% |
| **Orders with Warnings** | 25 | 11.2% |
| **Clean Orders** | 156 | 70.0% |

### Daily Breakdown

| Date | Orders | Errors | Warnings | Clean |
|------|--------|--------|----------|-------|
| 2026-01-06 | 36 | 8 (22.2%) | 2 (5.6%) | 26 (72.2%) |
| 2026-01-07 | 41 | 6 (14.6%) | 4 (9.8%) | 31 (75.6%) |
| 2026-01-08 | 53 | 15 (28.3%) | 7 (13.2%) | 31 (58.5%) |
| 2026-01-09 | 62 | 10 (16.1%) | 8 (12.9%) | 44 (71.0%) |
| 2026-01-10 | 31 | 3 (9.7%) | 4 (12.9%) | 24 (77.4%) |

**Observation**: January 8th had the highest error rate (28.3%), while January 10th had the lowest (9.7%).

---

## Error Categories

### 1. COGS Mismatches (Most Common)

**Total Occurrences**: 27 orders across 5 days

**Description**: The COGS detail file shows a different total cost than what's recorded in the journal entry.

**Examples**:
- Order #80216 (Jan 6): COGS Details=$16.77 vs Journal=$17.83 (diff=$1.06)
- Order #80212 (Jan 6): COGS Details=$98.90 vs Journal=$95.05 (diff=$3.85)
- Order #80355 (Jan 9): COGS Details=$33.46 vs Journal=$168.45 (diff=$134.99) ⚠️ LARGE

**Possible Causes**:
1. Inventory cost changes between COGS calculation and journal generation
2. Fulfillment timing issues (partial fulfillments)
3. COGS calculation logic discrepancies
4. Missing or incorrect SKU cost data in Cin7

**Impact**: Medium - COGS/Inventory entries are imbalanced

---

### 2. Sales Amount Mismatches

**Total Occurrences**: 18 orders across 5 days

**Description**: The sales amount in the detailed sales report doesn't match the journal entry credit.

**Examples**:
- Order #80217 (Jan 6): Report=$-18.00 vs Journal=$248.42 (diff=$266.42) ⚠️ CRITICAL
- Order #80196 (Jan 6): Report=$527.60 vs Journal=$627.55 (diff=$99.95) ⚠️ LARGE
- Order #80284 (Jan 8): Report=$869.58 vs Journal=$1053.55 (diff=$183.97) ⚠️ LARGE
- Order #80355 (Jan 9): Report=$231.15 vs Journal=$264.52 (diff=$33.37)

**Possible Causes**:
1. **Refund timing issues** - Refunds processed between report and journal generation
2. **Order edits** - Order amount changed after initial capture
3. **Split payment misallocation** - Multiple payment methods calculated differently
4. **Discount handling** - Discounts applied differently in report vs journal

**Impact**: HIGH - Revenue recognition is incorrect

---

### 3. Payment Amount Mismatches

**Total Occurrences**: 11 orders across 5 days

**Description**: The payment total doesn't match the journal entry debit.

**Examples**:
- Order #80217 (Jan 6): Report=$0.00 vs Journal=$266.42 (diff=$266.42) ⚠️ CRITICAL
- Order #80228 (Jan 7): Report=$86.85 vs Journal=$236.99 (diff=$150.14) ⚠️ LARGE
- Order #80388 (Jan 10): Report=$17.15 vs Journal=$43.96 (diff=$26.81)

**Possible Causes**:
1. **Partial refunds** - Payment credited back but not reflected in sales report
2. **Gift card redemptions** - Multiple payment methods not summing correctly
3. **Timing differences** - Payment captured vs processed timestamps

**Impact**: HIGH - Cash/AR balances are incorrect

---

### 4. Journal Entry Imbalances

**Total Occurrences**: 11 orders across 5 days

**Description**: The journal entry debits don't equal credits (fundamental accounting error).

**Examples**:
- Order #80050 (Jan 6): Debits=$45.62 vs Credits=$52.28 (diff=$6.66)
- Order #80230 (Jan 7): Debits=$389.92 vs Credits=$408.92 (diff=$19.00)
- Order #80355 (Jan 9): Debits=$434.88 vs Credits=$452.15 (diff=$17.27)
- Order #80388 (Jan 10): Debits=$64.46 vs Credits=$91.27 (diff=$26.81) ⚠️ CRITICAL

**Possible Causes**:
1. **Missing entries** - One side of the entry is incomplete
2. **Calculation errors** - Rounding or arithmetic errors in entry generation
3. **Refund processing** - Refund entries not properly reversing original entries

**Impact**: CRITICAL - Journal entries cannot be imported into Sage 50 if imbalanced

---

### 5. Tax Amount Mismatches

**Total Occurrences**: 3 orders across 5 days

**Description**: Tax amount in sales report differs from journal entry.

**Examples**:
- Order #80301 (Jan 8): Report=$5.63 vs Journal=$6.57 (diff=$0.94)
- Order #80355 (Jan 9): Report=$18.01 vs Journal=$19.18 (diff=$1.17)
- Order #80388 (Jan 10): Report=$2.97 vs Journal=$4.78 (diff=$1.81)

**Possible Causes**:
1. Tax recalculation after order edits
2. Partial refunds affecting tax proportionally
3. Tax exemption status changes

**Impact**: Medium - Tax liability reporting may be incorrect

---

## Warnings (Non-Critical Issues)

### Missing COGS Data

**Total Occurrences**: 25 orders across 5 days

**Description**: Orders have sales amounts but no COGS details.

**Expected for**:
- Fishing licenses (#80190, #80178, #80262, etc.)
- Gift cards (when sold, not redeemed)
- Services or non-inventory items
- Digital products

**Action Required**: Verify these are genuinely non-inventory items. If physical products, investigate missing COGS data in Cin7.

---

## Critical Issues Requiring Immediate Attention

### Priority 1: Journal Entry Imbalances

**Orders**: #80050, #80230, #80304, #80301, #80296, #80224, #80223, #80211, #80201, #80355, #80388

These orders **cannot be imported into Sage 50** until the imbalance is resolved.

**Recommended Action**:
1. Re-generate journal entries for these specific orders
2. Investigate root cause (likely related to refunds or split payments)
3. Fix calculation logic before next export

---

### Priority 2: Large Amount Discrepancies

**Orders with >$50 difference**:
- #80217 (Jan 6): $266.42 difference ⚠️ INVESTIGATE
- #80196 (Jan 6): $99.95 difference
- #80228 (Jan 7): $150.14 difference
- #80298 (Jan 8): $24.65 difference
- #80284 (Jan 8): $183.97 difference
- #80355 (Jan 9): $134.99 COGS difference + $17.27 payment difference
- #80258 (Jan 9): $75.00 difference
- #80388 (Jan 10): $51.81 sales + $26.81 payment + $12.50 COGS

**Recommended Action**:
1. Manual review of each order in Shopify admin
2. Check for partial refunds, order edits, or cancellations
3. Determine if this is a data sync issue or calculation error

---

## Root Cause Analysis

### Pattern 1: Refund-Related Issues

Many errors involve orders with refunds or partial refunds:
- #80217: Negative sales amount suggests refund confusion
- #80228, #80388: Payment mismatches with refund history
- #80230: Large sales discrepancy with journal imbalance

**Hypothesis**: Refund journal entries may not be correctly reversing original entries, or refund amounts are not being proportionally allocated.

**Verification Needed**:
- Check if `RF-` entries exist for these orders
- Verify refund calculation uses proportional allocation (as per recent fix)
- Ensure refund timing doesn't cause double-counting

---

### Pattern 2: COGS Calculation Inconsistencies

27 orders have COGS mismatches, with differences ranging from $0.13 to $134.99.

**Hypothesis**:
1. **Fulfillment-based filtering** - COGS calculated only for fulfilled items, but journal entry includes all items
2. **Cost changes** - Product costs changed in Cin7 between COGS calculation and journal generation
3. **Missing SKU mappings** - Some products don't have Cin7 cost data

**Verification Needed**:
- Compare COGS details line counts vs actual line items in orders
- Check if partially fulfilled orders have accurate COGS allocation
- Verify Cin7 SKU mappings are complete

---

### Pattern 3: Split Payment Complexity

Orders with multiple payment methods (gift cards, credit cards, cash) show higher error rates.

**Orders with split payments**:
- #80408: Gift card + payment
- #80406: Gift card payment
- #80377: Gift card payment

**Hypothesis**: Gift card liability entries may be creating duplicate debits or incorrect allocations.

**Verification Needed**:
- Review payment breakdown logic for gift card transactions
- Ensure gift card redemptions are properly tracked vs gift card sales

---

## Recommendations

### Immediate Actions (This Week)

1. **Fix Journal Entry Imbalances** (Priority 1)
   - Investigate orders #80050, #80230, #80304, #80301, #80296, #80224, #80223, #80211, #80201, #80355, #80388
   - Identify root cause (likely refund or split payment logic)
   - Implement fix and re-export these dates

2. **Review Large Discrepancies** (Priority 2)
   - Manually review orders with >$50 differences in Shopify admin
   - Document actual order state vs exported state
   - Determine if data sync or calculation issue

3. **Validate Refund Logic** (Priority 2)
   - Review recent proportional refund fix (PR #17)
   - Test with orders #80217, #80228, #80388 that have refund-related issues
   - Ensure `RF-` entries correctly reverse `SO-` entries

---

### Short-Term Improvements (Next Sprint)

1. **COGS Validation Enhancement**
   - Add pre-export validation to detect COGS mismatches
   - Log warnings for orders where COGS details != journal COGS
   - Investigate fulfillment-based filtering impact

2. **Payment Breakdown Verification**
   - Add detailed payment method breakdown to daily reconciliation CSV
   - Include gift card transactions separately
   - Validate split payment allocation logic

3. **Automated Consistency Checks**
   - Integrate this analysis script into export process
   - Flag orders with errors before CSV generation completes
   - Generate error report alongside exports

---

### Long-Term Enhancements (Future)

1. **Real-Time Validation**
   - Validate journal entry balance immediately after generation
   - Prevent export of imbalanced entries
   - Alert operator to issues before CSV download

2. **Reconciliation Dashboard**
   - Build UI showing daily consistency metrics
   - Highlight orders requiring manual review
   - Track error trends over time

3. **Order State Tracking**
   - Store snapshot of order state at export time
   - Compare subsequent exports to detect changes
   - Identify orders that need re-export due to refunds/edits

---

## Data Quality Score

### By Date

| Date | Quality Score | Grade |
|------|---------------|-------|
| 2026-01-06 | 72.2% clean | C+ |
| 2026-01-07 | 75.6% clean | B- |
| 2026-01-08 | 58.5% clean | D+ |
| 2026-01-09 | 71.0% clean | C+ |
| 2026-01-10 | 77.4% clean | B |

**Average Quality Score**: 70.0% (C+)

**Target Quality Score**: >95% (A)

---

## Conclusion

The CSV exports show **concerning consistency issues** across 18.8% of orders (42 out of 223). While 70% of orders are clean, the presence of:

1. **11 imbalanced journal entries** (cannot be imported)
2. **18 sales amount mismatches** (revenue recognition errors)
3. **27 COGS mismatches** (inventory/COGS accuracy)

...indicates systemic issues that need to be addressed before these exports can be reliably imported into Sage 50.

### Key Findings

✅ **Good**: 70% of orders export correctly
⚠️ **Concern**: COGS calculation inconsistencies (27 orders)
❌ **Critical**: Journal entry imbalances (11 orders) - **blocks Sage 50 import**
❌ **Critical**: Large sales/payment discrepancies (8+ orders with >$50 diff)

### Next Steps

1. **Immediate**: Fix the 11 imbalanced journal entries
2. **This week**: Investigate large discrepancies (>$50)
3. **Next sprint**: Implement automated validation and COGS verification
4. **Long-term**: Build reconciliation dashboard and real-time validation

---

**Report Generated**: March 1, 2026
**Analyst**: Claude Sonnet 4.5
**Files Analyzed**: 15 CSV files (5 days × 3 file types)
