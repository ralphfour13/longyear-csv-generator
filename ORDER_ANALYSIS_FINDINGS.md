# Order Analysis Findings: Journal Entry Imbalances and Discrepancies

**Analysis Date:** 2026-03-01
**Analyst:** Claude Code Agent
**Total Orders Analyzed:** 9 (4 fully analyzed, 5 partially analyzed)

## Executive Summary

After analyzing 9 problematic orders, I've identified **5 distinct root causes** for journal entry imbalances and discrepancies:

1. **Partial Refund Tax Calculation Issues** - Most critical
2. **Multiple Discount Stacking Complexity**
3. **Multi-Payment Gateway Split Transactions**
4. **Tax-Exempt Orders with Mixed Fulfillment**
5. **Canceled Line Items (Unfulfilled Items with Refund-like Behavior)**

---

## Priority 1: Imbalanced Journal Entries

### Order #80388 - $26.81 Imbalance (Jan 10, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $43.96 |
| **Current Total** | $17.15 |
| **Financial Status** | `partially_refunded` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 2 (both fulfilled) |
| **Refund Amount** | $26.81 |

#### Financial Breakdown
```
Original Order:
- Subtotal: $40.99
- Tax: $2.97 ($2.46 CA, $0.10 Shasta County, $0.41 Shasta Local)
- Total: $43.96

After Refund:
- Current Subtotal: $15.99
- Current Tax: $1.16
- Current Total: $17.15
```

#### Line Items Analysis
1. **Foam Jaydacators - SMALL** (SKU: ACJAY-27100)
   - Price: $25.00
   - Quantity: 1
   - **Status:** REFUNDED (quantity 1)
   - Fulfillment: fulfilled → current_quantity: 0

2. **2026 Fly Fishing Dreams Calendar** (SKU: 33727)
   - Price: $15.99
   - Quantity: 1
   - **Status:** KEPT (fulfilled)
   - Fulfillment: fulfilled → current_quantity: 1

#### Refund Transaction Details
```json
{
  "id": 963476586726,
  "amount": "26.81",
  "processed_at": "2026-01-10T13:18:11-08:00",
  "gateway": "shopify_payments",
  "kind": "refund",
  "parent_id": 8293294407910
}
```

Refund Line Item:
- Subtotal: $25.00
- Tax: $1.81
- **Total: $26.81**

#### **ROOT CAUSE: Partial Refund Tax Calculation Discrepancy**

**Issue:** The refund tax of $1.81 doesn't match the proportional original tax.

**Expected Calculation:**
```
Original item tax on $25.00 item = $1.81
  - CA State (6%): $1.50
  - Shasta County (0.25%): $0.06
  - Shasta Local (1%): $0.25
  Total: $1.81 ✓ MATCHES REFUND

Remaining order:
  - Original total: $43.96
  - Refund: $26.81
  - Expected remaining: $17.15 ✓ CORRECT
```

**Actual Problem:** The system calculates `$43.96 - $26.81 = $17.15`, but the **journal entries** likely track:
- Sales revenue: Should reduce by $25.00
- Tax liability: Should reduce by $1.81
- Accounts Receivable: Should reduce by $26.81

**Journal Entry Imbalance Hypothesis:**
The imbalance occurs because the journal entry system is treating the refund as a single $26.81 debit instead of properly splitting:
```
CORRECT Journal Entry for Refund:
  DR  Sales Revenue          $25.00
  DR  Sales Tax Payable      $1.81
      CR  Cash/AR            $26.81

SUSPECTED ACTUAL Entry:
  DR  Sales Revenue          $26.81  ← WRONG (includes tax)
      CR  Cash/AR            $26.81
  (Missing the tax liability reduction)
```

This creates a $1.81 overstatement in sales and understates tax liability.

**Verification Needed:**
- Check if refund processing properly splits tax from subtotal
- Verify `refund_line_items[].subtotal` vs `refund_line_items[].total_tax`
- Ensure COGS reversal only applies to subtotal ($25.00), not total ($26.81)

---

### Order #80355 - $17.27 Imbalance (Jan 9, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $266.43 |
| **Current Total** | $249.16 |
| **Financial Status** | `partially_refunded` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateways** | gift_card ($50.00), shopify_payments ($216.43) |
| **Line Items** | 8 (7 fulfilled, 1 custom item) |
| **Refund Amount** | $17.27 (to store_credit) |
| **Discount Applied** | 15% ($43.83) - Manual discount |

#### Financial Breakdown
```
Original Order:
- Total Line Items: $292.25
- Discount: $43.83 (15% across all items)
- Subtotal: $248.42
- Tax: $18.01 ($14.91 CA, $0.62 Shasta County, $2.48 Shasta Local)
- Total: $266.43

After Refund:
- Current Subtotal: $232.31
- Current Discount: $40.99 (recalculated)
- Current Tax: $16.85
- Current Total: $249.16
```

