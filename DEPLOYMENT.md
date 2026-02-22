# Deployment & Testing Guide

Complete guide for testing, configuring, and deploying the Sage 50 Journal Entry Sync app.

## 🧪 Testing Checklist

### Phase 1: Local Development Testing

#### 1.1 Initial Setup

```bash
# Install dependencies
npm install

# Initialize database
npx prisma generate
npx prisma migrate deploy

# Start development server
npm run dev
```

**Expected**: Server starts on port 3000, Shopify CLI provides installation URL

#### 1.2 Install on Development Store

1. Visit the URL from `shopify app dev` output
2. Click **Install app**
3. Grant permissions:
   - ✅ `read_shopify_payments_payouts`
   - ✅ `read_shopify_payments_accounts`
   - ✅ `read_orders`

**Expected**: App installs successfully, redirects to dashboard

#### 1.3 Verify Dashboard

Navigate to app home page (`/app`)

**Check**:
- [ ] Dashboard loads without errors
- [ ] "Sync Status" cards display
- [ ] "Getting Started" section visible
- [ ] "Recent Exports" shows "No exports yet"
- [ ] Navigation links work (Settings, Mappings, Exports)

#### 1.4 Configure Account Mappings

Go to **Account Mappings** (`/app/mappings`)

**Test**:
1. Verify default mappings loaded:
   - Sales Revenue: 4000-00
   - Sales Tax: 2200-00
   - Cash Account: 1000-00
   - etc.

2. Modify a mapping:
   - Change "Sales Revenue" to custom code (e.g., 4100-00)
   - Click **Save Mappings**
   - Verify success message
   - Refresh page
   - Confirm changes persisted

3. Test "Reset to Defaults":
   - Click **Reset to Defaults**
   - Verify mappings restored

**Expected**: All mappings save and persist correctly

#### 1.5 Configure Settings

Go to **Settings** (`/app/settings`)

**Test**:
1. Configure sync settings:
   - ✅ Enable automatic exports
   - Schedule: Nightly
   - Scheduled time: 02:00
   - Auto-export date: Yesterday
   - Transaction types: ✅ Orders ✅ Refunds ✅ Payments

2. Click **Save Settings**
3. Verify success message
4. Check console for scheduler update message

**Expected**: Settings save, scheduler updates automatically

#### 1.6 Verify Data Files Created

```bash
# Check data directory created
ls -la data/

# Check shop directory exists
ls -la data/{your-shop-domain}.myshopify.com/

# Verify configuration files
cat data/{your-shop-domain}.myshopify.com/config.json
cat data/{your-shop-domain}.myshopify.com/mappings.json
```

**Expected**: JSON files created with correct data

### Phase 2: Export Testing

#### 2.1 Test Manual Export (No Data)

Go to **Export Center** (`/app/exports`)

**Test with date that has no payouts**:
1. Select date: 2024-01-01 (likely no data)
2. Click **Generate CSV**

**Expected**: Error message "No payouts found for date range"

#### 2.2 Test Manual Export (With Data)

**Prerequisites**: Your store must have at least one paid payout

**Find a payout date**:
1. Go to Shopify Admin → Settings → Payments → Payouts
2. Note a recent payout date (e.g., 2024-02-15)

**Test export**:
1. Go to Export Center
2. Select the payout date for both start and end date
3. Click **Generate CSV**
4. Monitor browser console and server logs

**Expected**:
- Processing message appears
- Success message with filename
- Download link appears
- CSV file available in export history

#### 2.3 Verify CSV Content

**Download and inspect CSV**:
```bash
# View CSV content
cat data/{your-shop}.myshopify.com/exports/journal-entries-*.csv

# Check structure
head -5 data/{your-shop}.myshopify.com/exports/journal-entries-*.csv
```

**Verify**:
- [ ] Header row: `Date,Reference,Account,Debit,Credit,Memo`
- [ ] Date format: `MM/DD/YYYY`
- [ ] Reference format: `SO-#1001`, `PO-456`, `FEE-123`
- [ ] Account codes match your mappings
- [ ] Amounts have 2 decimal places
- [ ] Debits and Credits balance (sum equal)

