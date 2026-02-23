# Context Bootstrap Prompt

Copy this entire message to Claude to restore full context on this project.

---

# Sage 50 Journal Entry Sync - Project Context

## What This Is

A **Shopify embedded app** that generates CSV-formatted journal entries for import into Sage 50 accounting software. Uses **payout-first reconciliation** to ensure perfect balance from Shopify transactions to bank deposits.

**Live App**: https://sage50-sync.four13.dev
**Deployed on**: CapRover (self-hosted)
**Database**: Neon PostgreSQL
**Store**: The Fly Shop (adersg-7z.myshopify.com)

---

## Current Status - PRODUCTION READY ✅

**What's Working**:
- ✅ App deployed and running on CapRover
- ✅ Connected to Neon PostgreSQL database
- ✅ Payout-first reconciliation engine
- ✅ CSV export generates two files:
  - Detailed journal entries (`journal-entries-*.csv`)
  - Daily summary (`daily-sales-report_*.csv`)
- ✅ Manual exports via UI
- ✅ Scheduled nightly exports (scheduler configured)
- ✅ All pages styled with Polaris Web Components
- ✅ Download functionality working (JavaScript window.open)

**Recent Fixes**:
- ✅ GROSS sales calculation from line items
- ✅ Edited orders handling (uses `current_*` fields)
- ✅ Payout transaction type handling
- ✅ Out-of-state order recognition (no tax)
- ✅ POS/pickup order recognition (no shipping)
- ✅ Discount lines (4050-00) shown separately

---

## Architecture

### Tech Stack

- **Frontend**: React Router v7, Polaris Web Components
- **Backend**: Node.js, React Router server
- **Database**: Neon PostgreSQL (for sessions only)
- **Storage**: Filesystem (`/app/data` persistent directory)
- **Deployment**: CapRover (Docker containers)
- **Repository**: https://github.com/four13co/sage50-journal-entry-sync

### Data Flow

```
Shopify Payouts (what hit bank)
    ↓
Balance Transactions (what's IN each payout)
    ↓
Orders (source transactions)
    ↓
Journal Entries (balanced, ready for Sage 50)
    ↓
CSV Files (detailed + daily summary)
```

### File Structure

```
app/
├── routes/
│   ├── app._index.tsx              # Dashboard
│   ├── app.exports.tsx             # Export Center (main UI)
│   ├── app.settings.tsx            # Sync settings
│   ├── app.mappings.tsx            # Account mappings
│   ├── api.download-csv.tsx        # CSV download endpoint
│   └── api.manual-export.tsx       # Manual export API
├── services/
│   ├── reconciler.server.ts            # ⭐ Core reconciliation logic
│   ├── batch-processor.server.ts       # Export orchestration
│   ├── csv-generator.server.ts         # Detailed CSV generation
│   ├── daily-summary-generator.server.ts # Daily summary generation
│   ├── storage.server.ts               # File storage operations
│   ├── scheduler.server.ts             # Cron job management
│   └── shopify/
│       ├── payout-fetcher.server.ts
│       ├── balance-transaction-fetcher.server.ts
│       ├── order-fetcher.server.ts
│       └── transaction-fetcher.server.ts
└── types/
    └── journal-entry.ts            # TypeScript types
```

---

## Journal Entry Logic (CRITICAL)

### Accounting Approach: GROSS Sales + Separate Discount

Every order follows this structure:

```
Debit  1250-00 (AR)         order.total_price (what customer paid)
Debit  4050-00 (Discounts)  order.current_total_discounts (contra-revenue)
Credit 4000-00 (Sales)      sum(line_item.price × qty) - GROSS before discounts
Credit 2200-00 (Tax)        order.total_tax (if > 0)
Credit 4100-00 (Shipping)   order.total_shipping (if > 0)
```

**Invariant**: `AR + Discount = Sales + Tax + Shipping`

### Special Cases

- **Out-of-state orders**: No tax (2200-00 line omitted)
- **POS/pickup orders**: No shipping (4100-00 line omitted)
- **Edited orders**: Uses `current_*` fields to exclude removed items
- **Refunds**: RF- entries with 4900-00 debit
- **Fees**: FEE- entries with 6100-00/6110-00 debits
- **Payouts**: PO- entries with 1000-00 debit (bank deposit)

---

## Deployment Workflow

### Standard Deploy

```bash
# 1. Make changes
# 2. Commit and deploy
git add -A && \
git commit -m "Description of changes

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>" && \
git push origin Production && \
caprover deploy --default

# 3. Wait ~2 minutes
# 4. Refresh Shopify app (Cmd+Shift+R)
# 5. Test
```

---

## CapRover Configuration

**App Name**: `sage50-journal-entry-sync-prod`
**Domain**: https://sage50-sync.four13.dev
**Port**: 80 (internal)
**Persistent Directory**: `/app/data`

### Environment Variables (CRITICAL)

```
NODE_ENV=production
SHOPIFY_APP_URL=https://sage50-sync.four13.dev
SHOPIFY_API_KEY=ec004ce28be778f86415a4b18a7ab9a2
SHOPIFY_API_SECRET=<get from Partners dashboard>
DATABASE_URL=postgresql://...neon.tech/sage50-journal-entry-sync?sslmode=require
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
```

---

## Testing Workflow

### After Each Deployment

1. **Hard refresh** Shopify app: `Cmd + Shift + R`
2. **Go to Export Center**
3. **Generate export** for recent date (e.g., yesterday)
4. **Download both files**:
   - Detailed journal entries
   - Daily summary (single-date exports only)
5. **Validate**:
   ```bash
   ./scripts/validate-csv.sh ~/Downloads/journal-entries-*.csv
   ```