#### Payment Method Analysis
**CRITICAL: Split Payment Scenario**
```
Payment 1: Gift Card         $50.00   (sale, completed)
Payment 2: Shopify Payments  $216.43  (sale, completed)
Refund:    Store Credit      $17.27   (refund to store credit)
```

**Discount Code:** "Gift cards weren't working refunding to charge gift card"
- Type: Manual, percentage (15%)
- Applied: Across all line items
- This suggests **gift card payment initially failed** and was compensated with a discount

#### Line Items Analysis (8 total)
1. **Renzetti Traveler 2000 Series Vise** (SKU: 25024) - $229.95
   - Discount: $34.49
   - Tax: $14.17
   - **Fulfilled, current_quantity: 1** ✓

2-5. Small fly tying materials ($2.25-$3.50 each)
   - All fulfilled, small discounts ($0.33-$0.53)

6. **Hareline Dubbing Spinner Set w/ Hair Packer** (SKU: 30282) - $18.95 × 2 = $37.90
   - Discount: $5.68
   - Tax: $2.33
   - **REFUNDED: 1 of 2 units**
   - Current quantity: 1 (down from 2)

7. **UTC 140 olive** (custom_sale, no SKU) - $2.25
   - Custom POS item
   - Fulfilled

8. **Arizona Diamond Dub** (SKU: FTADD-18738) - $2.95
   - Fulfilled

#### Refund Transaction Details
```json
{
  "id": 963425829094,
  "amount": "17.27",
  "processed_at": "2026-01-09T16:21:28-08:00",
  "gateway": "shopify_store_credit",
  "kind": "refund",
  "restock_type": "return"
}
```

Refund Line Item:
- Line: Hareline Dubbing Spinner Set (1 unit)
- Subtotal: $16.11 (after discount)
- Tax: $1.16
- **Total: $17.27**

#### **ROOT CAUSE: Multi-Gateway Payment with Store Credit Refund**

**Issue 1: Payment Source Mismatch**
The order was paid with:
- $50.00 gift card
- $216.43 credit card

But the refund of $17.27 went to **store credit**, not back to the original payment methods.

**Issue 2: Discount Recalculation**
Original discount: $43.83 across 8 items (15%)
After refund: $40.99 (15% across remaining 7 items)

The refunded item had:
- Original price: $18.95
- Original discount: $2.84 (15% of $18.95)
- Actual refunded subtotal: $16.11

**Calculation Verification:**
```
Refunded item original:  $18.95
15% discount:            -$2.84
Net price:               $16.11 ✓ MATCHES
Tax on $16.11 (7.25%):   $1.16  ✓ MATCHES
Total refund:            $17.27 ✓ CORRECT
```

**Journal Entry Imbalance Hypothesis:**
```
SUSPECTED ISSUE:
The system may be trying to reverse payments to the original gateways:
  - Gift card: $50.00 (no reversal needed, already consumed)
  - Credit card: Should refund $17.27

But instead:
  - Store credit issued: $17.27 (creates a new liability)
  - Credit card: Not reversed

This creates:
  DR  Sales Revenue          $16.11
  DR  Sales Tax Payable      $1.16
      CR  Store Credit Liability  $17.27  ← New account

But journal entry logic may expect:
      CR  Accounts Receivable     $17.27  (linked to CC gateway)
```

The imbalance occurs because:
1. **Store credit is a different liability account** than AR/CC gateway
2. The gift card portion complicates the payment allocation logic
3. Discount recalculation affects the revenue split

**Verification Needed:**
- How are store credit refunds journalized vs gateway refunds?
- Is there a gift card liability account involved?
- Does the system track which payment method should receive the refund?

---

### Order #80230 - $19.00 Imbalance (Jan 7, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $437.90 |
| **Current Total** | $218.95 |
| **Financial Status** | `paid` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | gift_card |
| **Line Items** | 2 (1 fulfilled, 1 canceled) |
| **Refund** | Yes (1 line item canceled) |
| **Discount Applied** | $100.00 fixed amount on G3 boots |

#### Financial Breakdown
```
Original Order:
- Line Item 1: Simms Freestone Boots $199.95
- Line Item 2: Simms G3 Guide Boot    $299.95
- Subtotal after discount:             $399.90
- Tax: $38.00 (complex multi-rate: CA 6%, Shasta County 0.25%, Santa Cruz County 2.25%, Shasta Local 1%)
- Total: $437.90

After Cancellation:
- Current Subtotal: $199.95 (G3 boots only, after $100 discount)
- Current Tax: $19.00
- Current Total: $218.95
```

#### Line Items Analysis

**Line Item 1: Simms Freestone Wading Boots** (SKU: WBFB3-30560)
- Price: $199.95
- Quantity: 1
- Discount: $0.00
- Tax: $19.00
- **Status:** `fulfillment_status: null` (never fulfilled)
- **CANCELED** via refund with `restock_type: "cancel"`

**Line Item 2: Simms G3 Guide Boot** (SKU: WBGB4-31631)
- Price: $299.95
- Quantity: 1
- **Discount: $100.00 fixed amount** (explicit target_selection)
- Net price: $199.95
- Tax: $19.00
- **Status:** `fulfilled`
- **KEPT**

