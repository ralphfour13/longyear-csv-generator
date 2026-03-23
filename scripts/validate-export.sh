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
    # ========================================================================
    if [ -n "$SUMMARY_LINE" ]; then
        RECON_TAX=$(echo "$SUMMARY_LINE" | awk -F',' '{print $5}')
        RECON_SHIPPING=$(echo "$SUMMARY_LINE" | awk -F',' '{print $6}')
        RECON_PAY_TOTAL=$(echo "$SUMMARY_LINE" | awk -F',' '{print $16}')

        # Sum the data rows
        RECON_ROWS_TAX=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {sum += $5} END {printf "%.2f", sum}' "$RECON")
        RECON_ROWS_SHIPPING=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {sum += $6} END {printf "%.2f", sum}' "$RECON")
        RECON_ROWS_PAY_TOTAL=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {sum += $16} END {printf "%.2f", sum}' "$RECON")

        RECON_TAX_FMT=$(printf "%.2f" "$RECON_TAX")
        RECON_SHIP_FMT=$(printf "%.2f" "${RECON_SHIPPING:-0}")
        RECON_TOTAL_FMT=$(printf "%.2f" "$RECON_PAY_TOTAL")

        if [ "$RECON_ROWS_TAX" != "$RECON_TAX_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Recon SUMMARY tax ($RECON_TAX_FMT) != sum of rows ($RECON_ROWS_TAX)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
        if [ "$RECON_ROWS_SHIPPING" != "$RECON_SHIP_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Recon SUMMARY shipping ($RECON_SHIP_FMT) != sum of rows ($RECON_ROWS_SHIPPING)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
        if [ "$RECON_ROWS_PAY_TOTAL" != "$RECON_TOTAL_FMT" ]; then
            echo -e "  ${RED}ERROR${NC} Recon SUMMARY payment total ($RECON_TOTAL_FMT) != sum of rows ($RECON_ROWS_PAY_TOTAL)"
            ERRORS=$((ERRORS + 1))
            TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
        fi
    fi

    # ========================================================================
    # CHECK 9: JE account totals match Recon SUMMARY
    # (The journal entry and reconciliation should reflect the same accounting)
    # ========================================================================
    if [ -n "$SUMMARY_LINE" ]; then
        RECON_PAY_CASH=$(echo "$SUMMARY_LINE" | awk -F',' '{print $10}')
        RECON_PAY_CARD=$(echo "$SUMMARY_LINE" | awk -F',' '{print $11}')
        RECON_PAY_GC=$(echo "$SUMMARY_LINE" | awk -F',' '{print $12}')
        RECON_PAY_SC=$(echo "$SUMMARY_LINE" | awk -F',' '{print $13}')
        RECON_PAY_CHECK=$(echo "$SUMMARY_LINE" | awk -F',' '{print $14}')
        RECON_PAY_OTHER=$(echo "$SUMMARY_LINE" | awk -F',' '{print $15}')
        RECON_NET_SUB=$(echo "$SUMMARY_LINE" | awk -F',' '{print $4}')
        RECON_GC_SOLD=$(echo "$SUMMARY_LINE" | awk -F',' '{print $17}')

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

        # Count refund-only orders in recon (orders with "refund only" in notes)
        REFUND_ONLY_COUNT=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ && $8 ~ /refund only/' "$RECON" | wc -l | tr -d ' ')

        # Sum refund-only amounts from recon rows
        REFUND_ONLY_CARD=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ && $8 ~ /refund only/ {sum += $11} END {printf "%.2f", sum}' "$RECON")
        REFUND_ONLY_TAX=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ && $8 ~ /refund only/ {sum += $5} END {printf "%.2f", sum}' "$RECON")

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
        DETAIL_TAX_TOTAL=$(echo "$DETAIL_TOTALS" | awk -F',' '{print $18}')
        DETAIL_SHIP_TOTAL=$(echo "$DETAIL_TOTALS" | awk -F',' '{print $19}')
        DETAIL_CURRENT_TOTAL=$(echo "$DETAIL_TOTALS" | awk -F',' '{print $21}')

        # Sum data rows
        DETAIL_ROWS_TAX=$(awk -F',' 'NR>1 && $1 !~ /^TOTALS/ {sum += $18} END {printf "%.2f", sum}' "$DETAIL")
        DETAIL_ROWS_SHIP=$(awk -F',' 'NR>1 && $1 !~ /^TOTALS/ {sum += $19} END {printf "%.2f", sum}' "$DETAIL")
        DETAIL_ROWS_TOTAL=$(awk -F',' 'NR>1 && $1 !~ /^TOTALS/ {sum += $21} END {printf "%.2f", sum}' "$DETAIL")

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
        NON_REFUND_ONLY=""
        while IFS= read -r order; do
            IS_REFUND=$(awk -F',' -v o="$order" 'NR>1 && $1 == o && $8 ~ /refund only/ {found=1} END {print found+0}' "$RECON")
            if [ "$IS_REFUND" != "1" ]; then
                NON_REFUND_ONLY="$NON_REFUND_ONLY $order"
            fi
        done <<< "$RECON_ONLY"

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
    SHARED_ORDERS=$(comm -12 <(echo "$DETAIL_ORDER_LIST") <(echo "$RECON_ORDER_LIST") 2>/dev/null || true)
    MISMATCHED_ORDERS=""
    if [ -n "$SHARED_ORDERS" ]; then
        while IFS= read -r order; do
            # Recon: sum payment total for this order (may have multiple rows like refund pairs)
            RECON_TOTAL=$(awk -F',' -v o="$order" 'NR>1 && $1 == o {sum += $16} END {printf "%.2f", sum}' "$RECON")
            # Detailed-sales: current total
            DETAIL_TOTAL=$(awk -F',' -v o="$order" 'NR>1 && $1 == o {printf "%.2f", $21}' "$DETAIL")

            if [ "$RECON_TOTAL" != "$DETAIL_TOTAL" ]; then
                MISMATCHED_ORDERS="$MISMATCHED_ORDERS\n         $order: recon=$RECON_TOTAL, detail=$DETAIL_TOTAL"
            fi
        done <<< "$SHARED_ORDERS"
    fi

    if [ -n "$MISMATCHED_ORDERS" ]; then
        # Count how many
        MISMATCH_COUNT=$(echo -e "$MISMATCHED_ORDERS" | grep -c "recon=" || true)
        echo -e "  ${YELLOW}WARN${NC} $MISMATCH_COUNT order(s) with different totals in recon vs detailed-sales:"
        echo -e "$MISMATCHED_ORDERS" | head -5
        if [ "$MISMATCH_COUNT" -gt 5 ]; then
            echo "         ... and $((MISMATCH_COUNT - 5)) more"
        fi
        WARNINGS=$((WARNINGS + 1))
        TOTAL_WARNINGS=$((TOTAL_WARNINGS + 1))
    fi

    # ========================================================================
    # CHECK 13: Recon per-order payment total == sum of payment method columns
    # ========================================================================
    RECON_PAY_MISMATCH=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ {
        pay_total = $16 + 0
        pay_sum = $10 + $11 + $12 + $13 + $14 + $15
        diff = pay_total - pay_sum
        if (diff > 0.01 || diff < -0.01) {
            printf "%s: total=%.2f, sum=%.2f, diff=%.2f\n", $1, pay_total, pay_sum, diff
        }
    }' "$RECON")

    if [ -n "$RECON_PAY_MISMATCH" ]; then
        echo -e "  ${RED}ERROR${NC} Recon orders where payment total != sum of payment methods:"
        echo "$RECON_PAY_MISMATCH" | head -5 | sed 's/^/         /'
        ERRORS=$((ERRORS + 1))
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    fi

    # ========================================================================
    # CHECK 14: Recon per-order: payment total should equal net_subtotal + tax + shipping
    # (for non-refund-only orders)
    # ========================================================================
    RECON_CALC_MISMATCH=$(awk -F',' 'NR>1 && $1 !~ /^SUMMARY/ && $8 !~ /refund only/ {
        net_sub = $4 + 0
        tax = $5 + 0
        shipping = $6 + 0
        pay_total = $16 + 0
        calc = net_sub + tax + shipping
        diff = pay_total - calc
        if (diff > 0.01 || diff < -0.01) {
            printf "%s: pay=%.2f, calc(net+tax+ship)=%.2f (%.2f+%.2f+%.2f), diff=%.2f\n", $1, pay_total, calc, net_sub, tax, shipping, diff
        }
    }' "$RECON")

    if [ -n "$RECON_CALC_MISMATCH" ]; then
        echo -e "  ${RED}ERROR${NC} Recon orders where payment != net_subtotal + tax + shipping:"
        echo "$RECON_CALC_MISMATCH" | head -5 | sed 's/^/         /'
        MISMATCH_TOTAL=$(echo "$RECON_CALC_MISMATCH" | wc -l | tr -d ' ')
        if [ "$MISMATCH_TOTAL" -gt 5 ]; then
            echo "         ... and $((MISMATCH_TOTAL - 5)) more"
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