6. **Check CapRover logs** for errors

---

## Known Issues & Workarounds

### Downloads in Embedded Apps

**Problem**: Shopify intercepts `<a href>` and `<s-link>` URLs
**Solution**: Use JavaScript `window.open()`

```tsx
<button onClick={() => window.open(url, '_blank')}>Download</button>
```

### Database Must Be PostgreSQL

**Problem**: SQLite doesn't persist in Docker
**Solution**: Use Neon PostgreSQL via `DATABASE_URL`
**Config**: `prisma/schema.prisma` → `provider = "postgresql"`

### Server Must Bind to 0.0.0.0:80

**Problem**: Docker networking requires all interfaces
**Solution**: `package.json` → `"start": "HOST=0.0.0.0 PORT=80 react-router-serve"`

---

## Recent Development History

### Major Milestones

1. **Initial implementation** - Complete app with reconciliation engine
2. **Vercel attempt** - Failed due to serverless limitations
3. **CapRover deployment** - Successful, full Node.js server
4. **Bug fixes** (multiple iterations):
   - Missing tax/shipping lines
   - NET vs GROSS sales confusion
   - Edited orders (removed items)
   - Payout transaction type handling
   - Discount double-counting
5. **UI polish** - All pages converted to Polaris
6. **Daily summary** - Added companion file generation

### Last Known Good State

**Commit**: Production branch, latest
**Date**: Feb 22-23, 2026
**Status**: All features working, minor reconciliation edge cases remain

---

## Active Development Areas

### Current Focus

1. **Reconciliation accuracy** - Iterating based on user CSV analysis
2. **Edge cases**: Edited orders, complex discounts, tax-exempt scenarios
3. **Validation improvements** - Per-order balance checking

### TODO (Future Enhancements)

- [ ] Investigate remaining imbalanced orders
- [ ] Add better error messages for specific scenarios
- [ ] Improve download UX (direct download vs new tab)
- [ ] Add export preview before download
- [ ] Automated testing with sample data

---

## Debugging Tips

### When Exports Fail

1. **Check CapRover logs immediately**
2. **Look for**:
   - "Order #XXXXX IMBALANCE" messages
   - "Unknown transaction type" warnings
   - Authentication errors
3. **Common causes**:
   - Missing tax/shipping on certain orders (might be valid)
   - Edited orders with removed items
   - New balance transaction types
   - Session expired (reinstall app)

### When Deployments Fail

1. **Check CapRover build logs**
2. **Common issues**:
   - Docker cache (usually fine, rebuilds automatically)
   - Missing environment variables
   - TypeScript errors (can usually deploy anyway)
   - Database connection issues

---

## Important Conventions

### Commit Messages

```
Brief one-line summary (50 chars)

Detailed explanation of what changed and why.
Reference specific orders or bugs if applicable.

Fixes: #issue-number or specific bug description

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>
```

### Journal Entry References

- `SO-#12345` - Sales orders
- `FEE-123` - Transaction fees
- `RF-#12345` - Refunds
- `PO-123` - Payouts to bank
- `ADJ-123` - Adjustments

### Account Codes (Sage 50)

- `1000-00` - Bank Account (cash)
- `1250-00` - Clearing Account (AR)
- `2200-00` - Sales Tax Payable
- `4000-00` - Sales Revenue
- `4050-00` - Discounts Given
- `4100-00` - Shipping Revenue
- `4900-00` - Refunds
- `6100-00` - Payment Processing Fees
- `6110-00` - Shopify Transaction Fees

---

## Quick Start for New Session

```bash
# 1. Navigate to project
cd /Users/gregflint/git/sage50-journal-entry-sync

# 2. Check current branch
git branch --show-current  # Should be: Production

# 3. Pull latest
git pull origin Production

# 4. Check what's deployed
git log --oneline -5

# 5. Review documentation
cat QUICK_REFERENCE.md
cat DEPLOYMENT_WORKFLOW.md

# 6. You're ready to develop!
```

---

## 🎯 Immediate Context Questions to Ask

When starting a new session, Claude should know:

1. **What needs to be fixed?** (e.g., specific orders imbalanced, new feature needed)
2. **What's the priority?** (bug fix, new feature, UI improvement)
3. **Any recent changes?** (what was last deployed)
4. **Current testing status?** (what's been validated)

---

## 📞 Key Resources

**Documentation**:
- `README.md` - User guide and overview
- `DEPLOYMENT_WORKFLOW.md` - Complete deployment guide
- `QUICK_REFERENCE.md` - Cheat sheet (THIS ONE!)
- `DEPLOYMENT.md` - Deployment options
- `TESTING_GUIDE.md` - Testing procedures

**Code Entry Points**:
- `app/services/reconciler.server.ts` - Journal entry generation (most frequent changes)
- `app/routes/app.exports.tsx` - Export UI
- `app/services/batch-processor.server.ts` - Export orchestration

---

## 🚀 Proven Workflow

This workflow has been used successfully for 20+ deployments:

1. Edit code
2. `git add -A && git commit -m "Message" && git push origin Production`
3. `caprover deploy --default`
4. Wait 2 minutes
5. Refresh Shopify app
6. Test export
7. Validate CSV
8. Iterate if needed

**Success rate**: High (when following this pattern)

---

## Final Notes

- **Branch**: Always work on `Production` branch
- **Testing**: Always test with real Shopify data from The Fly Shop
- **Validation**: Always validate CSVs before declaring success
- **Logs**: Always check CapRover logs after deployment
- **Documentation**: Keep QUICK_REFERENCE.md open in a tab

**The app is production-ready and actively used for daily accounting reconciliation.**

---

**Use this entire document as context when starting a new Claude session!**