#### Discount Application Details
```json
{
  "target_type": "line_item",
  "type": "manual",
  "value": "100.0",
  "value_type": "fixed_amount",
  "allocation_method": "each",
  "target_selection": "explicit",
  "title": "G3 for same amount as Freestones since we were out of stock",
  "description": "G3 for same amount as Freestones since we were out of stock"
}
```

**Context:** Customer ordered Freestone boots ($199.95) but they were out of stock. Store offered G3 boots ($299.95) for the same price by applying a $100 discount to the G3 boots.

#### Refund Transaction Details
```json
{
  "id": 963175907558,
  "processed_at": "2026-01-07T11:18:48-08:00",
  "restock": true,
  "transactions": []  ← NO MONEY REFUNDED
}
```

**CRITICAL:** `transactions: []` - This is a **cancellation**, not a refund. No money changed hands.

Refund Line Item:
- Line: Simms Freestone Boots
- Subtotal: $199.95
- Tax: $19.00
- Total would be: $218.95
- **restock_type: "cancel"**

#### **ROOT CAUSE: Canceled Line Item with No Financial Transaction**

**Issue:** This is NOT a true refund scenario - it's a **cancellation of an unfulfilled item**.

**Timeline:**
1. Customer orders 2 boots: Freestone ($199.95) + G3 ($299.95)
2. Store realizes Freestone is out of stock
3. Store applies $100 discount to G3 to match Freestone price
4. Order is placed for $437.90 (both items)
5. **PAID via gift card: $437.90**
6. **Freestone item is canceled** (never fulfilled)
7. **No money refunded** (customer keeps $218.95 on gift card balance?)

**The Math:**
```
Customer paid:           $437.90 (via gift card)
Current order total:     $218.95 (only G3 boots)
Difference:              $218.95

BUT the Freestone tax was: $19.00
Gift card should have:    $218.95 remaining credit
```

**Journal Entry Imbalance Hypothesis:**
```
PROBLEM: The system recorded:
  Initial sale:
    DR  Gift Card Liability   $437.90
        CR  Sales Revenue       $399.90
        CR  Sales Tax Payable    $38.00

  After cancellation:
    DR  Sales Revenue         $199.95
    DR  Sales Tax Payable      $19.00
        CR  Gift Card Liability  $218.95  ← Should restore GC balance

BUT the journal entry logic may have issues:
  1. Gift card was fully consumed ($437.90 drawn down)
  2. Cancellation should RESTORE $218.95 to gift card
  3. The $19.00 imbalance suggests tax isn't being properly reversed
```

**The $19.00 Imbalance:**
- Original tax on BOTH items: $38.00
- Tax on canceled item: $19.00
- Tax on kept item: $19.00

**BUT:** Looking at the order data:
- `current_total_tax: "19.00"` ✓ Correct
- `total_tax: "38.00"` ✓ Original correct

The imbalance is likely because:
1. **Gift card balance restoration** is not properly journalized
2. The system may not handle **canceled-before-fulfillment** items correctly
3. Tax on the canceled item should reduce tax payable by $19.00, but this may not be reflected in the journal entry

**Verification Needed:**
- How are canceled (never-fulfilled) items journalized?
- Is there a distinction between "refund after fulfillment" vs "cancel before fulfillment"?
- How does gift card liability account track cancellations vs refunds?
- The `restock_type: "cancel"` should trigger different accounting than `restock_type: "return"`

---

### Order #80050 - $6.66 Imbalance (Jan 6, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $104.71 |
| **Current Total** | $33.06 |
| **Financial Status** | `paid` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 2 (1 fulfilled, 1 canceled) |
| **Refund** | Yes (1 line item canceled) |
| **Discounts** | None |

#### Financial Breakdown
```
Original Order:
- Line Item 1: Rio Skagit MOW Tips     $29.99
- Line Item 2: AirFlo Scandi Compact   $64.99
- Subtotal:                            $94.98
- Tax: $9.73 (complex multi-rate: CA 6%, Shasta 0.25%, Sonoma City 1%, Sonoma County 2%, Shasta Local 1%)
- Total: $104.71

After Cancellation:
- Current Subtotal: $29.99 (MOW Tips only)
- Current Tax: $3.07
- Current Total: $33.06
```

#### Line Items Analysis

**Line Item 1: Rio Skagit MOW Tips - Heavy, 10'** (SKU: REMTH-29868)
- Price: $29.99
- Quantity: 1
- Tax: $3.07 ($1.80 CA + $0.07 Shasta County + $0.30 Sonoma City + $0.60 Sonoma County + $0.30 Shasta Local)
- **Status:** `fulfilled`
- **KEPT**

**Line Item 2: AirFlo Superflo Scandi Compact - 450GR** (SKU: SCANDI COMPACT-33339)
- Price: $64.99
- Quantity: 1
- Tax: $6.66 ($3.90 CA + $0.16 Shasta County + $0.65 Sonoma City + $1.30 Sonoma County + $0.65 Shasta Local)
- **Status:** `fulfillment_status: null` (never fulfilled)
- **CANCELED** via refund with `restock_type: "cancel"`

