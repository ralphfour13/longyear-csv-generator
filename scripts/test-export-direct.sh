#!/bin/bash

# Direct API test script - bypasses UI
# Tests the export functionality directly

if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo "Run ./scripts/setup-custom-app.sh first"
    exit 1
fi

# Load environment variables
source .env

echo "🧪 Testing Direct Export"
echo "========================"
echo ""
echo "Shop: $SHOP_DOMAIN"
echo ""

# Get date to export (default: yesterday)
if [ -z "$1" ]; then
    # Calculate yesterday
    EXPORT_DATE=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
    echo "Using yesterday: $EXPORT_DATE"
else
    EXPORT_DATE=$1
    echo "Using provided date: $EXPORT_DATE"
fi

echo ""
echo "📥 Fetching payouts for $EXPORT_DATE..."
echo ""

# Create test script
cat > /tmp/test-export.mjs << EOF
import { processExport } from './app/services/batch-processor.server.ts';

const shop = '$SHOP_DOMAIN';
const accessToken = '$SHOPIFY_ACCESS_TOKEN';
const startDate = '$EXPORT_DATE';
const endDate = '$EXPORT_DATE';

console.log(\`Testing export for \${shop} on \${startDate}...\`);

try {
  const result = await processExport(shop, accessToken, startDate, endDate);

  console.log('\\n✅ Export Success!');
  console.log('==================');
  console.log('Filename:', result.filename);
  console.log('Entries:', result.entryCount);
  console.log('Total Debit:', result.totalDebit.toFixed(2));
  console.log('Total Credit:', result.totalCredit.toFixed(2));
  console.log('Balanced:', result.balanced ? '✅ Yes' : '❌ No');
  console.log('Download:', result.downloadUrl);
  console.log('');

  process.exit(0);
} catch (error) {
  console.error('\\n❌ Export Failed:');
  console.error(error.message);
  process.exit(1);
}
EOF

# Run test
node --loader tsx /tmp/test-export.mjs

# Clean up
rm /tmp/test-export.mjs

echo ""
echo "✅ Test complete!"
echo ""
echo "Next steps:"
echo "  1. Validate CSV: ./scripts/validate-csv.sh data/$SHOP_DOMAIN/exports/journal-entries-*.csv"
echo "  2. View logs: ./scripts/view-logs.sh $SHOP_DOMAIN"
echo "  3. Import to Sage 50"
echo ""
