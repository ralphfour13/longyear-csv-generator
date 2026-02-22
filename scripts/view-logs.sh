#!/bin/bash

# View logs for a specific shop
# Usage: ./scripts/view-logs.sh [shop-domain]

if [ -z "$1" ]; then
    echo "Usage: ./scripts/view-logs.sh <shop-domain>"
    echo ""
    echo "Available shops:"
    ls -1 data/ 2>/dev/null || echo "  No shops found"
    exit 1
fi

SHOP=$1
LOG_DIR="data/$SHOP"

if [ ! -d "$LOG_DIR" ]; then
    echo "Error: Shop directory not found: $LOG_DIR"
    exit 1
fi

echo "📋 Logs for: $SHOP"
echo "======================================"
echo ""

# Error log
if [ -f "$LOG_DIR/error.log" ]; then
    echo "🔴 Error Log (last 20 entries):"
    echo "--------------------------------------"
    tail -20 "$LOG_DIR/error.log" | while IFS= read -r line; do
        echo "$line" | jq -r '"\(.timestamp) [\(.level)] \(.context): \(.message)"' 2>/dev/null || echo "$line"
    done
    echo ""
else
    echo "ℹ️  No error log found"
    echo ""
fi

# Scheduled exports log
if [ -f "$LOG_DIR/scheduled-exports.log" ]; then
    echo "📅 Scheduled Exports (last 10):"
    echo "--------------------------------------"
    tail -10 "$LOG_DIR/scheduled-exports.log" | while IFS= read -r line; do
        echo "$line" | jq -r 'if .success then "✅ \(.timestamp): \(.filename) (\(.entryCount) entries)" else "❌ \(.timestamp): \(.error)" end' 2>/dev/null || echo "$line"
    done
    echo ""
else
    echo "ℹ️  No scheduled exports log found"
    echo ""
fi

# Recent exports
if [ -d "$LOG_DIR/exports" ]; then
    EXPORT_COUNT=$(ls -1 "$LOG_DIR/exports" | wc -l)
    echo "📦 Recent Exports ($EXPORT_COUNT total):"
    echo "--------------------------------------"
    ls -lht "$LOG_DIR/exports" | head -6 | tail -5 | awk '{print $9, "-", $5}'
    echo ""
else
    echo "ℹ️  No exports directory found"
    echo ""
fi

echo "======================================"
echo ""
echo "Commands:"
echo "  View full error log:     cat $LOG_DIR/error.log"
echo "  View scheduled log:      cat $LOG_DIR/scheduled-exports.log"
echo "  List all exports:        ls -lh $LOG_DIR/exports/"
echo ""
