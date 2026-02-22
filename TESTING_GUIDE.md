# 🧪 Step-by-Step Testing Guide

Follow this guide to test your Sage 50 Journal Entry Sync app from start to finish.

## Prerequisites

- ✅ Node.js >= 20.19 installed
- ✅ Shopify Partner account
- ✅ Development store with Shopify Payments enabled
- ✅ Sage 50 installed (for CSV import testing)
- ✅ At least one paid payout in your development store

## Phase 1: Initial Setup (5 minutes)

### Step 1: Run Quick Start

```bash
# Navigate to project directory
cd sage50-journal-entry-sync

# Run quick start script
./scripts/quick-start.sh
```

**Expected output**:
- ✅ Dependencies installed
- ✅ Database ready
- ✅ TypeScript validated
- ✅ All checks passed

### Step 2: Start Development Server

```bash
npm run dev
```

**Expected output**:
```
Using @shopify/cli, 3.x.x
...
Preview URL: https://[random].cloudflare-tunnel.com/app
```

**Action**: Copy the Preview URL

### Step 3: Install App

1. Open the Preview URL in your browser
2. Select your development store
3. Click **Install app**
4. Review permissions:
   - read_shopify_payments_payouts
   - read_shopify_payments_accounts
   - read_orders
5. Click **Install**

**Expected**: App installs successfully, redirects to dashboard

---

## Phase 2: Configuration (10 minutes)

### Step 4: Configure Account Mappings

1. Click **Account Mappings** in navigation
2. Review default mappings:

   | Field | Default | Your Sage 50 Code |
   |-------|---------|-------------------|
   | Sales Revenue | 4000-00 | _________ |
   | Sales Tax | 2200-00 | _________ |
   | Cash Account | 1000-00 | _________ |
   | Clearing Account | 1250-00 | _________ |
   | Processing Fees | 6100-00 | _________ |
   | Shopify Fees | 6110-00 | _________ |

3. Update codes to match your Sage 50 chart of accounts
4. Click **Save Mappings**

**✅ Checkpoint**: Success message appears, page reloads with saved values

### Step 5: Configure Sync Settings

1. Click **Settings** in navigation
2. Configure:
   - ✅ Enable automatic exports: **YES**
   - Schedule: **Nightly**
   - Scheduled time: **02:00**
   - Auto-export date: **Yesterday**
   - Transaction types: ✅ Orders, ✅ Refunds, ✅ Payments
   - CSV format: **Standard**
3. Click **Save Settings**

**✅ Checkpoint**: Success message includes "Scheduler updated"

### Step 6: Verify Configuration Files

```bash
# Open new terminal
cd sage50-journal-entry-sync

# Check files created
./scripts/test-setup.sh
```

**Expected**:
- ✅ Data directory exists
- ✅ Shop configured: [your-shop].myshopify.com
- ✅ config.json exists
- ✅ mappings.json exists

---

## Phase 3: First Export Test (15 minutes)

### Step 7: Find a Payout Date

**In Shopify Admin**:
1. Go to **Settings** → **Payments** → **Payouts**
2. Find a recent **Paid** payout
3. Note the payout date (e.g., February 15, 2024)

**If no payouts exist**: Create test orders and wait for payout, or use test data

### Step 8: Generate Manual Export

**In the app**:
1. Click **Export Center**
2. Set both dates to your payout date
3. Click **Generate CSV**

**Watch for**:
- Loading indicator appears
- Processing message
- Success message with filename

**Expected**:
```
✅ Export completed successfully
📄 Download journal-entries-2024-02-15.csv
```

**✅ Checkpoint**: Download link appears

### Step 9: Download and Inspect CSV

1. Click the download link
2. Open CSV in text editor or Excel

**Verify structure**:
```csv
Date,Reference,Account,Debit,Credit,Memo
02/15/2024,SO-1001,1250-00,108.25,0.00,Order #1001
02/15/2024,SO-1001,4000-00,0.00,100.00,Sales - Order #1001
02/15/2024,SO-1001,2200-00,0.00,8.25,Sales Tax - Order #1001
...
```

