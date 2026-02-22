# Sage 50 Journal Entry Sync

A Shopify embedded app that generates CSV-formatted journal entries for import into Sage 50 accounting software using a **payout-first reconciliation** approach.

## 🎯 Overview

This app automates the process of exporting Shopify transaction data to Sage 50 by:

1. **Starting with payouts** (what actually hit your bank account)
2. **Working backwards** through balance transactions to source orders
3. **Reconciling perfectly** to ensure journal entries balance to exact payout amounts
4. **Generating CSV files** in Sage 50-compatible format

## ✨ Features

- ✅ **Payout-First Reconciliation** - Anchors all entries to actual bank deposits
- ✅ **Perfect Balance** - All journal entries reconcile to exact payout amounts
- ✅ **Manual & Automated Exports** - Generate CSVs on-demand or schedule nightly
- ✅ **Customizable Account Mappings** - Map transactions to your Sage 50 chart of accounts
- ✅ **Fee Breakdown** - Separates Shopify fees and payment gateway fees
- ✅ **Error Logging** - Comprehensive logging for debugging and monitoring
- ✅ **No Database Needed** - Configuration stored in JSON files (Session table only)

## 📊 How It Works

### Data Flow

```
Payout ($1,523.45) [Bank Deposit]
    ↓
Balance Transactions [What's IN the payout]
    ├─ Order #1001: $108.25 gross - $3.20 fee = $105.05 net
    ├─ Order #1002: $215.00 gross - $6.30 fee = $208.70 net
    └─ Refund #1003: -$50.00
    ↓
Orders & Transactions [Source details]
    ├─ Order #1001: $100 product + $8.25 tax
    ├─ Fees: $2.50 Shopify + $0.70 gateway
    └─ ...
    ↓
Journal Entries [Balanced to payout]
    ├─ Cash Account (Debit): $1,523.45
    ├─ Sales Revenue (Credit): $300.00
    ├─ Sales Tax (Credit): $24.50
    ├─ Processing Fees (Debit): $9.50
    └─ Clearing Account: Balances everything
```

### Reconciliation Logic

**When Order Created:**
```csv
Date,Reference,Account,Debit,Credit,Memo
01/15/2024,SO-1001,1250-00,108.25,0.00,Order #1001
01/15/2024,SO-1001,4000-00,0.00,100.00,Sales - Order #1001
01/15/2024,SO-1001,2200-00,0.00,8.25,Sales Tax - Order #1001
```

**When Fees Deducted:**
```csv
01/15/2024,FEE-1001,6100-00,3.20,0.00,Processing Fee
01/15/2024,FEE-1001,1250-00,0.00,3.20,Fee Deduction
```

**When Payout Received:**
```csv
01/17/2024,PO-456,1000-00,1523.45,0.00,Shopify Payout 456
01/17/2024,PO-456,1250-00,0.00,1523.45,Clear Shopify Clearing
```

**Result**: Clearing Account balances to $0, Cash matches bank deposit.

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.19
- Shopify Partner account
- Shopify store with Shopify Payments enabled
- Sage 50 accounting software

### Installation

1. **Clone and setup**
   ```bash
   git clone <repository-url>
   cd sage50-journal-entry-sync
   npm install
   ```

2. **Initialize database**
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

3. **Start development**
   ```bash
   npm run dev
   ```

4. **Install on your store**
   - Follow the URL from `shopify app dev`
   - Grant permissions:
     - `read_shopify_payments_payouts`
     - `read_shopify_payments_accounts`
     - `read_orders`

## ⚙️ Configuration

### 1. Account Mappings (`/app/mappings`)

Map Shopify transactions to your Sage 50 chart of accounts:

| Transaction Type | Default Code | Your Code | Description |
|-----------------|--------------|-----------|-------------|
| Sales Revenue | 4000-00 | _________ | Product sales |
| Sales Tax | 2200-00 | _________ | Collected sales tax |
| Shipping Revenue | 4100-00 | _________ | Shipping charges |
| Cash Account | 1000-00 | _________ | Bank deposits |
| Clearing Account | 1250-00 | _________ | Temporary holding |
| Processing Fees | 6100-00 | _________ | Gateway fees |
| Shopify Fees | 6110-00 | _________ | Shopify fees |
| Refunds | 4900-00 | _________ | Returns |

### 2. Sync Settings (`/app/settings`)

- **Enable automatic exports**: Yes/No
- **Schedule**: Manual or Nightly
- **Scheduled time**: 02:00 (24-hour format)
- **Auto-export date**: Yesterday, Today, Last 7 days
- **Transaction types**: Orders ✓ Refunds ✓ Payments ✓
- **CSV format**: Standard