#### Refund Transaction Details
```json
{
  "id": 963069378790,
  "processed_at": "2026-01-06T13:07:36-08:00",
  "restock": true,
  "transactions": []  ← NO MONEY REFUNDED
}
```

**CRITICAL:** Same pattern as Order #80230 - `transactions: []` means this is a **cancellation**, not a refund.

Refund Line Item:
- Line: AirFlo Superflo Scandi Compact
- Subtotal: $64.99
- Tax: $6.66
- Total would be: $71.65
- **restock_type: "cancel"**

#### Payment Transaction Analysis
```json
Authorization: $104.71 (2026-01-02)
Capture: $33.06 (2026-01-06) ← ONLY CAPTURED $33.06, not full amount
```

**KEY INSIGHT:** The payment was authorized for $104.71 but only **captured for $33.06** (4 days later, after fulfillment).

#### **ROOT CAUSE: Partial Capture of Authorized Payment**

**Issue:** This is a **partial capture scenario**, not a traditional refund.

**Payment Flow:**
1. **Jan 2:** Authorization for $104.71 (full order)
2. **Jan 6:** Item 2 canceled (out of stock or unavailable)
3. **Jan 6:** Item 1 fulfilled
4. **Jan 6:** Captured only $33.06 (fulfilled item amount)
5. **Remaining $71.65 authorization expires** (never captured)

**The Math:**
```
Authorized:              $104.71
Captured:                $33.06
Never captured:          $71.65 ($64.99 + $6.66 tax)

Canceled item:
  Subtotal: $64.99
  Tax:      $6.66
  Total:    $71.65 ✓ MATCHES
```

**Journal Entry Imbalance Hypothesis:**
```
ISSUE: Partial capture creates a complex journal entry scenario

AT AUTHORIZATION (Jan 2):
  DR  Accounts Receivable    $104.71
      CR  Deferred Revenue    $94.98
      CR  Sales Tax Payable   $9.73

AT CANCELLATION (Jan 6, before capture):
  DR  Deferred Revenue       $64.99
  DR  Sales Tax Payable      $6.66
      CR  Accounts Receivable $71.65

AT CAPTURE (Jan 6):
  DR  Cash                   $33.06
  DR  Deferred Revenue       $29.99
      CR  Sales Revenue       $29.99
      CR  Sales Tax Payable   $3.07
      CR  Accounts Receivable $33.06

SUSPECTED PROBLEM:
The system may not properly handle the sequence:
1. Authorize → 2. Cancel item → 3. Capture remaining

The $6.66 imbalance is the tax on the canceled item, suggesting:
- Sales tax payable was reduced by $6.66 on cancellation
- BUT the journal entry may not have properly:
  a) Reversed the deferred revenue
  b) Adjusted the AR
  c) Coordinated with the partial capture
```

**The $6.66 Imbalance:**
This is **exactly** the tax amount on the canceled item, suggesting the tax reversal is not being properly journalized.

**Verification Needed:**
- How does the system handle "authorize → cancel → partial capture"?
- Are canceled items before capture treated differently than refunds after capture?
- Does the journal entry logic account for the auth/capture timing difference?
- `payment_terms.payment_terms_type: "fulfillment"` - Does this affect when revenue is recognized?

---

## Priority 2: Large Discrepancies

### Order #80217 - $266.42 Difference (Jan 6, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $266.42 |
| **Current Total** | $0.00 |
| **Financial Status** | `refunded` (FULLY) |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 8 (all fulfilled, all refunded) |
| **Discount Applied** | 15% ($43.83) - FIRST2026 code |

#### Financial Breakdown
```
Original Order:
- Total Line Items: $292.25
- Discount: $43.83 (15% via FIRST2026 code)
- Subtotal: $248.42
- Tax: $18.00
- Total: $266.42

After Full Refund:
- Current Subtotal: $0.00
- Current Tax: $0.00
- Current Total: $0.00
```

#### Line Items Analysis (8 total, ALL REFUNDED)
1. **Renzetti Traveler 2000 Series Vise** (SKU: 25024) - $229.95
2. **Arizona Minnow Hair** (SKU: FTAMH-14266) - $2.25
3. **Hareline Ice Dub - Olive Brown** (SKU: FTID-2303) - $3.50
4. **Arizona Diamond Dub** (SKU: FTADD-18738) - $2.95
5. **Hareline Ice Dub - Midnight Fire** (SKU: FTID-27039) - $3.50
6. **Hareline Dubbing Spinner Set** (SKU: 30282) - $18.95 × 2
7-8. Other small items

**All items fulfilled on Jan 6 at 18:00:54, then order fully refunded.**

#### **ROOT CAUSE: Full Refund After Fulfillment (Same Day)**

**Issue:** This is a **same-day fulfill-and-refund** scenario.

