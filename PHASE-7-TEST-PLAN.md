# Phase 7: End-to-End Test Plan

## Test Environment Setup
- Shop: [Your Shopify store domain]
- Access: Admin API access token
- Date Range: Test with dates that have known order data
- Expected Data: January 29, 2026 reference data (if available)

## Test Scenarios

### 1. Single Order, Single Transaction ✅
**Scenario**: Simple order with one payment method

**Test Data**:
- Order with single credit card payment
- No refunds
- Single tax line
- Shipping included

**Expected Results**:
- Daily Sales Report: 1 row for order + totals row
- Payouts with Orders: 1 row for order
- Journal Entries: SO- entry (4-5 lines) + FEE- entries (2-4 lines) + PO- entries (2 lines)
- All files balance to $0.00

**Validation**:
- [ ] Daily Sales Report has 32 columns
- [ ] Payment method column populated correctly
- [ ] Tax breakdown shows title, rate, price
- [ ] Shipping address fields populated
- [ ] Transaction details match Shopify
- [ ] Totals row sums correctly
- [ ] Payouts file shows correct payout mapping
- [ ] Journal entries balance

---

### 2. Multiple Orders, Multiple Transactions ✅
**Scenario**: Multiple orders in same payout

**Test Data**:
- 3-5 orders with various payment methods
- Mix of cash, card, gift card payments
- Various tax configurations
- Different shipping addresses

**Expected Results**:
- Daily Sales Report: One row per order + totals
- Payouts with Orders: One row per order, same payout ID
- Journal Entries: Multiple SO- entries + consolidated FEE-/PO- entries

**Validation**:
- [ ] All orders included
- [ ] Payment methods correctly distributed
- [ ] Tax totals accurate
- [ ] Payout amounts reconcile
- [ ] No duplicate orders

---

### 3. Partially Refunded Order ✅
**Scenario**: Order with partial refund

**Test Data**:
- Order with $100 original sale
- $30 refund processed
- Remaining balance $70

**Expected Results**:
- Daily Sales Report: 2 rows (1 capture + 1 refund)
- SO- entry for $100 (original sale)
- RF- entry for $30 (refund)
- Net AR = $70

**Validation**:
- [ ] Both transactions show on report
- [ ] Refund amount in "Price: Total Refund" column
- [ ] SO- and RF- entries both present
- [ ] AR nets to $70 (not $100)
- [ ] Refund shown in 4900-00 account

---

