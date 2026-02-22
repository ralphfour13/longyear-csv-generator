#!/bin/bash

# Deploy to CapRover script

set -e

echo "🚀 Deploying Sage 50 Journal Entry Sync to CapRover"
echo "===================================================="
echo ""

# Check if caprover CLI is installed
if ! command -v caprover &> /dev/null; then
    echo "📦 Installing CapRover CLI..."
    npm install -g caprover
fi

echo "📋 CapRover Deployment Checklist:"
echo ""
echo "Before deploying, ensure you have:"
echo "  ✅ Created app 'sage50-sync' in CapRover dashboard"
echo "  ✅ Set environment variables (see below)"
echo "  ✅ Added persistent directory: /app/data"
echo "  ✅ Enabled HTTPS"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Deploy
echo "🚀 Deploying to CapRover..."
caprover deploy

echo ""
echo "===================================================="
echo "✅ Deployment Complete!"
echo "===================================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Run database migration:"
echo "   caprover run -a sage50-sync -c 'npx prisma migrate deploy'"
echo ""
echo "2. Get your app URL from CapRover dashboard"
echo "   Example: https://sage50-sync.yourdomain.com"
echo ""
echo "3. Update shopify.app.sage-50-sync-for-fly-shop.toml:"
echo "   application_url = \"https://sage50-sync.yourdomain.com\""
echo ""
echo "4. Redeploy to Shopify:"
echo "   shopify app deploy --force"
echo ""
echo "5. Test in Shopify Admin!"
echo ""
echo "===================================================="
echo ""
echo "Environment Variables to Set in CapRover:"
echo ""
echo "NODE_ENV=production"
echo "SHOPIFY_API_KEY=ec004ce28be778f86415a4b18a7ab9a2"
echo "SHOPIFY_API_SECRET=your_secret"
echo "DATABASE_URL=your_neon_connection_string"
echo ""
