#!/bin/bash

# Validate a CSV file for Sage 50 import
# Usage: ./scripts/validate-csv.sh <path-to-csv>

if [ -z "$1" ]; then
    echo "Usage: ./scripts/validate-csv.sh <path-to-csv>"
    echo ""
    echo "Example: ./scripts/validate-csv.sh data/shop.myshopify.com/exports/journal-entries-2024-01-15.csv"
    exit 1
fi

CSV_FILE=$1

if [ ! -f "$CSV_FILE" ]; then
    echo "Error: File not found: $CSV_FILE"
    exit 1
fi

echo "✅ Validating CSV: $(basename $CSV_FILE)"
echo "======================================"
echo ""

# Check header
echo "1. Checking header..."
HEADER=$(head -1 "$CSV_FILE")
EXPECTED="Date,Reference,Account,Debit,Credit,Memo"

if [ "$HEADER" = "$EXPECTED" ]; then
    echo "   ✓ Header is correct"
else
    echo "   ✗ Header mismatch"
    echo "   Expected: $EXPECTED"
    echo "   Got:      $HEADER"
fi

echo ""

# Count entries
echo "2. Counting entries..."
ENTRY_COUNT=$(($(wc -l < "$CSV_FILE") - 1))
echo "   Total entries: $ENTRY_COUNT"

echo ""

# Check balance
echo "3. Checking balance..."
BALANCE=$(awk -F',' 'NR>1 {debit+=$4; credit+=$5} END {printf "Debit: %.2f, Credit: %.2f, Diff: %.2f", debit, credit, debit-credit}' "$CSV_FILE")
echo "   $BALANCE"

DIFF=$(awk -F',' 'NR>1 {debit+=$4; credit+=$5} END {printf "%.2f", debit-credit}' "$CSV_FILE")

if [ "$DIFF" = "0.00" ] || [ "$DIFF" = "-0.00" ]; then
    echo "   ✓ Entries are balanced!"
else
    echo "   ✗ Entries are NOT balanced (difference: $DIFF)"
fi

echo ""

# Check date format
echo "4. Checking date format..."
BAD_DATES=$(awk -F',' 'NR>1 && $1 !~ /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/ {print NR": "$1}' "$CSV_FILE")

if [ -z "$BAD_DATES" ]; then
    echo "   ✓ All dates in correct format (MM/DD/YYYY)"
else
    echo "   ✗ Invalid date format found:"
    echo "$BAD_DATES"
fi

echo ""

# Check for missing values
echo "5. Checking for missing values..."
MISSING=$(awk -F',' 'NR>1 && (NF != 6 || $1=="" || $2=="" || $3=="" || $6=="") {print NR}' "$CSV_FILE")

if [ -z "$MISSING" ]; then
    echo "   ✓ No missing values"
else
    echo "   ✗ Missing values on lines: $MISSING"
fi

echo ""

# Sample entries
echo "6. Sample entries (first 5):"
echo "--------------------------------------"
head -6 "$CSV_FILE" | tail -5 | nl -v 1

echo ""

# Summary
echo "======================================"
echo "📊 Summary"
echo "======================================"
echo "File: $CSV_FILE"
echo "Entries: $ENTRY_COUNT"
echo "Balance: $BALANCE"

if [ "$DIFF" = "0.00" ] || [ "$DIFF" = "-0.00" ]; then
    echo "Status: ✅ Ready for import"
else
    echo "Status: ❌ Needs review"
fi

echo ""
