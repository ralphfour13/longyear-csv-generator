# Root Cause: Date Range Query Bug

## Problem

Order #80284 and potentially other orders are missing from exports due to incorrect date range query logic.

## Root Cause Found

**File**: `/app/services/bulk-order-fetcher.server.ts`
**Line**: 152

```typescript
orders(query: "${queryField}:>=${startDate} AND ${queryField}:<=${endDate}")
```

## The Bug

When querying for orders on `2026-01-08`:
- `created_at:>=2026-01-08` → Means >= `2026-01-08T00:00:00` ✅ Correct
- `created_at:<=2026-01-08` → Means <= `2026-01-08T00:00:00` ❌ **WRONG**

This excludes ALL orders created during the day (00:00:01 to 23:59:59)!

### Order #80284 Example
- Created at: `2026-01-08T10:36:42-08:00`
- Query check: Is `10:36:42` <= `00:00:00`? **NO** → Order excluded!

## Why This Went Unnoticed

The query returns SOME orders because:
1. A few orders might be created exactly at `00:00:00` (rare)
2. The `updated_at` query might catch more orders
3. The issue is intermittent based on order creation times

## The Fix

Change line 152 from:
```typescript
orders(query: "${queryField}:>=${startDate} AND ${queryField}:<=${endDate}")
```

To:
```typescript
const nextDate = new Date(endDate);
nextDate.setDate(nextDate.getDate() + 1);
const nextDateStr = nextDate.toISOString().split('T')[0];

orders(query: "${queryField}:>=${startDate} AND ${queryField}:<${nextDateStr}")
```

This will query:
- `created_at:>=2026-01-08` → >= `2026-01-08T00:00:00`
- `created_at:<2026-01-09` → < `2026-01-09T00:00:00`

Which correctly captures the full day: `2026-01-08T00:00:00` to `2026-01-08T23:59:59`.

## Impact

### Orders Affected
Potentially ALL orders in exports are affected:
- Orders created after `00:00:00` on the target date
- This explains why we have 54 orders vs Christina's 56+
- Missing order #80284 ($1,129.92 transaction)

### Data Integrity
- **Under-reported revenue** by unknown amount
- **Under-reported tax** by unknown amount
- **Order count mismatch** in all exports
- **Reconciliation totals incorrect**

## Testing

After fix, verify:
1. ✅ Order #80284 appears in January 8 export
2. ✅ Order count matches Christina's source (56 orders)
3. ✅ Total amounts reconcile correctly
4. ✅ Orders at day boundaries are included (00:00:00 and 23:59:59)

## Related Files to Update

1. **`bulk-order-fetcher.server.ts`** - Primary fix location
2. **`order-centric-fetcher.server.ts`** - Check if REST API has same bug
3. Tests - Add regression tests for date boundaries

## Urgency

**CRITICAL** - This bug affects ALL exports and causes:
- Missing orders
- Incorrect financial totals
- Failed reconciliations
- Data integrity issues

**Action Required**: Immediate fix and re-export of all historical data.
