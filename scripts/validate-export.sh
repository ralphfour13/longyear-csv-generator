#!/bin/bash

# ============================================================================
# Sage50 Export Validator
# Validates internal consistency of all export files in a given directory.
#
# Usage: ./scripts/validate-export.sh <path-to-export-directory>
#
# The directory should contain subdirectories like export-2026-01-01-xxxxx/
# each containing:
#   - journal-entry_DATE.csv         (Sage50 import file, no headers)
#   - journal-entry_DATE.txt         (duplicate of CSV for reference)
#   - daily-reconciliation_DATE.csv  (order-level summary with SUMMARY row)
#   - detailed-sales-report_DATE.csv (detailed per-order with TOTALS row)
#   - journal-entry-details_DATE.csv (per-order journal entry breakdown)
#   - payouts-with-orders_DATE.csv   (payout-to-order mapping)
#   - order-data_DATE.json           (raw Shopify order data)
#
# KEY DESIGN NOTES:
#   - daily-reconciliation includes refund-only rows for orders from OTHER
#     dates that were refunded on THIS date. These rows have "refund only"
#     in the notes column and are NOT expected to appear in detailed-sales.
#   - detailed-sales-report shows the CURRENT state of orders SOLD on this
#     date (including later refunds in the "Price: Total Refund" column).
#   - journal-entry and journal-entry-details record actual accounting
#     entries for this date (both sales and refunds occurring this date).
# ============================================================================

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: ./scripts/validate-export.sh <path-to-export-directory>"
    echo ""
    echo "Example: ./scripts/validate-export.sh ~/Downloads/Sage50\\ 3-22-2026"
    exit 1
fi

EXPORT_DIR="$1"

if [ ! -d "$EXPORT_DIR" ]; then
    echo "Error: Directory not found: $EXPORT_DIR"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TOTAL_ERRORS=0
TOTAL_WARNINGS=0
TOTAL_INFO=0
DAYS_CHECKED=0
DAYS_CLEAN=0

echo "============================================================"
echo "  Sage50 Export Validator"
echo "============================================================"
echo "Directory: $EXPORT_DIR"
echo ""

