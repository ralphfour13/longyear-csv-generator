# Uncaptured Authorization Report

## Purpose

Provide a page in the app that shows all orders with CC authorizations that were never captured since a configurable start date (default: Jan 1, 2026). This gives the client a total dollar amount of uncollected revenue from split-tender orders so they can accept it and close their books.

## Files

- **Create:** `app/services/uncaptured-auth-report.server.ts` — fetches orders and detects uncaptured auths
- **Create:** `app/routes/app.uncaptured-auths.tsx` — page route with loader and UI
- **Modify:** `app/routes/app.tsx` — add nav link

## Service: `uncaptured-auth-report.server.ts`

### `fetchOrdersWithUncapturedAuths(shop, accessToken, sinceDate)`

1. Fetch orders from Shopify REST API (`/admin/api/2024-10/orders.json`) with:
   - `financial_status=any` (we need to check all orders, not just partially_paid — an order could be "paid" via GC with an expired CC auth)
   - `created_at_min={sinceDate}T00:00:00Z`
   - `status=any` (include closed/cancelled)
   - Paginate using `Link` header (same pattern as `order-centric-fetcher.server.ts`)
   - Rate limit at ~4 calls/second

2. For each order, check for uncaptured auths:
   - Find `authorization` transactions with `status=success`
   - Check if a corresponding `capture` or `sale` exists for the same gateway
   - If no capture exists, this is an uncaptured auth

3. Return:
   ```typescript
   interface UncapturedAuthOrder {
     name: string;           // e.g., "#80598"
     id: string;             // Shopify order ID (for admin link)
     createdAt: string;
     orderTotal: string;     // totalPrice
     uncapturedAmount: string;
     capturedAmount: string;  // what WAS captured (other payment methods)
     gateway: string;        // e.g., "shopify_payments"
     financialStatus: string;
     paymentMethods: string; // summary like "gift_card + shopify_payments"
   }

   interface UncapturedAuthReport {
     orders: UncapturedAuthOrder[];
     totalUncaptured: string;
     orderCount: number;
     sinceDate: string;
   }
   ```

## Route: `app/routes/app.uncaptured-auths.tsx`

### Loader
- Authenticate via `authenticate.admin(request)`
- Read `sinceDate` from URL params (default: `2026-01-01`)
- Call `fetchOrdersWithUncapturedAuths()`
- Return report data

### UI
- Page heading: "Orders with Uncaptured Authorizations"
- Summary banner: "{count} orders with ${total} in uncaptured authorizations since {date}"
- Table: Order | Date | Order Total | Captured | Uncaptured | Gateway | Status
- Order name links to Shopify admin (`https://{shop}/admin/orders/{id}`)
- CSV download button (action handler that serializes the table data)

### Nav
Add `<s-link href="/app/uncaptured-auths">Uncaptured Auths</s-link>` to `app/routes/app.tsx`.

## Scope Boundaries

- Read-only report. No modifications to orders.
- No database storage — fetches live from Shopify each time.
- No background job — runs synchronously in the loader. If the store has thousands of orders this could be slow, but for this client's volume (~2000 orders/month) it's fine.
