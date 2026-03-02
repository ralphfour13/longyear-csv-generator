# Sage 50 Journal Entry Sync - Project Primer

**Last Updated:** February 24, 2026
**Version:** Production (CapRover Deployment)
**Purpose:** Quick context for new Claude Code sessions

---

## 🎯 Project Overview

### What This Is
A **Shopify embedded app** that generates CSV-formatted journal entries for import into **Sage 50 accounting software** using a **payout-first reconciliation** approach.

### Core Business Logic
1. **Start with payouts** (actual bank deposits)
2. **Work backwards** through balance transactions to source orders
3. **Reconcile perfectly** to ensure journal entries balance to exact payout amounts
4. **Generate 3 CSV files** for comprehensive bookkeeping

### Key Value Proposition
- Automates Shopify → Sage 50 accounting export
- Perfect reconciliation to bank deposits
- GAAP-compliant journal entries
- Handles complex scenarios: discounts, refunds, fees, COGS, multiple payment methods

---

## 🏗️ Architecture & Tech Stack

### Current Production Setup
- **Platform:** CapRover (unified Node.js deployment)
- **Framework:** React Router v7
- **UI Components:** Polaris Web Components
- **Database:** Prisma + SQLite (Session table only)
- **Storage:** Local filesystem JSON files (`/data/{shop}/`)
- **Scheduler:** node-cron (in-process)
- **Deployment:** `caprover deploy --default`

### Tech Stack
```json
{
  "runtime": "Node.js >= 20.19",
  "framework": "React Router v7",
  "ui": "Polaris Web Components",
  "database": "Prisma + SQLite",
  "math": "decimal.js (precise financial calculations)",
  "dates": "date-fns",
  "csv": "csv-writer",
  "scheduler": "node-cron",
  "integrations": [
    "Shopify Admin GraphQL API",
    "Shopify Payments API",
    "Cin7 Core API (COGS)",
    "Resend API (email notifications)"
  ]
}
```

### Not Used (Important!)
- ❌ **Not using Vercel** (archived docs exist but not relevant)
- ❌ **Not using split frontend/backend** (unified deployment)
- ❌ **No external database** (JSON file storage for config)
- ❌ **No Redis/queue** (in-memory processing)

---

## 📁 Project Structure

```
sage50-journal-entry-sync/
├── app/
│   ├── routes/                    # React Router v7 routes
│   │   ├── app._index.tsx         # Dashboard
│   │   ├── app.settings.tsx       # Settings UI
│   │   ├── app.mappings.tsx       # Account mappings
│   │   ├── app.exports.tsx        # Export center
│   │   └── api.*.tsx              # API endpoints
│   ├── services/                  # Business logic (server-side)
│   │   ├── storage.server.ts              # JSON file storage
│   │   ├── scheduler.server.ts            # Cron job scheduler
│   │   ├── order-centric-reconciler.server.ts    # Main reconciliation logic
│   │   ├── order-centric-journal-generator.server.ts  # Journal entry creation
│   │   ├── order-centric-fetcher.server.ts       # Shopify data fetcher
│   │   ├── batch-processor.server.ts      # Export workflow orchestration
│   │   ├── csv-generators/                # 3-file CSV generation
│   │   ├── cin7-cogs-calculator.server.ts # COGS calculation
│   │   ├── validator.server.ts            # Entry balance validation
│   │   └── error-logger.server.ts         # Error logging
│   └── types/
│       └── journal-entry.ts       # TypeScript types
├── data/                          # JSON storage (gitignored)
│   └── {shop-domain}/
│       ├── config.json            # Sync settings
│       ├── mappings.json          # GL account mappings
│       ├── scheduled-exports.log  # Export history
│       ├── error.log              # Error logs
│       └── exports/               # Generated CSV files
├── prisma/
│   └── schema.prisma              # Session table only
├── DEPLOYMENT_WORKFLOW.md         # ⭐ PRIMARY deployment guide
├── DEPLOYMENT.md                  # 📚 COMPREHENSIVE reference
├── README.md                      # User-facing documentation
└── PROJECT_PRIMER.md              # 👈 THIS FILE
```

---

## 🚢 Deployment

### Current Production Workflow
```bash
# Standard deployment workflow
git add .
git commit -m "Description"
git push origin Production
caprover deploy --default
```

### CapRover Configuration
- **App Name:** sage50-journal-entry-sync
- **Branch:** Production (main branch)
- **Port:** 80 (container)
- **Start Command:** `npm run docker-start`
- **Persistent Volumes:** `/data` (mapped to container)
- **Environment Variables:** Set in CapRover dashboard

