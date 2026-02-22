#!/bin/bash

# Quick start script for first-time setup
# This automates the initial setup process

set -e

echo "🚀 Sage 50 Journal Entry Sync - Quick Start"
echo "============================================"
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 2: Generate Prisma client
echo "🔧 Step 2: Setting up database..."
npx prisma generate
npx prisma migrate deploy
echo "✅ Database ready"
echo ""

# Step 3: Verify TypeScript
echo "📝 Step 3: Checking TypeScript..."
npm run typecheck
echo "✅ TypeScript validated"
echo ""

# Step 4: Run test setup
echo "🧪 Step 4: Running setup tests..."
./scripts/test-setup.sh
echo ""

echo "============================================"
echo "✅ Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start development server:"
echo "   npm run dev"
echo ""
echo "2. Follow the Shopify CLI URL to install the app"
echo ""
echo "3. Configure the app:"
echo "   - Visit /app/mappings to set account codes"
echo "   - Visit /app/settings to configure schedule"
echo "   - Visit /app/exports to generate first CSV"
echo ""
echo "4. See DEPLOYMENT.md for detailed testing guide"
echo ""
echo "Happy syncing! 🎉"
echo ""