**Check**:
- [ ] Header row present
- [ ] Dates in MM/DD/YYYY format
- [ ] Account codes match your mappings
- [ ] Amounts have 2 decimal places
- [ ] Memo fields descriptive

### Step 10: Validate CSV Balance

```bash
# Run validation script
./scripts/validate-csv.sh data/[your-shop].myshopify.com/exports/journal-entries-2024-02-15.csv
```

**Expected output**:
```
✅ Validating CSV: journal-entries-2024-02-15.csv
======================================

1. Checking header...
   ✓ Header is correct

2. Counting entries...
   Total entries: 45

3. Checking balance...
   Debit: 1523.45, Credit: 1523.45, Diff: 0.00
   ✓ Entries are balanced!

4. Checking date format...
   ✓ All dates in correct format (MM/DD/YYYY)

5. Checking for missing values...
   ✓ No missing values

Status: ✅ Ready for import
```

**✅ Checkpoint**: All validations pass, balance is 0.00

---

## Phase 4: Sage 50 Import Test (10 minutes)

### Step 11: Import CSV to Sage 50

**In Sage 50**:

1. **File** → **Import/Export** → **Import**
2. Select **Journal Entry** import type
3. Click **Next**
4. Browse to your CSV file
5. Click **Next**
6. **Map Columns**:
   - Date → Date
   - Reference → Reference
   - Account → Account Code
   - Debit → Debit Amount
   - Credit → Credit Amount
   - Memo → Description
7. Click **Next** to preview
8. Review entries
9. Click **Import**

**Expected**:
```
✅ Import successful
   45 journal entries imported
   Debits: $1,523.45
   Credits: $1,523.45
```

### Step 12: Verify in Sage 50

**Check in Sage 50**:

1. **Reports** → **General Ledger** → **Journal Entries**
2. Filter by date: February 15, 2024
3. Filter by reference: Contains "SO-", "PO-", "FEE-"

**Verify**:
- [ ] All entries imported
- [ ] Cash account shows payout amount as debit
- [ ] Revenue accounts show credits
- [ ] Fee accounts show debits
- [ ] Clearing account nets to zero
- [ ] Total debits = Total credits

**✅ Checkpoint**: Import successful, all balances correct

---

## Phase 5: Scheduler Testing (20 minutes)

### Step 13: View Scheduler Status

**Check server logs**:
```bash
# In terminal where `npm run dev` is running
# Look for messages like:
```

**Expected**:
```
Initializing scheduler...
Creating cron schedule for [shop]: 0 2 * * *
Scheduled export for [shop] at 02:00
Scheduler initialized with 1 active tasks
```

**✅ Checkpoint**: Scheduler initialized message appears

### Step 14: Test Scheduled Export (Manual Trigger)

**Option A: Wait for scheduled time**
- Wait until 2:00 AM
- Check logs next morning

**Option B: Trigger manually (recommended)**

Create a test trigger file:

```bash
# Create test script
cat > test-schedule.js << 'EOF'
import { processExport } from './app/services/batch-processor.server.ts';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import { prisma } from './app/db.server.ts';

async function testScheduledExport() {
  const shop = 'YOUR-SHOP.myshopify.com'; // Replace with your shop

  // Get access token
  const sessionStorage = new PrismaSessionStorage(prisma);
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const accessToken = sessions[0].accessToken;

  // Calculate yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`Testing scheduled export for ${shop} on ${dateStr}...`);

  const result = await processExport(shop, accessToken, dateStr, dateStr);

  console.log('Export result:', result);
}

testScheduledExport().catch(console.error);
EOF

# Run test
node --loader ts-node/esm test-schedule.js
```

**Expected**: Export runs, CSV created

### Step 15: Verify Scheduled Export Logs

```bash
# View logs
./scripts/view-logs.sh [your-shop].myshopify.com
```

**Expected output**:
```
📋 Logs for: your-shop.myshopify.com
======================================

📅 Scheduled Exports (last 10):
--------------------------------------
✅ 2024-02-22T02:00:00.000Z: journal-entries-2024-02-21.csv (45 entries)

📦 Recent Exports (1 total):
--------------------------------------
journal-entries-2024-02-21.csv - 12K
```

