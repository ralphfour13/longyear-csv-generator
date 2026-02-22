#!/bin/bash

# Deploy to Vercel script

set -e

echo "🚀 Deploying Sage 50 Journal Entry Sync to Vercel"
echo "=================================================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
fi

# Install dependencies including Vercel Blob
echo "📦 Installing dependencies..."
npm install

# Build the app
echo "🔨 Building app..."
npm run build

echo ""
echo "✅ Build complete!"
echo ""

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
echo ""
echo "You'll be prompted to:"
echo "  1. Link to existing project or create new"
echo "  2. Configure project settings"
echo "  3. Set environment variables"
echo ""

vercel --prod

echo ""
echo "=================================================="
echo "✅ Deployment Complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Set environment variables in Vercel:"
echo "   - SHOPIFY_API_KEY"
echo "   - SHOPIFY_API_SECRET"
echo "   - DATABASE_URL (PostgreSQL)"
echo "   - BLOB_READ_WRITE_TOKEN (auto-generated)"
echo "   - CRON_SECRET (random string)"
echo ""
echo "2. Update shopify.app.toml with your Vercel URL:"
echo "   application_url = \"https://your-app.vercel.app\""
echo ""
echo "3. Redeploy to Shopify:"
echo "   shopify app deploy --force"
echo ""
echo "4. Access your app in Shopify admin!"
echo ""