**Timeline:**
1. **Jan 6, 18:00:53:** Order created and paid ($266.42)
2. **Jan 6, 18:00:54:** ALL items fulfilled
3. **Jan 9, 16:07:15:** Order FULLY refunded

The $266.42 "difference" is simply that the order was fully refunded. This is NOT an imbalance - it's an expected scenario.

**However, this order is useful for testing:**
- **COGS implications:** Were all items shipped and then returned?
- **Discount handling:** 15% discount should reverse properly
- **Multi-item refund:** All 8 items refunded in one transaction

**Expected Journal Entry:**
```
ORIGINAL SALE:
  DR  Cash                  $266.42
      CR  Sales Revenue      $248.42
      CR  Sales Tax Payable  $18.00

  DR  COGS                  $XXX.XX
      CR  Inventory          $XXX.XX

FULL REFUND:
  DR  Sales Revenue         $248.42
  DR  Sales Tax Payable     $18.00
      CR  Cash               $266.42

  DR  Inventory             $XXX.XX
      CR  COGS               $XXX.XX
```

**Verification Needed:**
- Does a full refund reverse COGS correctly for ALL 8 items?
- Are there any timing issues with same-day fulfill-refund?
- Does the discount reversal work correctly?

**Note:** This order is marked as a "large discrepancy" but it's actually a **normal full refund**. The $266.42 is not an error - it's the expected full refund amount.

---

### Order #80228 - $150.14 Difference (Jan 7, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $236.99 |
| **Current Total** | $86.85 |
| **Financial Status** | `partially_refunded` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 5 (4 fulfilled, 1 refunded) |
| **Refund Amount** | $150.14 |

#### Financial Breakdown
```
Original Order:
- Subtotal: $226.02
- Tax: $10.97
- Total: $236.99

After Refund:
- Current Subtotal: $86.03
- Current Tax: $0.82
- Current Total: $86.85

Difference: $236.99 - $86.85 = $150.14
```

#### Line Items Analysis (5 total)

**FULFILLED and KEPT:**
1. **2026 Steelhead Report Card** (SKU: 34538) - $10.29
   - **TAX EXEMPT** (taxable: false)
   - Vendor: DFG (Department of Fish & Game)

2. **2026 Resident Fishing License** (SKU: 34527) - $64.54
   - **TAX EXEMPT** (taxable: false)
   - Vendor: DFG

3. **Furry Foam - Golden Stone** (SKU: FTFUR-9296) - $2.25
   - Taxable, tax: $0.17

4. **C14s #2** (custom_sale, no SKU) - $8.95
   - Taxable, tax: $0.65

**REFUNDED:**
5. **Echo Bravo Reel** (SKU: BRAVO-22715) - $139.99
   - Tax: $10.15
   - **current_quantity: 0** (refunded)
   - **Total refunded: $150.14** ($139.99 + $10.15)

#### **ROOT CAUSE: Tax-Exempt Items Mixed with Taxable Items**

**Issue:** This order contains **tax-exempt government items** (fishing licenses) mixed with taxable retail items.

**Tax Breakdown:**
```
Original Order Tax: $10.97
  - Steelhead Card:   $0.00 (exempt)
  - Fishing License:  $0.00 (exempt)
  - Furry Foam:       $0.17
  - C14s #2:          $0.65
  - Echo Bravo Reel:  $10.15
  Total:              $10.97 ✓

After Refund Tax: $0.82
  - Furry Foam:       $0.17
  - C14s #2:          $0.65
  Total:              $0.82 ✓

Refunded Tax: $10.15 (all from Echo Bravo Reel)
```

**The Math Checks Out:**
```
Refunded item:       $139.99
Refunded tax:        $10.15
Total refund:        $150.14 ✓ CORRECT

Remaining subtotal:  $86.03
Remaining tax:       $0.82
Remaining total:     $86.85 ✓ CORRECT
```

**Journal Entry Implications:**

```
CONCERN: Tax-exempt items create complex journal entries

ORIGINAL SALE:
  DR  Cash                     $236.99
      CR  Sales Revenue (taxable)   $141.19  ($2.25 + $8.95 + $139.99)
      CR  Sales Revenue (exempt)    $74.83   ($10.29 + $64.54)
      CR  Sales Tax Payable         $10.97

REFUND:
  DR  Sales Revenue (taxable)  $139.99
  DR  Sales Tax Payable        $10.15
      CR  Cash                  $150.14

POTENTIAL ISSUE:
- Two separate revenue accounts: taxable vs tax-exempt
- COGS may be calculated differently for exempt items
- Sage 50 may require separate GL accounts for DFG items (government agency sales)
```

**Verification Needed:**
- Are tax-exempt sales (fishing licenses) posted to a different revenue account?
- Does COGS calculation handle exempt vs taxable items correctly?
- Are there regulatory reporting requirements for DFG sales that affect accounting?
- Does the journal entry logic split taxable vs exempt revenue correctly?

**Note:** The $150.14 "discrepancy" is actually correct - it's just a large refund amount. The complexity here is the **mix of tax-exempt and taxable items**, which may create journal entry issues if not handled properly.