**✅ Checkpoint**: Scheduled export logged successfully

---

## Phase 6: Error Handling Tests (15 minutes)

### Step 16: Test Invalid Date Range

**In Export Center**:
1. Start date: 2024-12-31
2. End date: 2024-01-01
3. Click Generate

**Expected**: Error message "End date cannot be before start date"

**✅ Checkpoint**: Validation error displayed

### Step 17: Test No Data Scenario

**In Export Center**:
1. Both dates: 2020-01-01 (no data)
2. Click Generate

**Expected**: Warning "No payouts found for date range"

**✅ Checkpoint**: Appropriate warning message

### Step 18: Test Missing Account Mapping

1. Go to **Account Mappings**
2. Clear the "Sales Revenue" account code
3. Save
4. Try to export

**Expected**: Validation error about missing mapping

**Restore**:
1. Set account code back to 4000-00
2. Save

**✅ Checkpoint**: Validation catches missing mappings

### Step 19: Review Error Logs

```bash
# Check error log
cat data/[your-shop].myshopify.com/error.log | tail -20
```

**Verify**:
- [ ] Errors are logged with timestamps
- [ ] Context information included
- [ ] Stack traces present for exceptions

---

## Phase 7: Performance Testing (Optional, 30 minutes)

### Step 20: Test Large Date Range

**In Export Center**:
1. Select 7-day date range with multiple payouts
2. Generate CSV

**Monitor**:
- Processing time
- Memory usage
- Error logs

**Expected**:
- Completes in < 60 seconds for 7 days
- No memory errors
- CSV validates correctly

### Step 21: Test Multiple Exports

**Run 5 consecutive exports**:
1. Different date ranges
2. Monitor server stability
3. Check file system usage

**Verify**:
- [ ] All exports succeed
- [ ] Filenames unique
- [ ] No file conflicts
- [ ] Disk space reasonable

---

## ✅ Final Verification Checklist

Before going to production:

### Configuration
- [ ] Account mappings match Sage 50 chart of accounts
- [ ] Sync schedule configured correctly
- [ ] All required transaction types enabled

### Functionality
- [ ] Manual export works for single date
- [ ] Manual export works for date range
- [ ] CSV validates (balanced, correct format)
- [ ] CSV imports successfully to Sage 50
- [ ] Scheduler initializes on server start
- [ ] Scheduled exports create files
- [ ] Error handling catches invalid inputs

### Data Integrity
- [ ] Debits equal credits in all exports
- [ ] Cash account matches payout amounts
- [ ] Revenue accounts accurate
- [ ] Fee accounts correct
- [ ] Clearing account nets to zero

### Logs & Monitoring
- [ ] Error log writing correctly
- [ ] Scheduled export log updating
- [ ] Log scripts work
- [ ] Validation script works

### Documentation
- [ ] README reviewed
- [ ] DEPLOYMENT.md reviewed
- [ ] Account mapping documented for team
- [ ] Import process documented

---

## 🎉 Success Criteria

Your app is ready for production when:

1. ✅ All Phase 1-6 tests pass
2. ✅ At least 3 successful manual exports
3. ✅ CSV successfully imported to Sage 50
4. ✅ All account balances correct in Sage 50
5. ✅ Scheduler runs without errors
6. ✅ Error logs reviewed and understood
7. ✅ Finance team trained on process

---

## 🆘 Getting Help

**If tests fail**:
1. Check error.log: `./scripts/view-logs.sh [shop]`
2. Verify configuration: `./scripts/test-setup.sh`
3. Validate CSV: `./scripts/validate-csv.sh [file]`
4. Review DEPLOYMENT.md troubleshooting section

**Still stuck?**
- Review README.md
- Check Shopify API status
- Verify Shopify Payments enabled
- Ensure payouts are "paid" status

---

**You're all set! Your Sage 50 Journal Entry Sync app is tested and ready to deploy.** 🚀
