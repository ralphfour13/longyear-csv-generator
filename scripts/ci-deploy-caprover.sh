#!/bin/bash
# CI CapRover Deployment Script
# Usage: ./scripts/ci-deploy-caprover.sh
# Requires environment variables:
#   CAPROVER_API_TOKEN or CAPROVER_PASSWORD
#   CAPROVER_URL (default: https://captain.server.four13.dev)
#   CAPROVER_APP (default: sage50-journal-entry-sync-prod)

set -e

CAPROVER_URL="${CAPROVER_URL:-https://captain.server.four13.dev}"
CAPROVER_APP="${CAPROVER_APP:-sage50-journal-entry-sync-prod}"
TARBALL="${TARBALL:-deploy.tar}"

echo "CapRover Deployment Script"
echo "=========================="
echo "URL: $CAPROVER_URL"
echo "App: $CAPROVER_APP"
echo ""

# Check if CapRover CLI is installed
if ! command -v caprover &> /dev/null; then
  echo "Installing CapRover CLI..."
  npm install -g caprover
fi

# Authenticate
echo "Authenticating with CapRover..."
if [ -n "$CAPROVER_API_TOKEN" ]; then
  echo "Using API token authentication"
  caprover login --apiToken "$CAPROVER_API_TOKEN" --caproverUrl "$CAPROVER_URL"
elif [ -n "$CAPROVER_PASSWORD" ]; then
  echo "Using password authentication"
  echo "$CAPROVER_PASSWORD" | caprover login --caproverUrl "$CAPROVER_URL"
else
  echo "❌ Error: Neither CAPROVER_API_TOKEN nor CAPROVER_PASSWORD is set"
  exit 1
fi

# Create tarball if it doesn't exist
if [ ! -f "$TARBALL" ]; then
  echo "Creating deployment tarball..."
  tar -czf "$TARBALL" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='data' \
    --exclude='build' \
    --exclude='.github' \
    --exclude='*.log' \
    --exclude='.env' \
    .
  echo "Created: $TARBALL ($(ls -lh $TARBALL | awk '{print $5}'))"
fi

# Deploy
echo "Deploying to CapRover..."
caprover deploy \
  --caproverUrl "$CAPROVER_URL" \
  --caproverApp "$CAPROVER_APP" \
  --tarFile "$TARBALL"

echo ""
echo "✓ Deployment completed successfully"
exit 0
