# Missing Order #80284 - Root Cause Analysis

## Order Details

- **Order Name**: #80284
- **Order ID**: 6776909922534
- **Created At**: 2026-01-08T10:36:42-08:00
- **Financial Status**: `partially_refunded`
- **Fulfillment Status**: `fulfilled`

## Transaction Timeline

### Original Sale (January 8, 2026)
- **Kind**: `sale`
- **Status**: `success`
- **Amount**: $1,129.92
- **Processed At**: `2026-01-08T10:36:40-08:00` ✅ **ON TARGET DATE**
- **Gateway**: `shopify_payments`

### Refund (January 12, 2026)
- **Kind**: `refund`
- **Status**: `success`
- **Amount**: $183.97
- **Processed At**: `2026-01-12T15:37:49-08:00` ❌ **4 DAYS LATER**
- **Gateway**: `shopify_payments`

## Financial Breakdown

### Original Amounts
- **Subtotal**: $1,220.69
- **Discounts**: $338.75 (Two discount codes: "Travel loyalty" $185.91 + "FIRST2026" $218.72)
- **Net Subtotal**: $881.94
- **Tax**: $64.01
- **Total**: $1,129.92

### After Partial Refund
- **Current Subtotal**: $881.94
- **Current Discounts**: $338.75
- **Current Tax**: $64.01
- **Current Total**: $945.95

### Refund Amount
- **Refunded**: $183.97
- **Net Total After Refund**: $945.95

## Expected Behavior

✅ **Order #80284 SHOULD be included in January 8 export** because:
1. Original capture transaction occurred on January 8, 2026 at 10:36:40 AM
2. Our "Last-Capture-Date Rule" states orders post on the date of their LAST captured payment
3. The refund happened 4 days later (Jan 12), so it's a separate transaction

## Why Is It Missing?

### Hypothesis 1: Bulk Operation Query Filtering ⚠️ MOST LIKELY

Our bulk operation query may be filtering out orders with `financial_status: partially_refunded`:

```graphql
{
  orders(query: "created_at:>=2026-01-08 AND created_at:<=2026-01-08") {
    edges {
      node {
        id
        name
        displayFinancialStatus  # This field might not include partially_refunded
        # ... other fields
      }
    }
  }
}
```

**Check**: Does our query include a financial_status filter that excludes `partially_refunded` orders?

**Location**: `/app/services/bulk-order-fetcher.server.ts` lines 150-220

### Hypothesis 2: Date Range Boundary Issue

Order created at `10:36:42-08:00` might be at the edge of our date range:
- Start date: `2026-01-08` (midnight?)
- End date: `2026-01-08` (midnight or end of day?)

If we're using:
- `created_at:>=2026-01-08` (means >= 00:00:00)
- `created_at:<=2026-01-08` (means <= 00:00:00)

Then `10:36:42` would be EXCLUDED!

**Expected**: Should use `created_at:>=2026-01-08 AND created_at:<2026-01-09` to capture full day

### Hypothesis 3: Transaction Fetching Failure

Even if the order is fetched, if transaction fetching fails:
1. Order has no transactions
2. `getOrderCaptureDate()` returns `null`
3. Order is skipped in processing

**Check**: Console logs for transaction fetch failures

## Verification Steps

1. **Check Bulk Query**:
   ```bash
   # Look for query construction in bulk-order-fetcher.server.ts
   grep -A 20 "orders(query:" app/services/bulk-order-fetcher.server.ts
   ```

2. **Check JSONL Files**:
   ```bash
   # Search for order 80284 in downloaded JSONL files
   grep "80284" /tmp/export-*/bulk-orders-*.jsonl
   ```

3. **Check Console Logs**:
   ```bash
   # Look for transaction fetch failures
   grep -i "80284\|transaction.*fail" /tmp/export-*/console.log
   ```

4. **Test Direct Order Fetch**:
   ```bash
   # Use REST API to fetch order directly
   curl -X GET "https://{shop}/admin/api/2024-10/orders/6776909922534.json" \
     -H "X-Shopify-Access-Token: {token}"
   ```

## Impact Analysis

### Financial Impact
- **Missing Revenue**: $1,129.92 (original sale)
- **Missing Tax**: $64.01
- **Missing Subtotal**: $881.94
- **This represents ONE of the highest-value orders for the day**

### Reconciliation Impact
- Daily totals will be under-reported by $945.95 (after refund)
- Tax totals will be under-reported by $64.01
- Order count will be under-reported by 1

### Comparison to Christina's Source
Christina's source file shows:
- Order #80284 with sales: $1,065.91
- Tax: $64.01
- Status: `partially_refunded`

**Our exports show**: Nothing (order missing entirely)

## Recommended Fix

### Immediate Action
1. **Add debug logging** to identify why order is missing
2. **Check bulk operation query** for financial status filters
3. **Verify date range logic** includes full day (not just midnight)
4. **Add validation step** to compare order count against expected

### Code Changes Needed

**Priority 1**: Fix bulk operation query to include ALL financial statuses:
```graphql
# Remove any financial_status filters
# Use only date filters
orders(query: "created_at:>=2026-01-08 AND created_at:<2026-01-09")
```

**Priority 2**: Fix date range to use `<` instead of `<=` for end date:
```typescript
// Current (possibly wrong):
`${queryField}:>=${startDate} AND ${queryField}:<=${endDate}`

// Should be:
`${queryField}:>=${startDate} AND ${queryField}:<${nextDate}`
```

**Priority 3**: Add order count validation:
```typescript
// After fetching orders
console.log(`Expected orders: ${expectedCount}, Actual: ${orders.length}`);
if (orders.length < expectedCount) {
  throw new Error(`Missing ${expectedCount - orders.length} orders`);
}
```

## Test Cases

Add test to verify:
1. ✅ Orders with `financial_status: paid` are included
2. ✅ Orders with `financial_status: partially_refunded` are included
3. ✅ Orders with `financial_status: refunded` are excluded (handled separately)
4. ✅ Orders at day boundaries (00:00:00 and 23:59:59) are included
5. ✅ Orders with refunds on different dates are still included

## Next Steps

1. [ ] Run diagnostic query to fetch order #80284 directly
2. [ ] Check bulk operation JSONL files for order presence
3. [ ] Review query construction logic in bulk-order-fetcher.server.ts
4. [ ] Add debug logging to identify filtering point
5. [ ] Implement fix based on root cause
6. [ ] Re-run January 8 export to verify fix
7. [ ] Add regression tests for partially_refunded orders

## Related Issues

- Tax calculation discrepancies (may be related to missing orders)
- Order count mismatch (54 vs 56 orders)
- Need to verify if other partially_refunded orders are also missing