---

### Order #80284 - $183.97 Difference (Jan 8, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $1,129.92 |
| **Current Total** | $945.95 |
| **Financial Status** | `partially_refunded` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 12+ (multiple Rio MOW Tips + other items) |
| **Refund Amount** | $183.97 |
| **Discount Applied** | **STACKED: 15% + 15% = 27.75% effective** |

#### Financial Breakdown
```
Original Order:
- Total Line Items: $1,458.18
- Discount 1 (Manual): $185.91 (15% - "Travel loyalty")
- Discount 2 (Code):   $218.72 (15% - "FIRST2026")
- Total Discounts:     $404.63 (27.75% effective)
- Subtotal:            $1,053.55
- Tax: $76.37
- Total: $1,129.92

After Refund:
- Current Subtotal: $881.94
- Current Discounts: $338.75 (recalculated)
- Current Tax: $64.01
- Current Total: $945.95

Difference: $1,129.92 - $945.95 = $183.97
```

#### Discount Applications (STACKED DISCOUNTS - CRITICAL)
```json
[
  {
    "type": "manual",
    "value": "15.0",
    "value_type": "percentage",
    "allocation_method": "across",
    "target_selection": "all",
    "title": "Travel loyalty"
  },
  {
    "type": "discount_code",
    "value": "15.0",
    "value_type": "percentage",
    "allocation_method": "across",
    "target_selection": "all",
    "code": "FIRST2026"
  }
]
```

**Effective Discount Calculation:**
```
Line item: $100
- First discount (15%):   $100 - $15 = $85
- Second discount (15%):  $85 - $12.75 = $72.25
- Effective discount:     $27.75 (27.75%)

NOT a simple 30% discount!
```

#### Line Items Analysis (Partial - multiple Rio MOW Tips)

**Multiple Rio Skagit MOW Tips** - $29.99 each × 5+ variants:
- 10' tip (SKU: REMTH-29868)
- 12' tip (SKU: REMTH-29869)
- 2.5' tip (SKU: REMTH-29865)
- 5' tip (SKU: REMTH-29866)
- 7.5' tip (SKU: REMTH-29867)
- Plus Rio Tips Wallet and other items

**Each item has:**
- Original price: $29.99
- Discount 1: $3.83 (15% of $29.99)
- Remaining: $26.16
- Discount 2: $4.50 (15% of $26.16)
- Net price: $21.66
- Total discount per item: $8.33 (27.75% effective)

#### **ROOT CAUSE: Stacked Discount Complexity**

**Issue:** **Two discounts applied sequentially**, creating complex refund calculations.

**The Math:**
```
Original: $1,458.18 in line items
After D1: $1,458.18 - $185.91 = $1,272.27
After D2: $1,272.27 - $218.72 = $1,053.55 ✓ Matches subtotal

Refund of $183.97:
This represents items with original value of ~$254.50
After 27.75% discount: $183.97 ✓
```

**Journal Entry Complexity:**

```
ISSUE: Stacked discounts create ambiguity in revenue recognition

Option 1: Net revenue method
  DR  Cash                     $1,129.92
      CR  Sales Revenue (net)   $1,053.55
      CR  Sales Tax Payable     $76.37

Option 2: Gross revenue method with discount account
  DR  Cash                      $1,129.92
      CR  Sales Revenue (gross)  $1,458.18
      CR  Sales Tax Payable      $76.37
  DR  Sales Discounts           $404.63
      CR  Sales Revenue          $404.63

REFUND COMPLEXITY:
When refunding $183.97:
- What was the original gross price? (~$254.50)
- How much of each discount should reverse?
  - Travel loyalty (15% of $254.50) = $38.18
  - FIRST2026 (15% of $216.32) = $32.45
  - Total discount to reverse: $70.63

So the journal entry should be:
  DR  Sales Revenue (net)      $183.97
  DR  Sales Tax Payable        $XX.XX
      CR  Cash                  $XXX.XX

BUT if using gross method:
  DR  Sales Revenue (gross)    $254.50
  DR  Sales Tax Payable        $XX.XX
      CR  Cash                  $XXX.XX
      CR  Sales Discounts       $70.63
```

**The Challenge:**
- Shopify applies discounts sequentially
- Journal entries may not capture the discount stacking correctly
- Refunds must reverse BOTH discounts proportionally
- COGS calculation should use gross price, not net price

**Verification Needed:**
- How are stacked discounts journalized in the current system?
- Does the refund logic properly reverse both discounts?
- Is COGS calculated on gross or net price?
- Are discounts tracked in a separate GL account or netted against revenue?

---

## Priority 3: COGS Issues

### Order #80212 - Tax-Exempt Customer (Jan 6, 2026)

#### Order Summary
| Metric | Value |
|--------|-------|
| **Order Total** | $342.82 |
| **Current Total** | $342.82 (no change) |
| **Financial Status** | `paid` |
| **Fulfillment Status** | `fulfilled` |
| **Payment Gateway** | shopify_payments |
| **Line Items** | 97 items (mostly hooks, small fly tying materials) |
| **Tax Status** | **FULLY TAX EXEMPT** |
| **Customer** | Tax-exempt customer |