**Calculate totals**:
```bash
# Quick balance check (should be equal)
awk -F',' 'NR>1 {debit+=$4; credit+=$5} END {print "Debit:", debit, "Credit:", credit}' data/{shop}/exports/journal-entries-*.csv
```

#### 2.4 Test CSV Import in Sage 50

**In Sage 50**:
1. File → Import/Export → Import
2. Select "Journal Entry" type
3. Choose your CSV file
4. Map columns (should auto-map):
   - Date → Date
   - Reference → Reference
   - Account → Account Code
   - Debit → Debit Amount
   - Credit → Credit Amount
   - Memo → Description
5. Preview import
6. Import

**Verify**:
- [ ] All entries import without errors
- [ ] Debits equal credits
- [ ] Cash account shows payout amount
- [ ] Account codes match your chart of accounts

### Phase 3: Scheduler Testing

#### 3.1 Verify Scheduler Initialized

**Check server logs**:
```bash
# Look for initialization messages
# In your terminal where `npm run dev` is running
```

**Expected log output**:
```
Initializing scheduler...
Scheduled export for {shop}.myshopify.com at 02:00
Scheduler initialized with 1 active tasks
```

#### 3.2 Test Scheduled Export (Manual Trigger)

**Modify scheduler for immediate test**:

Edit `app/services/scheduler.server.ts` temporarily:
```typescript
// Change cron expression to run in 2 minutes
const cronExpression = `${new Date().getMinutes() + 2} ${new Date().getHours()} * * *`;
```

**Or trigger manually in Node console**:
```bash
# In a new terminal
node
```

```javascript
// Load and execute scheduler
const { executeScheduledExport } = require('./app/services/scheduler.server.ts');
// Call function with your shop credentials
```

**Expected**:
- Scheduled export runs
- CSV file created in exports folder
- Entry in `scheduled-exports.log`

#### 3.3 Verify Scheduled Export Logs

```bash
# View scheduled export log
cat data/{your-shop}.myshopify.com/scheduled-exports.log

# View error log
cat data/{your-shop}.myshopify.com/error.log
```

**Expected format**:
```json
{"timestamp":"2024-02-22T02:00:00.000Z","success":true,"filename":"journal-entries-2024-02-21.csv","entryCount":45,"startDate":"2024-02-21","endDate":"2024-02-21","duration":3.5}
```

### Phase 4: Error Handling Testing

#### 4.1 Test Invalid Date Range

Go to Export Center:
1. Start date: 2024-12-31
2. End date: 2024-01-01
3. Click Generate

**Expected**: Error "End date cannot be before start date"

#### 4.2 Test Missing Account Mappings

1. Go to Account Mappings
2. Delete required mapping (e.g., clear "Sales Revenue" account code)
3. Save
4. Try to export

**Expected**: Validation error about missing required mapping

#### 4.3 Test API Retry Logic

**Simulate network failure** (optional, advanced):
- Temporarily disable network
- Attempt export
- Re-enable network
- Check error logs for retry attempts

**Expected**: Multiple retry attempts logged before final failure

## 🚀 Deployment to Production

### Option 1: Deploy to Shopify (Recommended)

#### Step 1: Prepare for Deployment

```bash
# Ensure everything is committed
git add .
git commit -m "Prepare for production deployment"

# Run type checking
npm run typecheck

# Build for production
npm run build
```

#### Step 2: Deploy with Shopify CLI

```bash
# Deploy app
npm run deploy
```

**Follow prompts**:
1. Select target organization
2. Choose production app or create new
3. Confirm deployment

#### Step 3: Update Environment Variables

In your hosting provider (e.g., Fly.io, Railway, Render):

```bash
# Required
SHOPIFY_API_KEY=your_production_api_key
SHOPIFY_API_SECRET=your_production_api_secret
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders

# Optional
NODE_ENV=production
DATABASE_URL=postgresql://... # If using PostgreSQL
```

#### Step 4: Install on Production Store

1. Go to Shopify Partners → Apps → [Your App]
2. Click "Select store"
3. Choose production store
4. Install app
5. Grant permissions

### Option 2: Self-Hosted Deployment

#### Option A: Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch

# Set secrets
fly secrets set SHOPIFY_API_KEY=xxx
fly secrets set SHOPIFY_API_SECRET=xxx

# Deploy
fly deploy
```

#### Option B: Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize
railway init

# Deploy
railway up
```

#### Option C: Docker

```dockerfile
# Dockerfile already included
docker build -t sage50-sync .
docker run -p 3000:3000 sage50-sync
```

### Post-Deployment Checklist

After deploying to production:

- [ ] App accessible via production URL
- [ ] Install on production store succeeds
- [ ] Dashboard loads correctly
- [ ] Configure account mappings
- [ ] Configure sync settings
- [ ] Test manual export with real data
- [ ] Verify CSV imports to Sage 50
- [ ] Enable nightly scheduled export
- [ ] Monitor logs for 24 hours
- [ ] Set up backups for `/data` directory
- [ ] Configure log rotation
- [ ] Set up monitoring/alerting

## 🔍 Monitoring & Maintenance

### Daily Checks

```bash
# Check scheduled export ran
tail -10 data/{shop}/scheduled-exports.log

# Check for errors
tail -50 data/{shop}/error.log | grep -i error

# Verify recent exports exist
ls -lht data/{shop}/exports/ | head -5
```

### Weekly Checks

```bash
# Clean up old logs (keeps last 30 days)
node -e "
const { cleanupOldLogs } = require('./app/services/error-logger.server.ts');
cleanupOldLogs('{your-shop}.myshopify.com');
"

# Review export count
ls data/{shop}/exports/ | wc -l

# Check disk usage
du -sh data/{shop}/
```

### Backup Strategy

```bash
# Daily backup script
#!/bin/bash
SHOP="your-shop.myshopify.com"
BACKUP_DIR="/backups/sage50-sync"
DATE=$(date +%Y-%m-%d)

# Backup data directory
tar -czf $BACKUP_DIR/data-$DATE.tar.gz data/$SHOP/

# Keep last 30 days
find $BACKUP_DIR -name "data-*.tar.gz" -mtime +30 -delete
```

### Performance Monitoring

**Key metrics to track**:
- Export generation time
- CSV file sizes
- API call counts
- Error rates
- Scheduler uptime

**Set up alerts for**:
- Failed scheduled exports
- Missing exports (gap in dates)
- Large error.log files
- API rate limit warnings

## 🐛 Common Issues & Solutions

### Issue: "No active session found for shop"

**Cause**: Access token expired or session deleted

**Fix**:
1. Reinstall app on store
2. Or update session storage with valid token

### Issue: Scheduler not running after deployment

**Cause**: Server restart required or initialization failed

**Fix**:
```bash
# Check if server running
ps aux | grep node

# Restart server
npm run start

# Check logs
tail -f data/{shop}/error.log
```

### Issue: CSV has unbalanced entries

**Cause**: Reconciliation error or missing transaction data

**Fix**:
1. Check error.log for validation errors
2. Verify all transaction types enabled
3. Re-run export for the date
4. Check Shopify for partial refunds or adjustments

### Issue: High memory usage

**Cause**: Processing large date ranges or many payouts

**Fix**:
1. Limit date range to 30 days max
2. Process payouts in batches
3. Increase server memory allocation

## 📞 Support Resources

- **Shopify API Docs**: https://shopify.dev/docs/api/admin-rest/2024-10/resources/shopify-payments
- **Sage 50 Import Guide**: https://support.na.sage.com/
- **Issue Tracker**: [Your GitHub Issues URL]

## ✅ Final Verification

Before going live:

- [ ] Tested with 1 week of real payout data
- [ ] CSV successfully imported to Sage 50
- [ ] All journal entries balance correctly
- [ ] Cash account matches bank deposits
- [ ] Scheduler runs nightly without errors
- [ ] Logs are being written correctly
- [ ] Backup strategy implemented
- [ ] Monitoring alerts configured
- [ ] Documentation reviewed by accountant
- [ ] Training provided to finance team

---

**Ready for production!** 🎉

Your Sage 50 Journal Entry Sync app is now deployed and operational. Monitor the first few days closely to ensure everything runs smoothly.