### 4. Fully Refunded Order ✅ **CRITICAL**
**Scenario**: Order completely refunded (e.g., Order #80986)

**Test Data**:
- Order with $57.97 total
- Full refund of $57.97
- financial_status = "refunded"

**Expected Results**:
- Daily Sales Report: 2 rows (original sale + refund)
- SO-#80986: DR 1250-00 $57.97, CR 4000-00 $54.05, CR 2200-00 $3.92
- RF-#80986: DR 4900-00 $57.97, CR 1250-00 $57.97
- Net: AR = $0, Sales $54.05, Tax $3.92, Refunds $57.97

**Validation**:
- [ ] SO- entry MUST be generated (don't skip!)
- [ ] RF- entry present
- [ ] AR nets to $0.00
- [ ] Sales and Refunds shown separately (GAAP treatment)
- [ ] Journal entries balance

---

### 5. Split Payment Order ✅
**Scenario**: Order paid with multiple methods

**Test Data**:
- Order total $150
- $50 gift card
- $100 credit card
- All captured on same date

**Expected Results**:
- Daily Sales Report: 1 row with both payment columns populated
- GIFT CARD column: $50.00
- card field: $100.00
- Report date = latest capture date

**Validation**:
- [ ] Both payment amounts shown
- [ ] Report date matches latest capture
- [ ] Total = sum of payments
- [ ] SO- entry shows full order amount

---

### 6. Multiple Tax Lines ✅
**Scenario**: Order with state + county + city taxes

**Test Data**:
- State tax 6.5%
- County tax 1.5%
- City tax 0.5%
- Subtotal $100

**Expected Results**:
- Tax 1: State, 6.50%, $6.50
- Tax 2: County, 1.50%, $1.50
- Tax 3: City, 0.50%, $0.50
- Tax: Total $8.50

**Validation**:
- [ ] All 3 tax lines populated
- [ ] Rates formatted as percentages
- [ ] Prices accurate
- [ ] Tax total matches sum

---

### 7. Travel Give Aways (CHARGE Gateway) ✅
**Scenario**: Inventory write-off with Charge gateway

**Test Data**:
- Gateway: "Charge" (capital C)
- Amount: $25.00
- Should use placeholder account 9999-00

**Expected Results**:
- Daily Sales Report: CHARGE column populated
- Amount: $25.00
- GL Account: 9999-00 (placeholder)

**Validation**:
- [ ] CHARGE column shows amount
- [ ] Gateway correctly identified
- [ ] Separate from shopify_payments card transactions
- [ ] Journal entry uses correct account code

---

### 8. Cash and Check Payments ✅
**Scenario**: POS orders with cash/check

**Test Data**:
- Cash payment: $45.00
- Check payment: $75.00

**Expected Results**:
- CASH column: $45.00 (GL 1051-00)
- CHECK column: $75.00 (GL 1051-00)

**Validation**:
- [ ] CASH column populated
- [ ] CHECK column populated
- [ ] Both map to 1051-00 account
- [ ] Transaction details show gateway

---

### 9. Gift Card and Store Credit ✅
**Scenario**: Gift card and store credit payments

**Test Data**:
- Gift card: $30.00
- Store credit: $20.00

**Expected Results**:
- GIFT CARD column: $30.00 (GL 2320-00)
- STORE CREDIT column: $20.00 (GL 2320-00)

**Validation**:
- [ ] GIFT CARD column populated
- [ ] STORE CREDIT column populated
- [ ] Both map to 2320-00 liability account
- [ ] Separate from cash/check

---

### 10. No Shipping Order ✅
**Scenario**: POS or pickup order with no shipping

**Test Data**:
- Pickup order
- totalShipping = $0.00
- No shipping address

**Expected Results**:
- Price: Total Shipping = $0.00 (or blank)
- Shipping address fields empty
- SO- entry has no shipping line

**Validation**:
- [ ] No error on missing shipping
- [ ] Shipping columns empty/zero
- [ ] Journal entries still balance
- [ ] No shipping revenue line in SO-

---

### 11. Out-of-State Order (No Tax) ✅
**Scenario**: Order shipped out of state, no tax

**Test Data**:
- Out-of-state shipping address
- totalTax = $0.00
- No tax lines

**Expected Results**:
- Tax columns empty
- Tax: Total = $0.00
- SO- entry has no tax line

**Validation**:
- [ ] No error on missing tax
- [ ] Tax columns empty/zero
- [ ] Journal entries still balance
- [ ] No tax liability line in SO-

---

### 12. Edited Order ✅
**Scenario**: Order edited after creation

**Test Data**:
- Original: 3 items, $150
- Edited: Removed 1 item, $100
- Multiple captures in different payouts

**Expected Results**:
- Uses currentTotalPrice ($100)
- Uses currentSubtotalPrice for sales
- SO- entry reflects CURRENT state, not original

**Validation**:
- [ ] current_total_price used (not total_price)
- [ ] Removed items excluded
- [ ] Gross sales = current_subtotal + current_discounts
- [ ] Journal entries balance

---

### 13. Error Handling: Order Not Found ✅
**Scenario**: Balance transaction references non-existent order

**Test Data**:
- Balance transaction with sourceOrderId
- Order doesn't exist in Shopify (deleted?)

**Expected Results**:
- Warning in console
- Generic SO- entry created with balance transaction gross amount
- Export completes with warning

**Validation**:
- [ ] Export doesn't fail completely
- [ ] Warning logged
- [ ] Fallback journal entry created
- [ ] Other orders processed successfully

---

### 14. Error Handling: Enrichment Failure ✅
**Scenario**: Order enrichment API call fails

**Test Data**:
- Valid order ID
- API timeout or error during enrichOrderData()

**Expected Results**:
- Warning logged
- EnrichedTransaction created with minimal data
- Export continues
- File generated with partial data

**Validation**:
- [ ] Export completes (not aborted)
- [ ] Warning in logs
- [ ] Order included with available data
- [ ] Other orders unaffected

---

### 15. File Generation Errors ✅
**Scenario**: One file fails to generate

**Test Data**:
- Simulate error in daily sales report generator
- Other generators succeed

**Expected Results**:
- Daily Sales Report: error status in metadata
- Payouts with Orders: success
- Journal Entries: success
- Export marked as partial success

**Validation**:
- [ ] Export doesn't abort completely
- [ ] Error isolated to one file
- [ ] Other files download successfully
- [ ] UI shows error for failed file
- [ ] User can still get journal entries

---

### 16. Three-File Output Verification ✅
**Scenario**: All three files generate correctly

**Expected File Names**:
- `daily-sales-report_2026-01-29.csv`
- `payouts-with-orders_2026-01-29.txt`
- `journal-entries_2026-01-29.txt`

**Expected UI**:
- Success banner with 3 download links
- Daily Sales Report: "X transaction rows"
- Payouts with Orders: "X order rows"
- Journal Entry Summary: "X entries, ✓ balanced"

**Validation**:
- [ ] All 3 filenames correct
- [ ] All 3 files downloadable
- [ ] Row counts displayed
- [ ] Balanced status shown
- [ ] No errors in console
- [ ] Files saved to correct directory

---

### 17. Date Range Edge Cases ✅
**Scenario**: Capture date filtering

**Test Data**:
- Target date: 2026-01-29
- Payouts fetched from lookback/forward range
- Orders with captures on various dates

**Expected Results**:
- Only transactions captured on 2026-01-29 included
- Orders with captures on other dates excluded
- Files contain only target date data

**Validation**:
- [ ] Date filtering works correctly
- [ ] No orders from wrong dates
- [ ] Payout fetching uses correct range
- [ ] Balance transactions filtered by processedAt

---

### 18. Balance Validation ✅
**Scenario**: Verify all files balance to zero

**Test Data**:
- Any export with multiple orders

**Expected Results**:
- Journal Entries: Sum of signed amounts = $0.00
- Daily Sales Report: Totals row matches sum of data rows
- Payouts with Orders: Sum of "Net to Payout" = Payout Amount

**Validation**:
- [ ] Journal entries balance exactly
- [ ] Daily sales totals accurate
- [ ] Payout reconciliation matches
- [ ] No rounding errors > $0.02
- [ ] Warning if imbalanced

---

### 19. Performance Test ✅
**Scenario**: Large export with many orders

**Test Data**:
- 100+ orders in single payout
- Multiple payment methods
- Various refunds and edits

**Expected Results**:
- Export completes within reasonable time (<2 minutes)
- No memory errors
- All files generated successfully

**Validation**:
- [ ] Completes in < 2 minutes
- [ ] No timeout errors
- [ ] Memory usage reasonable
- [ ] All orders processed
- [ ] Files correct size

---

### 20. UI Integration Test ✅
**Scenario**: Full user workflow

**Test Steps**:
1. Navigate to Export Center
2. Select date (e.g., yesterday)
3. Click "Generate CSV"
4. Wait for completion
5. Verify success banner
6. Download all three files
7. Open files and verify contents
8. Check export history

**Expected Results**:
- Loading indicator during processing
- Success banner with 3 download links
- All files download successfully
- Export appears in history with 3 files
- No errors in browser console

**Validation**:
- [ ] UI responsive during processing
- [ ] Success banner shows all 3 files
- [ ] Downloads work correctly
- [ ] File metadata accurate
- [ ] Export history updated
- [ ] Legacy exports still work

---

## Regression Tests

### Legacy Compatibility ✅
**Test**: Ensure old exports still display
- [ ] Old exports with single file show correctly
- [ ] Download links work for legacy exports
- [ ] No errors loading export history

---

## Critical Path Testing Priority

**Priority 1 (Must Test)**:
- ✅ Fully refunded orders (SO- not skipped)
- ✅ Three-file generation
- ✅ Signed amount format
- ✅ Balance validation
- ✅ UI three-file display

**Priority 2 (Should Test)**:
- ✅ Multiple payment methods
- ✅ Tax breakdown
- ✅ Refund handling
- ✅ Error isolation

**Priority 3 (Nice to Test)**:
- ✅ Performance with large datasets
- ✅ Edge cases (no tax, no shipping)
- ✅ Legacy compatibility

---

## Test Data Sources

### Shopify Admin API Endpoints
- `GET /admin/api/2024-10/orders/{orderId}.json` - Order details
- `GET /admin/api/2024-10/shopify_payments/balance/transactions.json` - Balance transactions
- `GET /admin/api/2024-10/shopify_payments/payouts.json` - Payouts

### Reference Data
- January 29, 2026 export (if available)
- Known order IDs for testing scenarios
- Expected journal entry totals

---

## Bug Tracking

### Known Issues
- None currently

### Potential Issues to Watch
1. **Payment method mapping edge cases**
   - What if gateway value is unexpected?
   - What if payment_method is null?

2. **Date handling**
   - Timezone issues?
   - Capture date vs transaction date discrepancies?

3. **Large file performance**
   - Memory usage with 1000+ orders?
   - CSV generation speed?

4. **Error recovery**
   - What if Shopify API rate limit hit?
   - What if file write fails?

---

## Success Criteria

Export is considered successful if:
- ✅ All 3 files generated without errors
- ✅ Journal entries balance to $0.00 (within $0.02 tolerance)
- ✅ Daily Sales Report totals row matches sum
- ✅ Payouts with Orders reconciles to payout amount
- ✅ SO- entries generated for fully-refunded orders
- ✅ UI displays all 3 download links
- ✅ Files downloadable and properly formatted
- ✅ No console errors
- ✅ Performance acceptable (<2 minutes for 100 orders)

---

## Next Steps After Testing

1. Document any bugs found
2. Fix critical issues
3. Retest fixed issues
4. Update this test plan with results
5. Proceed to Phase 8 (Documentation & Deployment)

---

*Test Plan Version: 1.0*
*Created: 2026-02-22*
*Status: Ready for Testing*