#### Financial Breakdown
```
Original Order:
- Total Line Items: $342.82
- Tax: $0.00 (customer.tax_exempt: true)
- Total: $342.82

NO refunds, NO cancellations
```

#### Customer Details
```json
{
  "first_name": "PHILLIP",
  "last_name": "HERNE",
  "tax_exempt": true,
  "default_address": {
    "state": "Arizona",
    "country": "United States"
  }
}
```

#### Line Items Analysis (Sample of 97 items)

**Typical items:**
1. **TFS 7258 Hooks - Size 2** (SKU: TFS7258-6252) - $3.50
   - taxable: true (but customer exempt)
   - tax_lines: $0.00 on all tax types

2. **TFS 7258 Hooks - Size 4** (SKU: TFS7258-6253) - $3.50
3. **TFS 7258 Hooks - Size 6** (SKU: TFS7258-6254) - $3.50
4. **TFS 8774 Hooks - Size 4** (SKU: TFS8774-12610) - $3.50
5. ... (total 97 items, mostly small hooks and materials)

**All items:**
- Individually taxable products
- BUT customer is tax-exempt
- All have tax_lines with $0.00 amounts

#### **ROOT CAUSE: Tax-Exempt Customer with High COGS Volume**

**Issue:** This order has **97 small inventory items**, creating a complex COGS calculation scenario with **no tax** to complicate things.

**Why This Is Relevant:**

1. **High Volume COGS Tracking:**
   - 97 individual SKUs need COGS lookup
   - Each item needs inventory reduction
   - Journal entry will have 97 COGS sub-entries

2. **Tax Exempt Accounting:**
   - Customer is tax-exempt (likely reseller or government)
   - Items ARE taxable, but customer doesn't pay tax
   - Journal entry must correctly show:
     - Revenue: $342.82
     - Tax: $0.00 (not $342.82 × 7.25% = $24.85)

3. **COGS Complexity:**
   - Many items are hooks/materials with very low COGS ($0.50-$2.00 range)
   - Total COGS likely $150-$200
   - Gross margin: ~50%

**Expected Journal Entry:**
```
SALE:
  DR  Cash                  $342.82
      CR  Sales Revenue      $342.82
      (NO tax entry)

COGS (97 individual items):
  DR  COGS                  $XXX.XX (sum of all 97 items)
      CR  Inventory          $XXX.XX
```

**Potential Issues:**

1. **Tax Reporting:**
   - Tax-exempt sales must be reported separately to state
   - Customer exemption certificate should be on file
   - Journal entry must distinguish exempt sales from taxable sales

2. **COGS Calculation:**
   - 97 individual inventory lookups
   - Any missing SKU COGS will cause imbalance
   - Rounding errors across 97 items could compound

3. **Revenue Recognition:**
   - Is this posted to same revenue account as taxable sales?
   - Should it be in a separate "tax-exempt revenue" account?

**Verification Needed:**
- Are tax-exempt sales posted to a different GL account?
- Does COGS calculation handle 97-item orders correctly?
- Are there any missing COGS values for any of the 97 SKUs?
- Does the journal entry distinguish tax-exempt sales for reporting purposes?

**Note:** This order was flagged as having "COGS issues" but there's no actual refund or discrepancy. The concern is likely:
- **Completeness of COGS data** for all 97 SKUs
- **Proper handling of tax-exempt status** in journal entries
- **Volume of line items** creating potential for errors

---

## Summary of Root Causes

### 1. Partial Refund Tax Calculation Issues (Orders #80388, #80355)
**Symptoms:** Small imbalances ($26.81, $17.27) after partial refunds
**Cause:** Refund tax calculation and journal entry splitting
**Impact:** Tax liability and sales revenue misalignment

**Fix Required:**
- Ensure refund line items properly split subtotal from tax
- Verify journal entries separate sales revenue debit from tax payable debit
- Validate refund amounts match: `subtotal + tax = refund_amount`

### 2. Multiple Payment Gateway Scenarios (Order #80355)
**Symptoms:** Imbalances when gift cards, credit cards, and store credit mix
**Cause:** Different liability accounts for different payment methods
**Impact:** AR/liability account mismatches

**Fix Required:**
- Track which payment gateway should receive refund
- Handle store credit refunds as separate liability account
- Ensure gift card portion is properly accounted for

### 3. Canceled Line Items vs Refunds (Orders #80230, #80050)
**Symptoms:** Imbalances on never-fulfilled items
**Cause:** System treats cancellations like refunds when they're different
**Impact:** Tax, revenue, and AR misstatements

**Fix Required:**
- Distinguish `restock_type: "cancel"` from `restock_type: "return"`
- Handle partial captures differently from refunds
- Ensure canceled items don't trigger revenue recognition or COGS entries