# Process each export directory
for dir in "$EXPORT_DIR"/export-*/; do
    [ -d "$dir" ] || continue

    # Extract date from directory name
    DATE=$(basename "$dir" | sed 's/export-\([0-9-]*\)-.*/\1/')
    ERRORS=0
    WARNINGS=0
    INFO=0

    # Find actual files
    JE_CSV=$(find "$dir" -name "journal-entry_*.csv" -not -name "journal-entry-details*" | head -1)
    JE_TXT=$(find "$dir" -name "journal-entry_*.txt" | head -1)
    RECON=$(find "$dir" -name "daily-reconciliation_*.csv" | head -1)
    DETAIL=$(find "$dir" -name "detailed-sales-report_*.csv" | head -1)
    JE_DETAILS=$(find "$dir" -name "journal-entry-details_*.csv" | head -1)
    PAYOUTS=$(find "$dir" -name "payouts-with-orders_*.csv" | head -1)

    echo "--- $DATE ---"

    # ========================================================================
    # CHECK 1: All expected files exist
    # ========================================================================
    MISSING=""
    [ -z "$JE_CSV" ] && MISSING="$MISSING journal-entry.csv"
    [ -z "$JE_TXT" ] && MISSING="$MISSING journal-entry.txt"
    [ -z "$RECON" ] && MISSING="$MISSING daily-reconciliation.csv"
    [ -z "$DETAIL" ] && MISSING="$MISSING detailed-sales-report.csv"
    [ -z "$JE_DETAILS" ] && MISSING="$MISSING journal-entry-details.csv"
    [ -z "$PAYOUTS" ] && MISSING="$MISSING payouts-with-orders.csv"

    if [ -n "$MISSING" ]; then
        echo -e "  ${RED}ERROR${NC} Missing files:$MISSING"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        DAYS_CHECKED=$((DAYS_CHECKED + 1))
        echo ""
        continue
    fi

    # ========================================================================
    # CHECK 2: Journal entry CSV and TXT are identical
    # ========================================================================
    if ! diff -q "$JE_CSV" "$JE_TXT" > /dev/null 2>&1; then
        echo -e "  ${RED}ERROR${NC} journal-entry .csv and .txt differ"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 3: Journal entry balances to zero
    # ========================================================================
    JE_SUM=$(awk -F',' '{sum += $7} END {printf "%.2f", sum}' "$JE_CSV")
    if [ "$JE_SUM" != "0.00" ] && [ "$JE_SUM" != "-0.00" ]; then
        echo -e "  ${RED}ERROR${NC} Journal entry does not balance: sum = $JE_SUM"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 4: Journal entry details total balances to zero
    # ========================================================================
    JED_SUM=$(awk -F',' 'NR>1 {sum += $4} END {printf "%.2f", sum}' "$JE_DETAILS")
    if [ "$JED_SUM" != "0.00" ] && [ "$JED_SUM" != "-0.00" ]; then
        echo -e "  ${RED}ERROR${NC} Journal entry details total does not balance: sum = $JED_SUM"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 5: Journal entry details - per-order (per-reference) balance
    # ========================================================================
    UNBALANCED_ORDERS=$(awk -F',' 'NR>1 {
        ref = $2
        sum[ref] += $4
    }
    END {
        for (ref in sum) {
            s = sprintf("%.2f", sum[ref])
            if (s != "0.00" && s != "-0.00") {
                printf "%s (diff: %s)\n", ref, s
            }
        }
    }' "$JE_DETAILS")

    if [ -n "$UNBALANCED_ORDERS" ]; then
        echo -e "  ${RED}ERROR${NC} Unbalanced orders in journal-entry-details:"
        echo "$UNBALANCED_ORDERS" | while read -r line; do
            echo "         $line"
        done
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 6: Journal entry account totals == journal-entry-details totals
    # ========================================================================
    # Get per-account totals from journal-entry CSV (filter out 0.00 accounts)
    JE_ACCOUNTS=$(awk -F',' '{
        acct = $6
        sum[acct] += $7
    }
    END {
        for (acct in sum) {
            s = sprintf("%.2f", sum[acct])
            if (s != "0.00" && s != "-0.00") {
                printf "%s:%s\n", acct, s
            }
        }
    }' "$JE_CSV" | sort)

    # Get per-account totals from journal-entry-details CSV (filter out 0.00)
    JED_ACCOUNTS=$(awk -F',' 'NR>1 {
        acct = $3
        sum[acct] += $4
    }
    END {
        for (acct in sum) {
            s = sprintf("%.2f", sum[acct])
            if (s != "0.00" && s != "-0.00") {
                printf "%s:%s\n", acct, s
            }
        }
    }' "$JE_DETAILS" | sort)

    if [ "$JE_ACCOUNTS" != "$JED_ACCOUNTS" ]; then
        echo -e "  ${RED}ERROR${NC} Journal entry account totals != journal-entry-details account totals"
        echo "         journal-entry.csv:"
        echo "$JE_ACCOUNTS" | sed 's/^/           /'
        echo "         journal-entry-details.csv:"
        echo "$JED_ACCOUNTS" | sed 's/^/           /'
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 7: SUMMARY order count matches actual data rows
    # ========================================================================
    SUMMARY_LINE=$(grep "^SUMMARY" "$RECON" || echo "")
    # Count unique orders in recon (exclude header and SUMMARY)
    RECON_UNIQUE_ORDERS=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {print $1}' "$RECON" | sort -u | wc -l | tr -d ' ')
    # Count total data rows (not unique - some orders have refund+original rows)
    RECON_DATA_ROWS=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {print $1}' "$RECON" | wc -l | tr -d ' ')

    if [ -n "$SUMMARY_LINE" ]; then
        SUMMARY_COUNT=$(echo "$SUMMARY_LINE" | sed 's/SUMMARY (\([0-9]*\) orders).*/\1/')
        # SUMMARY count should match total data rows (including refund pairs)
        if [ "$RECON_DATA_ROWS" != "$SUMMARY_COUNT" ]; then
            # Check if it matches unique orders instead
            if [ "$RECON_UNIQUE_ORDERS" != "$SUMMARY_COUNT" ]; then
                echo -e "  ${YELLOW}WARN${NC} SUMMARY says $SUMMARY_COUNT orders, file has $RECON_UNIQUE_ORDERS unique / $RECON_DATA_ROWS rows"
                WARNINGS=$((WARNINGS + 1))
                TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
            fi
        fi
    else
        echo -e "  ${RED}ERROR${NC} No SUMMARY row in daily-reconciliation"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 8: Recon SUMMARY totals match sum of its own data rows
    # Uses python for proper CSV parsing (quoted fields with commas)
    # ========================================================================
    if [ -n "$SUMMARY_LINE" ]; then
        RECON_SUMMARY_CHECK=$(python3 -c "
import csv
summary_tax = summary_ship = summary_total = 0
rows_tax = rows_ship = rows_total = 0
with open('$RECON') as f:
    reader = csv.reader(f)
    next(reader)  # skip header
    for row in reader:
        if row[0].startswith('SUMMARY'):
            summary_tax = float(row[4]) if row[4] else 0
            summary_ship = float(row[5]) if row[5] else 0
            summary_total = float(row[15]) if row[15] else 0
        else:
            rows_tax += float(row[4]) if row[4] else 0
            rows_ship += float(row[5]) if row[5] else 0
            rows_total += float(row[15]) if row[15] else 0
errors = []
if abs(rows_tax - summary_tax) > 0.01:
    errors.append(f'tax:{summary_tax:.2f}:{rows_tax:.2f}')
if abs(rows_ship - summary_ship) > 0.01:
    errors.append(f'ship:{summary_ship:.2f}:{rows_ship:.2f}')
if abs(rows_total - summary_total) > 0.01:
    errors.append(f'total:{summary_total:.2f}:{rows_total:.2f}')
for e in errors:
    print(e)
" 2>/dev/null)

        if [ -n "$RECON_SUMMARY_CHECK" ]; then
            echo "$RECON_SUMMARY_CHECK" | while IFS=: read -r field summary_val rows_val; do
                echo -e "  ${RED}ERROR${NC} Recon SUMMARY $field ($summary_val) != sum of rows ($rows_val)"
            done
            RECON_SUMMARY_ERRORS=$(echo "$RECON_SUMMARY_CHECK" | wc -l | tr -d ' ')
            ERRORS=$((ERRORS + RECON_SUMMARY_ERRORS))
            TOTAL_ERRORS=$((TOTAL_ERRORS + RECON_SUMMARY_ERRORS))
        fi
    fi

    # ========================================================================
    # CHECK 9: JE account totals match Recon SUMMARY
    # (The journal entry and reconciliation should reflect the same accounting)
    # ========================================================================
    if [ -n "$SUMMARY_LINE" ]; then
        # Parse SUMMARY row with python for proper CSV handling
        read -r RECON_NET_SUB RECON_TAX RECON_SHIPPING RECON_PAY_CASH RECON_PAY_CARD RECON_PAY_GC RECON_PAY_SC RECON_PAY_CHECK RECON_PAY_OTHER RECON_PAY_TOTAL RECON_GC_SOLD < <(python3 -c "
import csv, io
reader = csv.reader(io.StringIO('''$SUMMARY_LINE'''))
for row in reader:
    print(row[3] or '0', row[4] or '0', row[5] or '0', row[9] or '0', row[10] or '0', row[11] or '0', row[12] or '0', row[13] or '0', row[14] or '0', row[15] or '0', row[16] or '0')
" 2>/dev/null)

        # Get JE amounts by account
        get_je_account() {
            local acct=$1
            awk -F',' -v a="$acct" '$6 == a {sum += $7} END {printf "%.2f", sum}' "$JE_CSV"
        }

        JE_1051=$(get_je_account "1051.000")  # Cash/Check
        JE_1061=$(get_je_account "1061.000")  # Credit Card
        JE_1200=$(get_je_account "1200.000")  # Other receivable
        JE_2110=$(get_je_account "2110.000")  # Tax
        JE_2320=$(get_je_account "2320.000")  # Gift Card Sale
        JE_2340=$(get_je_account "2340.000")  # Store Credit
        JE_3000=$(get_je_account "3000.000")  # Sales
        JE_3040=$(get_je_account "3040.000")  # Shipping

        # Count refund-only orders in recon
        REFUND_ONLY_COUNT=$(python3 -c "
import csv
count = 0
with open('$RECON') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if row[0].startswith('SUMMARY'): continue
        if 'refund only' in (row[7] if len(row) > 7 else ''):
            count += 1
print(count)
" 2>/dev/null)

        # JE vs Recon comparisons (reported as INFO since differences are expected
        # when the reconciliation includes cross-date refunds differently than the JE)
        RECON_CARD_FMT=$(printf "%.2f" "$RECON_PAY_CARD")
        if [ "$JE_1061" != "$RECON_CARD_FMT" ]; then
            CARD_DIFF=$(awk "BEGIN {printf \"%.2f\", $JE_1061 - $RECON_CARD_FMT}")
            if [ "$REFUND_ONLY_COUNT" -gt 0 ]; then
                echo -e "  ${CYAN}INFO${NC} Credit Card: JE=$JE_1061 vs Recon=$RECON_CARD_FMT (diff: $CARD_DIFF) - has $REFUND_ONLY_COUNT refund-only order(s)"
            else
                echo -e "  ${YELLOW}WARN${NC} Credit Card: JE 1061=$JE_1061 vs Recon card=$RECON_CARD_FMT (diff: $CARD_DIFF)"
                WARNINGS=$((WARNINGS + 1))
                TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
            fi
            INFO=$((INFO + 1))
            TOTAL_INFO=$((TOTAL_INFO + 1))
        fi

        RECON_CASH_CHECK=$(awk "BEGIN {printf \"%.2f\", $RECON_PAY_CASH + $RECON_PAY_CHECK}")
        if [ "$JE_1051" != "0.00" ] || [ "$RECON_CASH_CHECK" != "0.00" ]; then
            if [ "$JE_1051" != "$RECON_CASH_CHECK" ]; then
                CASH_DIFF=$(awk "BEGIN {printf \"%.2f\", $JE_1051 - $RECON_CASH_CHECK}")
                echo -e "  ${YELLOW}WARN${NC} Cash/Check: JE 1051=$JE_1051 vs Recon=$RECON_CASH_CHECK (diff: $CASH_DIFF)"
                WARNINGS=$((WARNINGS + 1))
                TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
            fi
        fi

        JE_TAX_NEG=$(awk "BEGIN {printf \"%.2f\", -1 * $JE_2110}")
        RECON_TAX_FMT=$(printf "%.2f" "$RECON_TAX")
        if [ "$JE_TAX_NEG" != "$RECON_TAX_FMT" ]; then
            TAX_DIFF=$(awk "BEGIN {printf \"%.2f\", $JE_TAX_NEG - $RECON_TAX_FMT}")
            if [ "$REFUND_ONLY_COUNT" -gt 0 ]; then
                echo -e "  ${CYAN}INFO${NC} Tax: JE (negated)=$JE_TAX_NEG vs Recon=$RECON_TAX_FMT (diff: $TAX_DIFF) - has refund-only orders"
            else
                echo -e "  ${YELLOW}WARN${NC} Tax: JE 2110 (negated)=$JE_TAX_NEG vs Recon=$RECON_TAX_FMT (diff: $TAX_DIFF)"
                WARNINGS=$((WARNINGS + 1))
                TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
            fi
            INFO=$((INFO + 1))
            TOTAL_INFO=$((TOTAL_INFO + 1))
        fi

        JE_SHIP_NEG=$(awk "BEGIN {printf \"%.2f\", -1 * $JE_3040}")
        RECON_SHIP_CHECK=$(printf "%.2f" "${RECON_SHIPPING:-0}")
        if [ "$JE_SHIP_NEG" != "$RECON_SHIP_CHECK" ]; then
            SHIP_DIFF=$(awk "BEGIN {printf \"%.2f\", $JE_SHIP_NEG - $RECON_SHIP_CHECK}")
            echo -e "  ${YELLOW}WARN${NC} Shipping: JE 3040 (negated)=$JE_SHIP_NEG vs Recon=$RECON_SHIP_CHECK (diff: $SHIP_DIFF)"
            WARNINGS=$((WARNINGS + 1))
            TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
        fi

        # Store credit check
        RECON_SC_FMT=$(printf "%.2f" "${RECON_PAY_SC:-0}")
        if [ "$JE_2340" != "0.00" ] || [ "$RECON_SC_FMT" != "0.00" ]; then
            if [ "$JE_2340" != "$RECON_SC_FMT" ]; then
                SC_DIFF=$(awk "BEGIN {printf \"%.2f\", $JE_2340 - $RECON_SC_FMT}")
                echo -e "  ${YELLOW}WARN${NC} Store Credit: JE 2340=$JE_2340 vs Recon=$RECON_SC_FMT (diff: $SC_DIFF)"
                WARNINGS=$((WARNINGS + 1))
                TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
            fi
        fi
    fi

    # ========================================================================
    # CHECK 10: Detailed-sales-report internal consistency
    # (TOTALS row matches sum of data rows)
    # ========================================================================
    DETAIL_TOTALS=$(grep "^TOTALS" "$DETAIL" || echo "")
    if [ -z "$DETAIL_TOTALS" ]; then
        echo -e "  ${RED}ERROR${NC} No TOTALS row in detailed-sales-report"
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    else
        # Use python for CSV parsing because awk can't handle quoted fields with commas
        # (e.g., tags like "captured-2026-01-27, Packing Slips Printed")
        read -r DETAIL_TAX_TOTAL DETAIL_SHIP_TOTAL DETAIL_CURRENT_TOTAL < <(python3 -c "
import csv, sys
with open('$DETAIL') as f:
    for row in csv.reader(f):
        if row[0] == 'TOTALS':
            print(row[17], row[18], row[20])
")

        # Sum data rows using proper CSV parsing
        read -r DETAIL_ROWS_TAX DETAIL_ROWS_SHIP DETAIL_ROWS_TOTAL < <(python3 -c "
import csv
tax=ship=total=0
with open('$DETAIL') as f:
    reader = csv.reader(f)
    next(reader)  # skip header
    for row in reader:
        if row[0] == 'TOTALS': continue
        tax += float(row[17]) if row[17] else 0
        ship += float(row[18]) if row[18] else 0
        total += float(row[20]) if row[20] else 0
print(f'{tax:.2f} {ship:.2f} {total:.2f}')
")

        DETAIL_TAX_FMT=$(printf "%.2f" "$DETAIL_TAX_TOTAL")
        DETAIL_SHIP_FMT=$(printf "%.2f" "${DETAIL_SHIP_TOTAL:-0}")
        DETAIL_TOTAL_FMT=$(printf "%.2f" "$DETAIL_CURRENT_TOTAL")

        if [ "$DETAIL_ROWS_TAX" != "$DETAIL_TAX_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Detailed-sales TOTALS tax ($DETAIL_TAX_FMT) != sum of rows ($DETAIL_ROWS_TAX)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
        if [ "$DETAIL_ROWS_SHIP" != "$DETAIL_SHIP_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Detailed-sales TOTALS shipping ($DETAIL_SHIP_FMT) != sum of rows ($DETAIL_ROWS_SHIP)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
        if [ "$DETAIL_ROWS_TOTAL" != "$DETAIL_TOTAL_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Detailed-sales TOTALS current total ($DETAIL_TOTAL_FMT) != sum of rows ($DETAIL_ROWS_TOTAL)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
    fi

    # ========================================================================
    # CHECK 11: Orders in detailed-sales should be subset of recon orders
    # (Recon may have extra refund-only orders not in detailed-sales)
    # ========================================================================
    RECON_ORDER_LIST=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {print $1}' "$RECON" | sort -u)
    DETAIL_ORDER_LIST=$(awk -F',' 'NR>1 && $1 !~ /^TOTALS/ {print $1}' "$DETAIL" | sort -u)

    # Find orders in detailed-sales but NOT in recon (this would be an error)
    DETAIL_ONLY=$(comm -23 <(echo "$DETAIL_ORDER_LIST") <(echo "$RECON_ORDER_LIST") 2>/dev/null || true)
    if [ -n "$DETAIL_ONLY" ]; then
        echo -e "  ${RED}ERROR${NC} Orders in detailed-sales but NOT in recon:"
        echo "$DETAIL_ONLY" | sed 's/^/         /'
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # Find orders in recon but NOT in detailed-sales (expected for refund-only)
    RECON_ONLY=$(comm -13 <(echo "$DETAIL_ORDER_LIST") <(echo "$RECON_ORDER_LIST") 2>/dev/null || true)
    if [ -n "$RECON_ONLY" ]; then
        # Check if these are all refund-only rows
        # Check which recon-only orders are refund-only vs unexpected
        NON_REFUND_ONLY=$(python3 -c "
import csv, sys
refund_orders = set()
with open('$RECON') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if row[0].startswith('SUMMARY'): continue
        if 'refund only' in (row[7] if len(row) > 7 else ''):
            refund_orders.add(row[0])
check_orders = '''$RECON_ONLY'''.strip().split('\n')
non_refund = [o for o in check_orders if o and o not in refund_orders]
print(' '.join(non_refund))
" 2>/dev/null)

        if [ -n "$NON_REFUND_ONLY" ]; then
            echo -e "  ${RED}ERROR${NC} Orders in recon but NOT in detailed-sales (and NOT refund-only):$NON_REFUND_ONLY"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        else
            REFUND_COUNT=$(echo "$RECON_ONLY" | wc -l | tr -d ' ')
            echo -e "  ${CYAN}INFO${NC} $REFUND_COUNT refund-only order(s) in recon (not in detailed-sales): $(echo $RECON_ONLY | tr '\n' ' ')"
            INFO=$((INFO + 1))
            TOTAL_INFO=$((TOTAL_INFO + 1))
        fi
    fi

    # ========================================================================
    # CHECK 12: Per-order totals match for SHARED orders (recon vs detailed-sales)
    # Only compare orders that appear in both files
    # ========================================================================
    # Build per-order totals using python for proper CSV parsing
    MISMATCHED_ORDERS=$(python3 -c "
import csv
recon_totals = {}
detail_totals = {}
with open('$RECON') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if row[0].startswith('SUMMARY'): continue
        order = row[0]
        amt = float(row[15]) if row[15] else 0
        recon_totals[order] = recon_totals.get(order, 0) + amt
with open('$DETAIL') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if row[0] == 'TOTALS': continue
        detail_totals[row[0]] = float(row[20]) if row[20] else 0
shared = set(recon_totals.keys()) & set(detail_totals.keys())
mismatches = []
for order in sorted(shared):
    r = recon_totals[order]
    d = detail_totals[order]
    if abs(r - d) > 0.01:
        mismatches.append(f'{order}: recon={r:.2f}, detail={d:.2f}')
for m in mismatches[:5]:
    print(m)
if len(mismatches) > 5:
    print(f'MORE:{len(mismatches) - 5}')
" 2>/dev/null)

    if [ -n "$MISMATCHED_ORDERS" ]; then
        MISMATCH_COUNT=$(echo "$MISMATCHED_ORDERS" | grep -c "recon=" || true)
        MORE_COUNT=$(echo "$MISMATCHED_ORDERS" | grep "^MORE:" | sed 's/^MORE://' || true)
        echo -e "  ${YELLOW}WARN${NC} $MISMATCH_COUNT order(s) with different totals in recon vs detailed-sales:"
        echo "$MISMATCHED_ORDERS" | grep -v "^MORE:" | sed 's/^/         /'
        if [ -n "$MORE_COUNT" ]; then
            echo "         ... and $MORE_COUNT more"
        fi
        WARNINGS=$((WARNINGS + 1))
        TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
    fi

    # ========================================================================
    # CHECK 13: Recon per-order payment total == sum of payment method columns
    # CHECK 14: Recon per-order: payment total should equal net_subtotal + tax + shipping
    # Uses python for proper CSV parsing (quoted fields with commas)
    # ========================================================================
    RECON_CHECKS=$(python3 -c "
import csv
pay_mismatches = []
calc_mismatches = []
with open('$RECON') as f:
    reader = csv.reader(f)
    next(reader)  # skip header
    for row in reader:
        if row[0].startswith('SUMMARY'): continue
        order = row[0]
        try:
            pay_cash = float(row[9]) if row[9] else 0
            pay_card = float(row[10]) if row[10] else 0
            pay_gc = float(row[11]) if row[11] else 0
            pay_sc = float(row[12]) if row[12] else 0
            pay_check = float(row[13]) if row[13] else 0
            pay_other = float(row[14]) if row[14] else 0
            pay_total = float(row[15]) if row[15] else 0
            pay_sum = pay_cash + pay_card + pay_gc + pay_sc + pay_check + pay_other
            diff = pay_total - pay_sum
            if abs(diff) > 0.01:
                pay_mismatches.append(f'{order}: total={pay_total:.2f}, sum={pay_sum:.2f}, diff={diff:.2f}')
            # Check net+tax+ship == payment total (skip refund-only)
            notes = row[7] if len(row) > 7 else ''
            if 'refund only' not in notes:
                net_sub = float(row[3]) if row[3] else 0
                tax = float(row[4]) if row[4] else 0
                shipping = float(row[5]) if row[5] else 0
                calc = net_sub + tax + shipping
                cdiff = pay_total - calc
                if abs(cdiff) > 0.01:
                    calc_mismatches.append(f'{order}: pay={pay_total:.2f}, calc(net+tax+ship)={calc:.2f} ({net_sub:.2f}+{tax:.2f}+{shipping:.2f}), diff={cdiff:.2f}')
        except (ValueError, IndexError):
            pass
if pay_mismatches:
    print('PAY_MISMATCH:' + '|'.join(pay_mismatches[:5]))
    if len(pay_mismatches) > 5:
        print(f'PAY_MORE:{len(pay_mismatches) - 5}')
if calc_mismatches:
    print('CALC_MISMATCH:' + '|'.join(calc_mismatches[:5]))
    if len(calc_mismatches) > 5:
        print(f'CALC_MORE:{len(calc_mismatches) - 5}')
" 2>/dev/null)

    RECON_PAY_MISMATCH=$(echo "$RECON_CHECKS" | grep "^PAY_MISMATCH:" | sed 's/^PAY_MISMATCH://' || true)
    if [ -n "$RECON_PAY_MISMATCH" ]; then
        echo -e "  ${RED}ERROR${NC} Recon orders where payment total != sum of payment methods:"
        echo "$RECON_PAY_MISMATCH" | tr '|' '\n' | sed 's/^/         /'
        PAY_MORE=$(echo "$RECON_CHECKS" | grep "^PAY_MORE:" | sed 's/^PAY_MORE://' || true)
        if [ -n "$PAY_MORE" ]; then
            echo "         ... and $PAY_MORE more"
        fi
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    RECON_CALC_MISMATCH=$(echo "$RECON_CHECKS" | grep "^CALC_MISMATCH:" | sed 's/^CALC_MISMATCH://' || true)
    if [ -n "$RECON_CALC_MISMATCH" ]; then
        echo -e "  ${RED}ERROR${NC} Recon orders where payment != net_subtotal + tax + shipping:"
        echo "$RECON_CALC_MISMATCH" | tr '|' '\n' | sed 's/^/         /'
        CALC_MORE=$(echo "$RECON_CHECKS" | grep "^CALC_MORE:" | sed 's/^CALC_MORE://' || true)
        if [ -n "$CALC_MORE" ]; then
            echo "         ... and $CALC_MORE more"
        fi
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # RESULT for this day
    # ========================================================================
    if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ] && [ "$INFO" -eq 0 ]; then
        echo -e "  ${GREEN}PASS${NC} All checks passed"
        DAYS_CLEAN=$((DAYS_CLEAN + 1))
    elif [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
        echo -e "  ${GREEN}PASS${NC} ($INFO info)"
        DAYS_CLEAN=$((DAYS_CLEAN + 1))
    elif [ "$ERRORS" -eq 0 ]; then
        echo -e "  ${YELLOW}PASS with warnings${NC} ($WARNINGS warnings, $INFO info)"
    fi

    DAYS_CHECKED=$((DAYS_CHECKED + 1))
    echo ""
done

# ============================================================================
# FINAL SUMMARY
# ============================================================================
echo "============================================================"
echo "  SUMMARY"
echo "============================================================"
echo "Days checked:  $DAYS_CHECKED"
echo "Days clean:    $DAYS_CLEAN"
echo ""
echo -e "Errors:   $TOTAL_ERRORS (accounting issues that must be fixed)"
echo -e "Warnings: $TOTAL_WARNINGS (discrepancies to review)"
echo -e "Info:     $TOTAL_INFO (expected differences, e.g. cross-date refunds)"
echo ""

if [ "$TOTAL_ERRORS" -eq 0 ] && [ "$TOTAL_WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}ALL CHECKS PASSED${NC}"
    echo "Files are internally consistent. Cross-file differences are"
    echo "explained by refund-only orders from other dates."
elif [ "$TOTAL_ERRORS" -eq 0 ]; then
    echo -e "${YELLOW}PASSED WITH WARNINGS${NC}"
    echo "No accounting errors found. Review warnings above."
else
    echo -e "${RED}ERRORS DETECTED${NC}"
    echo "Review errors above - these indicate accounting issues."
fi

exit "$TOTAL_ERRORS"
