# Sage 50 Journal Entry Sync - User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Generating Exports](#generating-exports)
3. [Understanding the Three Files](#understanding-the-three-files)
4. [Importing into Sage 50](#importing-into-sage-50)
5. [Common Workflows](#common-workflows)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Accessing the App

1. Log into your Shopify Admin
2. Navigate to **Apps** in the left sidebar
3. Click on **Sage 50 Journal Entry Sync**
4. You'll land on the dashboard showing recent exports

### Prerequisites

Before generating your first export, ensure:
- ✅ Shopify Payments is enabled on your store
- ✅ You have payouts set up and receiving
- ✅ Your Sage 50 chart of accounts is configured
- ✅ Account mappings are set in the app (Settings > Account Mappings)

---

## Generating Exports

### Manual Export (Recommended for First Time)

1. Click on **Export Center** in the app navigation
2. Select a date using the date picker
   - **Important**: This is the **capture date** (when payment was captured, not when order was created)
   - For most orders, this is the fulfillment date
   - For POS/cash orders, this is the order creation date
3. Click **Generate CSV**
4. Wait for processing (typically 10-30 seconds)
5. Download all three files when the success banner appears

### What Date Should I Choose?

**Golden Rule**: Choose the date when the **payment was captured**, not when the order was created.

| Order Type | Capture Date |
|------------|--------------|
| Online order (fulfilled) | Date shipped/fulfilled |
| POS order | Same as order date |
| Cash/check payment | Same as order date |
| Gift card payment | Same as order date |
| Partially fulfilled | Date of first fulfillment |

**Pro Tip**: The Shopify order page shows "Captured" date under Payment section. Use this date!

### Automated Exports (Optional)

1. Go to **Settings** in the app
2. Enable **Sync Enabled**
3. Choose **Sync Schedule**: `nightly`
4. Set **Scheduled Time**: e.g., `02:00` (2:00 AM)
5. Choose **Auto Export Date**: `yesterday`
6. Click **Save Settings**

The app will automatically generate exports every night for the previous day's captures.

---

## Understanding the Three Files

Each export generates **three comprehensive files**. Here's what each one is for:

### File #1: Daily Sales Report
**Filename**: `daily-sales-report_2026-01-29.csv`

**When to Use**:
- Validating journal entries with your bookkeeping team
- Understanding which payment methods were used
- Breaking down taxes by jurisdiction
- Reviewing shipping addresses for out-of-state orders
- Auditing transaction capture dates

**What's Inside**:
32 columns of transaction-level detail including:
- Order name and tags
- Tax lines (up to 3) with title, rate, and amount
- Payment method breakdown (CASH, CHARGE, GIFT CARD, STORE CREDIT, CHECK, card)
- Shipping address (address, city, zip)
- Transaction details (kind, date, amount, gateway)
- Fulfillment and payment status
- **Totals row** at the bottom for verification

**Key Features**:
- One row per transaction (captures and refunds are separate)
- Totals row sums all key columns
- Shows both original sale AND refunds (separate rows)

**Example Use Case**:
> Your bookkeeper asks: "How much of yesterday's sales were paid by gift cards?"
>
> Answer: Open Daily Sales Report → Look at GIFT CARD column → See the totals row

### File #2: Payouts with Orders
**Filename**: `payouts-with-orders_2026-01-29.txt`

**When to Use**:
- Reconciling bank deposits to Shopify payouts
- Understanding which orders contributed to a specific payout
- Tracing a payout back to source orders
- Verifying payout amounts match order totals

**What's Inside**:
7 columns showing the payout-to-order relationship:
- Payout ID (e.g., `po_123456`)
- Payout Date (when it hit your bank)
- Payout Amount (total bank deposit)
- Order Name (e.g., `#1001`)
- Order Date (when order was created)
- Order Total (original order amount)
- Net to Payout (amount from this order that went into the payout, after fees)

**Key Features**:
- Flat structure (one row per order)
- Every row shows which payout it belongs to
- Net to Payout accounts for Shopify fees

**Example Use Case**:
> Your bank statement shows a deposit of $1,523.45 on 1/17/2026.
>
> Question: "Which orders made up this payout?"
>
> Answer: Open Payouts with Orders → Filter by Payout Date 1/17/2026 → See list of all orders

### File #3: Journal Entry Summary
**Filename**: `journal-entries_2026-01-29.txt`

**When to Use**:
- Importing into Sage 50 accounting software
- Verifying entries balance correctly
- Understanding the accounting treatment of each transaction

**What's Inside**:
5 columns in Sage 50 format:
- Date (MM/DD/YYYY)
- Reference (SO-order, RF-order, FEE-txn, PO-payout)
- Account (GL account code from your chart of accounts)
- Amount (signed: positive=debit, negative=credit)
- Memo (description of the entry)

**Key Features**:
- **Balanced to $0.00**: Sum of all amounts = zero (debits offset credits)
- **Signed amounts**: Positive numbers are debits, negative are credits
- **GAAP-compliant**: Gross sales and refunds shown separately (not netted)

**Example Use Case**:
> You need to import yesterday's sales into Sage 50.
>
> Steps:
> 1. Download Journal Entry Summary file
> 2. Open Sage 50
> 3. Go to Tasks → General Journal Entry → Import
> 4. Select the journal-entries file
> 5. Verify entries balance
> 6. Post to ledger

---

## Importing into Sage 50

### Step-by-Step Import Process

#### 1. Open Sage 50
- Launch Sage 50 Accounting
- Open your company file
- Log in with permissions to post journal entries

#### 2. Navigate to Journal Entry Import
- Go to **Tasks** menu
- Select **General Journal Entry**
- Click **Import** button

#### 3. Select Import File
- Click **Browse**
- Navigate to your downloads folder
- Select the `journal-entries_YYYY-MM-DD.txt` file
- Click **Open**

#### 4. Review Import Preview
Sage 50 will show a preview of the entries:
- ✅ Verify the date range matches your export
- ✅ Check that total debits = total credits (balanced)
- ✅ Review account codes are correct
- ✅ Scan for any error indicators

#### 5. Post Entries
- If preview looks correct, click **Post**
- Sage 50 will import all entries to the General Ledger
- Confirmation message will appear

#### 6. Verify in Ledger
- Go to **Reports** → **General Ledger**
- Filter by date range
- Verify entries posted correctly
- Check clearing account (1250-00) balances to zero

### Common Import Issues

**Issue**: "Account not found"
- **Cause**: GL account code in export doesn't exist in your Sage 50 chart
- **Solution**: Go to app Settings → Account Mappings → Update account codes to match your Sage 50 chart

**Issue**: "Entries don't balance"
- **Cause**: Rare rounding error or data issue
- **Solution**: Check app for error messages during export. Contact support if persistent.

**Issue**: "Duplicate transaction reference"
- **Cause**: Trying to import the same file twice
- **Solution**: Sage 50 prevents duplicates. Delete previous entries first, or skip import.

---

## Common Workflows

### Daily Bookkeeping Routine

**Goal**: Import yesterday's sales into Sage 50 every morning

**Steps**:
1. Open Sage 50 Journal Entry Sync app (9:00 AM)
2. Click **Export Center**
3. Date picker should default to yesterday → Click **Generate CSV**
4. Download all three files:
   - Daily Sales Report (for your records)
   - Payouts with Orders (for reconciliation)
   - Journal Entry Summary (for Sage 50 import)
5. Open Sage 50 → Import journal entries file
6. File Daily Sales Report in Google Drive/Dropbox for audit trail
7. Done! (Takes ~5 minutes)

### Monthly Reconciliation

**Goal**: Ensure all payouts for the month are accounted for

**Steps**:
1. Export bank statement for the month
2. List all Shopify payout deposits from statement
3. For each payout date:
   - Generate export for that date
   - Download Payouts with Orders file
   - Verify payout amount matches bank deposit
4. Reconcile any discrepancies (fees, chargebacks, etc.)
5. Import all journal entries into Sage 50
6. Run Trial Balance report to verify everything balances

### Handling Refunds

**Goal**: Properly account for refunded orders

**Important**: The app handles refunds automatically using GAAP best practices.

**What Happens**:
1. **Original Sale** (Order #1001 for $100):
   - SO-#1001: Debit AR $100, Credit Sales $100

2. **Full Refund** (Order #1001 refunded $100):
   - RF-#1001: Debit Refunds $100, Credit AR $100
   - **Result**: Sales stays at $100, Refunds at $100, AR nets to $0

**In the Files**:
- **Daily Sales Report**: Two rows (one for sale, one for refund)
- **Journal Entries**: Both SO- and RF- entries present
- **Outcome**: Sales and Refunds shown separately on P&L (proper GAAP treatment)

**You Don't Need To**:
- ❌ Skip fully refunded orders
- ❌ Net sales against refunds manually
- ❌ Create separate refund entries

The app does this automatically!

### End-of-Year Tax Preparation

**Goal**: Provide complete transaction records to accountant

**Steps**:
1. Generate exports for each day of the year (can be scripted)
2. Compile all Daily Sales Report files
3. Create Excel summary:
   - Total sales by month
   - Total refunds by month
   - Sales tax collected by jurisdiction
   - Payment method breakdown
4. Provide to accountant along with:
   - Sage 50 General Ledger report
   - Bank statements
   - Shopify Payments payout statements

### Auditing a Specific Order

**Goal**: Find all accounting entries for a specific order

**Steps**:
1. In Shopify Admin, find the order → Note capture date
2. In app, generate export for that capture date
3. Open **Daily Sales Report** → Search for order number
4. Review transaction details, payment method, taxes
5. Open **Journal Entry Summary** → Search for `SO-OrderNumber`
6. Verify journal entries match order totals
7. If refunded, also look for `RF-OrderNumber`

---

## Troubleshooting

### Export Fails to Generate

**Symptoms**: Error message after clicking "Generate CSV"

**Common Causes**:
1. **No payouts found for date range**
   - Solution: Choose a different date with known payouts
   - Verify Shopify Payments is active

2. **Shopify API rate limit exceeded**
   - Solution: Wait 5 minutes, try again
   - Don't generate multiple exports simultaneously

3. **Network connectivity issue**
   - Solution: Check internet connection, retry

### Files Don't Balance

**Symptoms**: Journal entries total ≠ $0.00

**Diagnostic Steps**:
1. Check app for warning messages during export
2. Open Daily Sales Report → Verify totals row matches sum of data
3. Look for orders with missing data (no tax, no shipping)
4. Check for edited orders (removed line items after capture)

**Solution**:
- Usually self-corrects on next export
- If persistent, contact support with export date and error message

### Missing Orders in Export

**Symptoms**: Order shows in Shopify but not in export

**Common Causes**:
1. **Wrong date selected**
   - Solution: Use capture date, not order date
   - Check Shopify order page for "Captured" timestamp

2. **Order not captured yet**
   - Solution: Orders must be fulfilled/captured before appearing
   - Draft orders and authorized (but not captured) cards won't appear

3. **Order in different payout**
   - Solution: Capture dates can span multiple payouts
   - Check neighboring dates

### Payment Method Not Showing

**Symptoms**: CASH or CHECK column empty when you know you had cash sales

**Diagnostic Steps**:
1. Open Daily Sales Report
2. Find the order in question
3. Check "Transaction: Gateway" column
4. Verify gateway matches expected value

**Solution**:
- If gateway is unexpected, check Shopify POS settings
- Some custom payment methods may map differently
- Update payment method mapping logic if needed

### Sage 50 Import Errors

See [Importing into Sage 50](#importing-into-sage-50) section above for common import issues.

---

## Best Practices

### Daily Workflow
- ✅ Generate exports first thing in the morning
- ✅ Import into Sage 50 before starting daily work
- ✅ Keep Daily Sales Report files for audit trail (min 7 years)
- ✅ Reconcile bank deposits weekly

### File Management
- ✅ Create organized folder structure:
  ```
  /Accounting/Shopify Exports/
    /2026/
      /01-January/
        daily-sales-report_2026-01-15.csv
        payouts-with-orders_2026-01-15.txt
        journal-entries_2026-01-15.txt
      /02-February/
        ...
  ```
- ✅ Use descriptive filenames (already done by app)
- ✅ Back up export files to cloud storage

### Quality Control
- ✅ Always verify "balanced" indicator in UI before downloading
- ✅ Spot-check totals in Daily Sales Report
- ✅ Reconcile payout amounts to bank statements monthly
- ✅ Review refund entries for accuracy

### Communication with Bookkeeper
- ✅ Share Daily Sales Report with bookkeeper for validation
- ✅ Provide Payouts with Orders for reconciliation questions
- ✅ Only send Journal Entry Summary to Sage 50 operator

---

## Getting Help

### In-App Support
- Check error messages in the app interface
- Review app logs (Settings → View Logs)
- Look for warnings during export generation

### Documentation
- This User Guide
- README.md (technical overview)
- PHASE-7-TEST-PLAN.md (testing scenarios)
- IMPLEMENTATION-SUMMARY.md (system architecture)

### Contact Support
If you encounter persistent issues:
1. Note the export date that failed
2. Screenshot any error messages
3. Provide steps to reproduce
4. Contact: support@four13.co

---

## Appendix: GL Account Reference

### Standard Account Mappings

| Account Code | Account Name | Type | Used For |
|--------------|--------------|------|----------|
| 1000-00 | Cash - Shopify Account | Asset | Bank deposits (payouts) |
| 1051-00 | Cash on Hand | Asset | Cash and check payments |
| 1061-00 | Shopify Payments | Asset | Credit card clearing |
| 1250-00 | Shopify Clearing Account | Asset | Temporary clearing account |
| 2200-00 | Sales Tax Payable | Liability | Sales tax collected |
| 2320-00 | Gift Card Liability | Liability | Gift cards and store credit |
| 4000-00 | Sales Revenue | Revenue | Product sales |
| 4050-00 | Discounts Given | Contra-Revenue | Discounts and promotions |
| 4100-00 | Shipping Revenue | Revenue | Shipping charges |
| 4900-00 | Sales Returns & Refunds | Contra-Revenue | Customer refunds |
| 6100-00 | Payment Processing Fees | Expense | Gateway fees (Stripe, etc.) |
| 6110-00 | Shopify Transaction Fees | Expense | Shopify platform fees |
| 9999-00 | Travel Give Aways (TBD) | Expense | Placeholder for inventory write-offs |

### Customizing Account Mappings

To change account codes to match your Sage 50 chart:

1. Go to **Settings** → **Account Mappings**
2. Update each account code to match your chart
3. Click **Save Mappings**
4. Generate a test export to verify
5. Check that Sage 50 import recognizes all accounts

**Important**: Only change account codes, not account types or purposes. The app relies on these mappings for correct journal entries.

---

**User Guide Version**: 1.0
**Last Updated**: February 23, 2026
**App Version**: 2.0 (Multi-File Export System)
