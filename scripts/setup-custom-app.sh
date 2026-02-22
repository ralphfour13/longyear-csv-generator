#!/bin/bash

# Setup script for Custom App (Private App) deployment
# This configures the app to work with Shopify Admin custom app credentials

set -e

echo "🔧 Sage 50 Journal Entry Sync - Custom App Setup"
echo "================================================"
echo ""
echo "This script will configure your app to work as a Shopify custom app."
echo ""
echo "Prerequisites:"
echo "  1. Created custom app in Shopify Admin (Settings → Apps → Develop apps)"
echo "  2. Have API credentials ready (API key, secret, access token)"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Collect credentials
echo "📝 Enter your custom app credentials:"
echo ""

read -p "Shop domain (e.g., mystore.myshopify.com): " SHOP_DOMAIN
read -p "API Key: " API_KEY
read -p "API Secret: " API_SECRET
read -p "Admin API access token (shpat_...): " ACCESS_TOKEN

echo ""

# Validate inputs
if [ -z "$SHOP_DOMAIN" ] || [ -z "$API_KEY" ] || [ -z "$API_SECRET" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Error: All fields are required"
    exit 1
fi

# Create .env file
echo "📄 Creating .env file..."
cat > .env << EOF
# Shopify Custom App Credentials
SHOPIFY_API_KEY=$API_KEY
SHOPIFY_API_SECRET=$API_SECRET
SHOPIFY_ACCESS_TOKEN=$ACCESS_TOKEN
SHOP_DOMAIN=$SHOP_DOMAIN

# App Configuration
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
NODE_ENV=development
HOST=localhost
PORT=3000
EOF

echo "✅ .env file created"
echo ""

# Update shopify.app.toml
echo "📝 Updating shopify.app.toml..."
sed -i.bak "s/client_id = .*/client_id = \"$API_KEY\"/" shopify.app.toml
echo "✅ Updated client_id"
echo ""

# Initialize shop data directory
echo "📁 Initializing shop data directory..."
mkdir -p "data/$SHOP_DOMAIN"
mkdir -p "data/$SHOP_DOMAIN/exports"

# Create default config
cat > "data/$SHOP_DOMAIN/config.json" << EOF
{
  "shop": "$SHOP_DOMAIN",
  "syncEnabled": false,
  "syncSchedule": "manual",
  "scheduledTime": "02:00",
  "autoExportDate": "yesterday",
  "transactionTypes": {
    "orders": true,
    "refunds": true,
    "payments": true,
    "inventory": false
  },
  "csvFormat": "standard"
}
EOF

echo "✅ Created default config"
echo ""

# Create default mappings
cat > "data/$SHOP_DOMAIN/mappings.json" << 'EOF'
{
  "sales_revenue": {
    "accountCode": "4000-00",
    "accountName": "Sales Revenue",
    "description": "Product sales revenue"
  },
  "sales_tax": {
    "accountCode": "2200-00",
    "accountName": "Sales Tax Payable",
    "description": "Collected sales tax"
  },
  "shipping_revenue": {
    "accountCode": "4100-00",
    "accountName": "Shipping Revenue",
    "description": "Shipping charges"
  },
  "discounts": {
    "accountCode": "4050-00",
    "accountName": "Discounts Given",
    "description": "Customer discounts"
  },
  "accounts_receivable": {
    "accountCode": "1200-00",
    "accountName": "Accounts Receivable"
  },
  "cash_account": {
    "accountCode": "1000-00",
    "accountName": "Cash - Shopify Account",
    "description": "Shopify payouts to bank"
  },
  "clearing_account": {
    "accountCode": "1250-00",
    "accountName": "Shopify Clearing Account",
    "description": "Temporary holding account"
  },
  "payment_processing_fees": {
    "accountCode": "6100-00",
    "accountName": "Payment Processing Fees",
    "description": "Gateway fees"
  },
  "shopify_fees": {
    "accountCode": "6110-00",
    "accountName": "Shopify Transaction Fees"
  },
  "refunds_given": {
    "accountCode": "4900-00",
    "accountName": "Sales Returns & Refunds"
  },
  "cogs": {
    "accountCode": "5000-00",
    "accountName": "Cost of Goods Sold"
  },
  "inventory": {
    "accountCode": "1400-00",
    "accountName": "Inventory Asset"
  }
}
EOF

echo "✅ Created default mappings"
echo ""

# Build the app
echo "🔨 Building app..."
npm run build
echo "✅ Build complete"
echo ""

echo "================================================"
echo "✅ Custom App Setup Complete!"
echo "================================================"
echo ""
echo "Your app is configured for: $SHOP_DOMAIN"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the server:"
echo "   npm start"
echo ""
echo "2. Access the app:"
echo "   http://localhost:3000"
echo ""
echo "3. Configure account mappings:"
echo "   Edit: data/$SHOP_DOMAIN/mappings.json"
echo ""
echo "4. Test export:"
echo "   Visit: http://localhost:3000/app/exports"
echo "   Select date and generate CSV"
echo ""
echo "5. View logs:"
echo "   ./scripts/view-logs.sh $SHOP_DOMAIN"
echo ""
echo "For production deployment, see DEPLOYMENT.md"
echo ""