### Key Files
- `captain-definition` - CapRover deployment config
- `Dockerfile` - Container build instructions
- `shopify.app.toml` - Shopify app configuration

### Active Deployment Docs
1. **DEPLOYMENT_WORKFLOW.md** - Day-to-day deployment guide (PRIMARY)
2. **DEPLOYMENT.md** - Comprehensive testing & deployment reference

### Deprecated Docs (Do NOT Use)
- ❌ SPLIT_DEPLOYMENT.md (split architecture not used)
- ❌ VERCEL_DEPLOYMENT.md (not deployed on Vercel)

---

## 🔄 Data Flow & Business Logic

### Three Export Files

#### 1. Daily Sales Report (`daily-sales-report_YYYY-MM-DD.csv`)
- **Purpose:** Transaction-level detail for validation
- **Columns:** 32 fields including order details, tax breakdown, payment methods
- **Use Case:** Source of truth for bookkeeping validation

#### 2. Payouts with Orders (`payouts-with-orders_YYYY-MM-DD.txt`)
- **Purpose:** Reconciliation view (which orders → which payout)
- **Columns:** 7 fields (flat structure)
- **Use Case:** Trace payouts back to source orders

#### 3. Journal Entry Summary (`journal-entries_YYYY-MM-DD.txt`)
- **Purpose:** Import into Sage 50
- **Columns:** 5 fields (Date, Reference, Account, Amount, Memo)
- **Format:** Signed amounts (positive=debit, negative=credit)
- **Requirement:** MUST balance to $0.00

### Reconciliation Approach

**Payout-First Logic:**
```
Payout ($1,523.45) [What hit the bank]
    ↓
Balance Transactions [What's IN the payout]
    ├─ Order #1001: $108.25 gross - $3.20 fee = $105.05 net
    └─ Refund #1003: -$50.00
    ↓
Orders & Transactions [Source details]
    ├─ Order #1001: $100 product + $8.25 tax
    └─ Fees: $2.50 Shopify + $0.70 gateway
    ↓
Journal Entries [Balanced to payout]
    ├─ Payment Account (Dr): $87.95
    ├─ Sales Revenue (Cr): -$75.61  ← NET (post-discount)
    ├─ Sales Tax (Cr): -$5.84
    ├─ Shipping (Cr): -$6.50
    ├─ COGS (Dr): $36.74
    └─ Inventory (Cr): -$36.74
```

---

## 🎯 Recent Changes & Current State

### Latest Major Fix (Feb 24, 2026)
**Issue:** Journal entries using GROSS sales + discount offset (incorrect)
**Fix:** Changed to NET sales (post-discount), removed 3034 discount entries

**File:** `app/services/order-centric-journal-generator.server.ts` (lines 65-102)

**Impact:**
- ✅ No more 3034 (Discount) account entries
- ✅ Sales amounts match daily-sales-report (source of truth)
- ✅ Simplified accounting (one sales figure vs gross + discount offset)

### Recent Commits (Last 10)
```
ce40386 Add: COGS Details file generation checkbox
945854f Fix: Prevent session expiration during COGS details generation
0f92a6e Fix: Use NET sales instead of GROSS, remove discount entries (3034)
2004fc9 Optimize: Pre-fetch unique SKUs to dramatically reduce Cin7 API calls
e19bf0b Fix: Remove expiring offline access tokens to prevent session loss
cf9fd6a Fix: Remove COGS reversal for refunds - COGS should remain recognized
2262a80 Fix: Rename config variable to shopConfig to avoid naming conflict
540402f Add: Email notifications for scheduled exports using Resend
99c468c Add: Clear all exports button in settings Danger Zone
573f43d Fix: Improve Cin7 rate limiting to prevent 429 errors
```

### Active Features
- ✅ Manual & automated exports
- ✅ Three-file export system
- ✅ COGS integration with Cin7 Core
- ✅ Email notifications (Resend)
- ✅ Session token rotation (expiring tokens)
- ✅ Error isolation (partial export failures)