### 3. Data Storage Structure

```
/data/
  {shop-domain}/
    config.json           # Sync settings
    mappings.json         # Account mappings
    scheduled-exports.log # Export history
    error.log            # Error logs
    exports/             # CSV files
      journal-entries-2024-01-15.csv
```

## 📤 Usage

### Manual Export

1. Go to **Export Center** (`/app/exports`)
2. Select date range (e.g., January 15, 2024)
3. Click **"Generate CSV"**
4. Download CSV file
5. Import into Sage 50

### Automated Export

1. Go to **Settings** (`/app/settings`)
2. Enable **"Enable automatic exports"**
3. Set schedule to **Nightly at 02:00**
4. Select **Auto-export date: Yesterday**
5. Save

The app will automatically:
- Run at 2:00 AM daily
- Generate CSV for yesterday's payouts
- Save to `/data/{shop}/exports/`
- Log results

### Importing to Sage 50

1. Download CSV from Export Center
2. Open Sage 50
3. **File** → **Import/Export** → **Import**
4. Select **Journal Entry**
5. Choose CSV file
6. Map columns (auto-mapped):
   - Date → Date
   - Reference → Reference
   - Account → Account Code
   - Debit → Debit Amount
   - Credit → Credit Amount
   - Memo → Description
7. Import and verify

## 🔧 Development

### Project Structure

```
app/
├── routes/
│   ├── app._index.tsx         # Dashboard
│   ├── app.settings.tsx       # Settings
│   ├── app.mappings.tsx       # Account mappings
│   ├── app.exports.tsx        # Export center
│   └── api.*.tsx              # API endpoints
├── services/
│   ├── storage.server.ts          # JSON storage
│   ├── scheduler.server.ts        # Cron jobs
│   ├── reconciler.server.ts       # Reconciliation
│   ├── batch-processor.server.ts  # Export workflow
│   ├── csv-generator.server.ts    # CSV generation
│   ├── validator.server.ts        # Validation
│   ├── error-logger.server.ts     # Error logging
│   └── shopify/                   # API fetchers
└── types/
    └── journal-entry.ts       # TypeScript types
```

### Tech Stack

- React Router v7
- Polaris Web Components
- Prisma + SQLite
- Node.js
- node-cron
- decimal.js
- date-fns

### Running

```bash
# Development
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Build
npm run build

# Deploy
npm run deploy
```

## 🐛 Troubleshooting

### No Payouts Found

**Issue**: "No payouts found for date range"

**Fix**:
- Verify Shopify Payments is enabled
- Check date range includes payout dates
- Ensure payouts have status "paid"

### Entries Don't Balance

**Issue**: "Journal entries do not balance"

**Fix**:
- Check error logs: `/data/{shop}/error.log`
- Verify all account mappings configured
- Review balance validation errors

### Scheduled Export Not Running

**Issue**: Nightly export doesn't execute

**Fix**:
- Verify sync enabled in Settings
- Check scheduled time format (HH:mm)
- Review `scheduled-exports.log`
- Ensure server running continuously

### View Logs

```bash
# Recent errors
cat data/{shop-domain}/error.log | tail -50

# Scheduled exports
cat data/{shop-domain}/scheduled-exports.log
```

## 🚢 Deployment

### Production Checklist

- [ ] Test CSV import in Sage 50
- [ ] Verify all account mappings
- [ ] Test with real payout data
- [ ] Configure log rotation
- [ ] Set up monitoring
- [ ] Backup `/data` directory
- [ ] Set environment variables

### Environment Variables

```bash
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
```

## 📝 CSV Format

Standard Sage 50 journal entry format:

```csv
Date,Reference,Account,Debit,Credit,Memo
01/15/2024,SO-1001,4000-00,0.00,100.00,Sales - Order #1001
01/15/2024,SO-1001,2200-00,0.00,8.25,Sales Tax - Order #1001
01/17/2024,PO-456,1000-00,1523.45,0.00,Shopify Payout 456
```

## 🔒 Security

- Encrypted session storage
- Shop-specific data isolation
- No PII in CSV files
- API rate limiting with retry
- Access token rotation

## 📚 Resources

- [Shopify Payments API](https://shopify.dev/docs/api/admin-rest/2024-10/resources/shopify-payments)
- [Sage 50 Import Guide](https://support.na.sage.com/)
- [React Router Docs](https://reactrouter.com/)

## 📄 License

[Your License]

---

Built with ❤️ using Shopify App Template + React Router
