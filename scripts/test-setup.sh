#!/bin/bash

# Sage 50 Journal Entry Sync - Test Setup Script
# This script helps verify the app is set up correctly

set -e

echo "🧪 Sage 50 Journal Entry Sync - Test Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if node is installed
echo "1. Checking Node.js installation..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓${NC} Node.js installed: $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js >= 20.19"
    exit 1
fi

# Check if npm is installed
echo ""
echo "2. Checking npm installation..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}✓${NC} npm installed: $NPM_VERSION"
else
    echo -e "${RED}✗${NC} npm not found"
    exit 1
fi

# Check if dependencies are installed
echo ""
echo "3. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${YELLOW}⚠${NC} Dependencies not installed"
    echo "   Run: npm install"
fi

# Check if Prisma is set up
echo ""
echo "4. Checking Prisma setup..."
if [ -d "node_modules/.prisma" ]; then
    echo -e "${GREEN}✓${NC} Prisma client generated"
else
    echo -e "${YELLOW}⚠${NC} Prisma client not generated"
    echo "   Run: npx prisma generate"
fi

# Check if data directory exists
echo ""
echo "5. Checking data directory..."
if [ -d "data" ]; then
    echo -e "${GREEN}✓${NC} Data directory exists"

    # Count shop directories
    SHOP_COUNT=$(find data -maxdepth 1 -type d | wc -l)
    SHOP_COUNT=$((SHOP_COUNT - 1)) # Subtract the data directory itself

    if [ $SHOP_COUNT -gt 0 ]; then
        echo "   Shops configured: $SHOP_COUNT"

        # List shop directories
        for shop_dir in data/*/; do
            shop_name=$(basename "$shop_dir")
            echo "   - $shop_name"

            # Check config files
            if [ -f "$shop_dir/config.json" ]; then
                echo -e "     ${GREEN}✓${NC} config.json"
            else
                echo -e "     ${YELLOW}⚠${NC} config.json missing"
            fi

            if [ -f "$shop_dir/mappings.json" ]; then
                echo -e "     ${GREEN}✓${NC} mappings.json"
            else
                echo -e "     ${YELLOW}⚠${NC} mappings.json missing"
            fi

            # Check exports
            if [ -d "$shop_dir/exports" ]; then
                EXPORT_COUNT=$(ls -1 "$shop_dir/exports" 2>/dev/null | wc -l)
                if [ $EXPORT_COUNT -gt 0 ]; then
                    echo "     Exports: $EXPORT_COUNT file(s)"
                fi
            fi
        done
    else
        echo -e "   ${YELLOW}⚠${NC} No shops configured yet"
    fi
else
    echo -e "${YELLOW}⚠${NC} Data directory not created yet"
    echo "   Will be created on first run"
fi

# Check environment files
echo ""
echo "6. Checking environment configuration..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file exists"

    # Check for required variables
    if grep -q "SHOPIFY_API_KEY" .env; then
        echo -e "   ${GREEN}✓${NC} SHOPIFY_API_KEY configured"
    else
        echo -e "   ${YELLOW}⚠${NC} SHOPIFY_API_KEY not found"
    fi

    if grep -q "SHOPIFY_API_SECRET" .env; then
        echo -e "   ${GREEN}✓${NC} SHOPIFY_API_SECRET configured"
    else
        echo -e "   ${YELLOW}⚠${NC} SHOPIFY_API_SECRET not found"
    fi
else
    echo -e "${YELLOW}⚠${NC} .env file not found"
    echo "   Shopify CLI will provide credentials during development"
fi

# Check shopify.app.toml
echo ""
echo "7. Checking Shopify app configuration..."
if [ -f "shopify.app.toml" ]; then
    echo -e "${GREEN}✓${NC} shopify.app.toml exists"

    # Check scopes
    if grep -q "read_shopify_payments_payouts" shopify.app.toml; then
        echo -e "   ${GREEN}✓${NC} Required scopes configured"
    else
        echo -e "   ${RED}✗${NC} Missing required scopes"
        echo "   Run: ./scripts/fix-scopes.sh"
    fi
else
    echo -e "${RED}✗${NC} shopify.app.toml not found"
fi

# Check TypeScript compilation
echo ""
echo "8. Checking TypeScript..."
if npm run typecheck &> /dev/null; then
    echo -e "${GREEN}✓${NC} TypeScript compiles successfully"
else
    echo -e "${RED}✗${NC} TypeScript errors found"
    echo "   Run: npm run typecheck"
fi

# Summary
echo ""
echo "=========================================="
echo "📊 Setup Summary"
echo "=========================================="

# Determine overall status
ISSUES=0

if ! command -v node &> /dev/null; then
    ISSUES=$((ISSUES + 1))
fi

if [ ! -d "node_modules" ]; then
    ISSUES=$((ISSUES + 1))
fi

if [ ! -d "node_modules/.prisma" ]; then
    ISSUES=$((ISSUES + 1))
fi

if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: npm run dev"
    echo "  2. Install app on development store"
    echo "  3. Configure account mappings"
    echo "  4. Test manual export"
    echo ""
    echo "See DEPLOYMENT.md for detailed testing guide"
else
    echo -e "${YELLOW}⚠ $ISSUES issue(s) found${NC}"
    echo ""
    echo "Please resolve the issues above before starting"
fi

echo ""