### Known Issues
- ⚠️ Gift card orders investigation pending (orders #80386, #80423 on Jan 10)
- ⚠️ COGS warnings when Cin7 product data missing (non-blocking)

---

## 🔑 Key Configuration

### Account Mappings
Default GL account codes (customizable per shop):

| Transaction Type | Account Code | Description |
|-----------------|--------------|-------------|
| Sales Revenue | 4000-00 | Product sales (NET) |
| Sales Tax | 2200-00 | Collected sales tax |
| Shipping Revenue | 4100-00 | Shipping charges |
| Cash Account | 1000-00 | Bank deposits (payouts) |
| Clearing Account | 1250-00 | Shopify Payments clearing |
| Processing Fees | 6100-00 | Gateway fees |
| Shopify Fees | 6110-00 | Shopify subscription fees |
| Refunds | 4900-00 | Returns & refunds |
| COGS | 5000-00 | Cost of goods sold |
| Inventory | 1300-00 | Inventory asset |

### Payment Method Mapping

| Payment Method | Report Column | GL Account | Description |
|----------------|---------------|------------|-------------|
| shopify_payments | card | 1061-00 | Shopify Payments |
| Cash | CASH | 1051-00 | Cash on Hand |
| Gift Card | GIFT CARD | 2320-00 | Gift Card Liability |
| Store Credit | STORE CREDIT | 2320-00 | Store Credit |
| Check | CHECK | 1051-00 | Check payments |

### Environment Variables (Set in CapRover)
```bash
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
CIN7_API_KEY=your_cin7_key
CIN7_ACCOUNT_ID=your_account_id
RESEND_API_KEY=your_resend_key
```

---

## 🛠️ Development Workflow

### Local Development
```bash
# Start development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build

# Database setup
npx prisma generate
npx prisma db push
```

### Git Workflow
**Branch Structure:**
- `Production` - Main production branch (default)
- `Development` - Development branch (optional)

**Standard workflow:**
```bash
# Create feature branch from Production
git checkout -b feature/description Production

# Make changes and commit
git add .
git commit -m "Description"

# Push and create PR
git push origin feature/description
gh pr create --title "Title" --body "Description"

# Merge to Production after review
gh pr merge
```

### Testing Workflow
1. Test locally with `npm run dev`
2. Test on CapRover staging (if available)
3. Deploy to production via `caprover deploy --default`
4. Verify in production Shopify app

---

## 🔍 Common Tasks

### Run Manual Export
1. Start app: `npm run dev` or access production URL
2. Navigate to "Export Center"
3. Select date range
4. Click "Export"
5. Download CSV files from UI or check `/data/{shop}/exports/`

### Check Export Logs
```bash
# View recent errors
cat data/{shop-domain}/error.log | tail -50

# View scheduled export history
cat data/{shop-domain}/scheduled-exports.log

# Check for specific order
grep "SO-#80368" data/{shop}/exports/journal-entry-details_2026-01-10.csv
```

### Validate Journal Entries
```bash
# Check for discount entries (should be empty after fix)
grep "3034" data/{shop}/exports/journal-entry-details_2026-01-10.csv

# Verify specific order sales amount
grep "SO-#80368.*3000" data/{shop}/exports/journal-entry-details_2026-01-10.csv
# Should show: -75.61 (NET sales)

# Check balance (rollup file should net to $0.00)
cat data/{shop}/exports/journal-entry-rollup_2026-01-10.csv
```

### Debug COGS Issues
1. Check Cin7 API connectivity
2. Verify product SKUs match between Shopify and Cin7
3. Check COGS warnings in error logs
4. Exports continue even if COGS fails (non-blocking)

---

## ⚠️ Important Context & Gotchas

### Financial Precision
- **ALWAYS use `Decimal.js`** for money calculations (never plain numbers)
- **All amounts are in shop currency** (no multi-currency support yet)
- **Journal entries MUST balance** (validated before export)

### Data Model
- **No database for business data** - Only Session table in Prisma
- **Configuration stored in JSON files** - `/data/{shop}/config.json`, `mappings.json`
- **Shop-specific data isolation** - Each shop has separate `/data/{shop}/` directory

### Shopify API Quirks
- **Balance transactions != Orders** - Need to correlate via transaction IDs
- **Capture dates != Order dates** - Use capture date for reconciliation
- **Partial refunds are complex** - Separate RF- entries, must balance independently
- **Gift card orders** - May not have standard capture transactions (investigation pending)

### COGS Integration
- **Optional feature** - Requires Cin7 Core API credentials
- **Non-blocking** - Exports continue without COGS if calculation fails
- **Rate limiting** - Cin7 API has strict rate limits (429 errors)
- **SKU matching required** - Products must exist in Cin7 with accurate costs

### Session Management
- **Expiring offline tokens** - Tokens rotate for security
- **Long operations can expire sessions** - COGS generation prevented session loss (commit 945854f)
- **Session stored in SQLite** - Only data in database

### Deployment
- **CapRover persistent volumes required** - `/data` must persist across deployments
- **No hot reload in production** - Requires full redeploy for changes
- **Environment variables** - Set in CapRover, not in `.env` files

---

## 📚 Documentation Reference

### Primary Docs (Use These)
1. **PROJECT_PRIMER.md** - This file (quick context)
2. **DEPLOYMENT_WORKFLOW.md** - Day-to-day deployment operations
3. **DEPLOYMENT.md** - Comprehensive testing & deployment guide
4. **README.md** - User-facing documentation
5. **IMPLEMENTATION_SUMMARY.md** - Latest implementation changes

### Reference Docs
- **CHANGELOG.md** - Version history
- **QUICK_REFERENCE.md** - Quick command reference
- **USER-GUIDE.md** - End-user documentation
- **TESTING_GUIDE.md** - Testing procedures

### Deprecated Docs (Ignore)
- ❌ SPLIT_DEPLOYMENT.md (not applicable)
- ❌ VERCEL_DEPLOYMENT.md (not applicable)
- ❌ VERCEL_QUICKSTART.md (not applicable)

---

## 🚨 Critical Reminders

### Before Making Changes
1. **Read existing code first** - Understand before modifying
2. **Check IMPLEMENTATION_SUMMARY.md** - Recent changes documented
3. **Verify account mappings** - Don't hardcode GL accounts
4. **Test with real payout data** - Don't assume data structure
5. **Consider decimal precision** - Always use Decimal.js for money

### Before Deployment
1. **Test locally** with `npm run dev`
2. **Run typecheck** with `npm run typecheck`
3. **Verify journal entries balance** - Must net to $0.00
4. **Check for breaking changes** - Especially in data models
5. **Review deployment workflow** - Follow DEPLOYMENT_WORKFLOW.md

### Data Safety
- **Never delete `/data` directory** - Contains all configuration
- **Backup before major changes** - Especially account mappings
- **Test with single date first** - Before bulk exports
- **Verify CSV output manually** - Spot-check before Sage 50 import

---

## 🎓 Quick Learning Path

### New to the Project?
1. Read this primer (you're here!)
2. Read README.md (user perspective)
3. Review DEPLOYMENT_WORKFLOW.md (deployment process)
4. Explore `/app/services/order-centric-*.server.ts` (core logic)
5. Check IMPLEMENTATION_SUMMARY.md (recent changes)

### Need to Make Changes?
1. Identify affected service(s) in `/app/services/`
2. Read existing implementation
3. Check for similar patterns in codebase
4. Use Decimal.js for all money calculations
5. Test with real data from production shop

### Debugging an Issue?
1. Check `/data/{shop}/error.log` first
2. Review scheduled-exports.log for timing issues
3. Test specific date range with manual export
4. Add console logging (use emojis for visibility: ⚠️, ❌, ✅)
5. Verify Shopify API responses (rate limits, data structure)

---

## 📞 Support & Resources

### Shopify Resources
- [Shopify Payments API Docs](https://shopify.dev/docs/api/admin-rest/2024-10/resources/shopify-payments)
- [Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql)
- [React Router v7 Docs](https://reactrouter.com/)

### Internal Resources
- Deployment logs: CapRover dashboard
- Error logs: `/data/{shop}/error.log`
- Export history: `/data/{shop}/scheduled-exports.log`
- Generated CSVs: `/data/{shop}/exports/`

### Getting Help
- Check documentation first (this primer + README)
- Review error logs for specific issues
- Test with manual export to isolate problem
- Check git history for similar fixes

---

## 🎯 Success Criteria for Changes

### All Changes Must
- ✅ Pass TypeScript type checking (`npm run typecheck`)
- ✅ Follow existing code patterns
- ✅ Use Decimal.js for money calculations
- ✅ Maintain journal entry balance (debits = credits)
- ✅ Include error handling and logging
- ✅ Test with real payout data
- ✅ Document in commit message

### Journal Entry Changes Must
- ✅ Balance to exactly $0.00
- ✅ Match daily-sales-report amounts (source of truth)
- ✅ Use correct GL account codes from mappings
- ✅ Handle edge cases (refunds, discounts, fees)
- ✅ Support COGS integration (if enabled)
- ✅ Include validation before export

---

**Last Context Refresh:** February 24, 2026
**Active Branch:** Production
**Recent Focus:** NET sales calculation fix, COGS optimization, session management

**When in doubt, check DEPLOYMENT_WORKFLOW.md for operational procedures and this primer for architecture context.**
