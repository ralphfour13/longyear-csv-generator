# Christina File Reconciliation - January 8, 2026

## Summary

Comparing our export with Christina's reference file reveals discrepancies that adding the 3 missing orders does NOT fully resolve.

## Order Count Comparison

| Metric | Christina | Our Export | Difference |
|--------|-----------|------------|------------|
| **Unique Orders** | 54 | 51 | -3 orders |
| **Total Rows** | 124 | 54 | -70 rows* |

*Christina's file has multiple rows per order (transactions + summary rows)

## Financial Comparison

### Total Transaction Amounts

| Category | Christina | Our Export | Difference |
|----------|-----------|------------|------------|
| **Captures/Sales** | $5,638.37 | $5,475.70 | **-$162.67** |
| **Refunds** | -$12.66 | $11.63 | $24.29* |
| **Net Total** | **$5,625.71** | **$5,487.33** | **-$138.38** |

*We show refunds as positive, Christina shows as negative

## Missing Orders Analysis

### 3 Orders in Christina but Not in Ours

| Order | Capture Date | Amount | Issue |
|-------|--------------|---------|-------|
| #80211 | 2026-01-08 13:23:53 | $31.28 | Pre-capture item removal |
| #80223 | 2026-01-08 13:01:33 | $34.69 | Pre-capture item removal |
| #80224 | 2026-01-08 13:14:24 | $46.10 | Pre-capture item removal |
| **Total** | | **$112.07** | |

**Pattern:** All three orders had items removed before capture, resulting in:
- `totalPrice` ≠ `currentTotalPrice`
- Restock refunds with no refund transactions
- Payment/Sales/Tax mismatch warnings

## If We Add the 3 Missing Orders

### Projected Totals

| Category | Current | + Missing | Christina | Remaining Gap |
|----------|---------|-----------|-----------|---------------|
| **Captures** | $5,475.70 | **$5,587.77** | $5,638.37 | **-$50.60** |
| **Net Total** | $5,487.33 | **$5,599.40** | $5,625.71 | **-$26.31** |

### Analysis

**Progress:** Adding the 3 missing orders resolves **80.9%** of the discrepancy ($112.07 of $138.38)

**Remaining Issues:**
- **$50.60 gap in captures** - Unexplained difference even after adding missing orders
- **$26.31 net gap** - Final difference after accounting for refunds

## Potential Causes of Remaining $50.60 Gap

### Hypothesis 1: Additional Missing Orders
- Perhaps there are more orders with pre-capture item removals we haven't identified
- Orders that fail validation for different reasons

### Hypothesis 2: Amount Differences
- Some orders may have different captured amounts in Christina's file
- Partial captures, adjustments, or corrections

### Hypothesis 3: Different Date Filtering
- Christina may include orders with captures on multiple dates
- Different interpretation of "earliest capture date" rule

### Hypothesis 4: Refund Handling
- Christina shows refunds with negative amounts: -$12.66
- We show refunds with positive amounts: $11.63
- Absolute difference: $1.03 (matches order #80304 full refund)

## Order #80304 Special Case

**Same-day Sale and Full Refund:**
```
Sale:   2026-01-08 14:30:36  $1.03
Refund: 2026-01-08 14:31:18  $1.03  (42 seconds later)
Net:    $0.00
```

**Christina's handling:**
- Shows both transactions
- Refund as negative: -$1.03
- Net impact: $0.00

**Our handling:**
- Shows both transactions
- Refund as positive: $1.03
- Appears in detailed-sales-report (2 rows)

## Detailed Breakdown by Type

### Captures Only

If we only look at capture/sale transactions (excluding refunds):

| Source | Amount | Orders | Avg per Order |
|--------|--------|--------|---------------|
| Christina captures | $5,638.37 | 54 | $104.41 |
| Our captures | $5,475.70 | 51 | $107.37 |
| Gap | **-$162.67** | -3 | |
| Missing 3 orders | $112.07 | 3 | $37.36 |
| After adding missing | $5,587.77 | 54 | $103.48 |
| **Remaining gap** | **-$50.60** | 0 | |

### Key Insight

Even after adding the 3 missing orders:
- We'd have the same number of orders (54)
- **Still $50.60 short on captures**
- Suggests amount differences, not just missing orders

## Next Steps to Resolve

### 1. Verify Order Amounts

Check if any orders have different captured amounts:
```bash
# Compare specific order amounts
for order in $(comm -12 our_orders.txt christina_orders.txt); do
  our_amt=$(grep "^${order}," our_export.csv | grep ",capture," | awk -F',' '{print $36}')
  chr_amt=$(grep "^${order}," christina.csv | grep ",capture," | awk -F',' '{print $29}')
  if [ "$our_amt" != "$chr_amt" ]; then
    echo "$order: Ours=$our_amt, Christina=$chr_amt"
  fi
done
```

### 2. Check for Additional Missing Orders

Search for orders with:
- Pre-capture item removals
- Payment mismatches
- Validation warnings

### 3. Verify Refund Handling

Ensure refunds are handled consistently:
- Should refunds be included in daily totals?
- Should they be shown as positive or negative?
- Net vs gross reporting

### 4. Review Date Filtering Logic

Confirm the "earliest capture date" rule matches Christina's expectations:
- Should it be first capture or last capture?
- How to handle multi-day split payments?

## Recommendations

### Immediate Action

1. **Fix the 3 missing orders** (#80211, #80223, #80224)
   - Update validation logic to use `currentTotalPrice`
   - Handle pre-capture item removals correctly
   - This resolves $112.07 of $138.38 gap (81%)

2. **Investigate the $50.60 gap**
   - Compare order-by-order amounts with Christina
   - Identify any additional discrepancies
   - Document findings

### Long-term Solution

1. **Clarify business rules with Christina:**
   - Which orders should be included in daily exports?
   - How to handle pre-capture item removals?
   - Gross vs net reporting for refunds?

2. **Update validation logic:**
   - Use `currentTotalPrice` for orders with item removals
   - Handle same-day refunds correctly
   - Align with Christina's expectations

3. **Automate reconciliation:**
   - Create comparison script
   - Flag discrepancies automatically
   - Generate reconciliation reports

## Files for Reference

- **Christina's file:** `/Users/gregflint/Downloads/ChristinaFiles/new jan totals (1)-1-8.csv`
- **Our export:** `/tmp/detailed-sales-report_2026-01-08.csv`
- **Missing orders:** #80211, #80223, #80224
- **Special case:** #80304 (same-day full refund)

## Status

- ✅ Identified 3 missing orders ($112.07)
- ✅ Identified root cause (pre-capture item removals)
- ⚠️ Unexplained $50.60 gap remains
- ⚠️ Refund handling may differ
- ❌ Not fully balanced with Christina's file