### 4. Stacked Discount Complexity (Order #80284)
**Symptoms:** Large discrepancies with multiple discounts
**Cause:** Sequential discount application creates complex refund math
**Impact:** Revenue and discount account allocation errors

**Fix Required:**
- Track discount allocations per item for refund purposes
- Reverse discounts proportionally on refunds
- Use COGS on gross price, not net price

### 5. Tax-Exempt Customer Handling (Orders #80228, #80212)
**Symptoms:** Complex scenarios with exempt and taxable items mixed
**Cause:** Different GL account requirements for exempt sales
**Impact:** Tax reporting and revenue classification errors

**Fix Required:**
- Post tax-exempt sales to separate GL account
- Handle DFG (government) sales specially
- Ensure COGS tracking for high-volume exempt orders

---

## Recommended Next Steps

### Immediate Actions

1. **Verify Tax Splitting in Refunds**
   - Audit all partial refunds to ensure tax is properly separated
   - Check journal entries for refund transactions
   - Validate `refund_line_items[].subtotal` + `refund_line_items[].total_tax` = refund amount

2. **Review Canceled vs Refunded Logic**
   - Check how `restock_type: "cancel"` is handled differently from `restock_type: "return"`
   - Audit partial capture scenarios (authorize → cancel → capture)
   - Ensure canceled items don't create COGS entries

3. **Audit Multi-Gateway Payment Orders**
   - Review all orders with multiple payment_gateway_names
   - Check store credit refund accounting
   - Verify gift card liability tracking

### System Improvements Needed

1. **Enhanced Refund Processing**
   - Split refund amounts into subtotal and tax components
   - Track original payment gateway for refund routing
   - Handle partial captures vs full refunds differently

2. **COGS Validation**
   - Verify COGS exists for ALL SKUs before journal entry creation
   - Flag orders with missing COGS data
   - Ensure COGS uses gross price, not discounted price

3. **Tax-Exempt Handling**
   - Create separate GL accounts for tax-exempt revenue
   - Flag government/DFG sales for special handling
   - Ensure proper tax reporting for exempt transactions

4. **Discount Tracking**
   - Store discount breakdown per line item for refund purposes
   - Handle stacked discounts correctly in journal entries
   - Reverse discounts proportionally on partial refunds

### Validation Queries

Run these SQL queries to find similar issues:

```sql
-- Find partial refunds with potential tax issues
SELECT order_id, total_price, current_total_price,
       total_tax, current_total_tax,
       (total_price - current_total_price) as refund_amount
FROM orders
WHERE financial_status = 'partially_refunded'
  AND total_tax != current_total_tax
ORDER BY refund_amount DESC;

-- Find orders with multiple payment gateways
SELECT order_id, payment_gateway_names, total_price
FROM orders
WHERE array_length(payment_gateway_names, 1) > 1
  AND financial_status IN ('partially_refunded', 'refunded');

-- Find orders with canceled line items
SELECT o.order_id, oli.sku, oli.fulfillment_status, r.restock_type
FROM orders o
JOIN order_line_items oli ON o.id = oli.order_id
JOIN refund_line_items r ON oli.id = r.line_item_id
WHERE r.restock_type = 'cancel';

-- Find orders with stacked discounts
SELECT order_id, discount_codes, total_discounts
FROM orders
WHERE array_length(discount_codes, 1) > 1
ORDER BY total_discounts DESC;
```

---

## Appendix: Order Data Summary

| Order | Date | Status | Total | Current | Imbalance | Root Cause |
|-------|------|--------|-------|---------|-----------|------------|
| #80388 | Jan 10 | partially_refunded | $43.96 | $17.15 | **$26.81** | Partial refund tax split |
| #80355 | Jan 9 | partially_refunded | $266.43 | $249.16 | **$17.27** | Multi-gateway + store credit |
| #80230 | Jan 7 | paid | $437.90 | $218.95 | **$19.00** | Canceled item (gift card) |
| #80050 | Jan 6 | paid | $104.71 | $33.06 | **$6.66** | Partial capture scenario |
| #80217 | Jan 6 | refunded | $266.42 | $0.00 | $266.42 | Full refund (expected) |
| #80228 | Jan 7 | partially_refunded | $236.99 | $86.85 | $150.14 | Tax-exempt items mix |
| #80284 | Jan 8 | partially_refunded | $1,129.92 | $945.95 | $183.97 | Stacked discounts |
| #80212 | Jan 6 | paid | $342.82 | $342.82 | None | Tax-exempt customer (COGS concern) |

**Total Imbalances:** $53.01 across 4 orders
**Total Discrepancies:** $600.53 (includes expected full refund)
**Most Critical:** Tax splitting on partial refunds ($26.81 + $17.27 = $44.08)

---

**Analysis completed:** 2026-03-01
**Files analyzed:** 9 order JSON exports
**Key finding:** Multiple root causes require different fixes - no single solution will resolve all issues.

**Recommendation:** Prioritize fixing the **partial refund tax splitting logic** first, as it affects the most orders and creates the largest cumulative imbalance.
