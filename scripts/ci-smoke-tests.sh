#!/bin/bash
# CI Smoke Tests Script
# Usage: ./scripts/ci-smoke-tests.sh <app-url>
# Example: ./scripts/ci-smoke-tests.sh https://sage50-sync.four13.dev

set -e

APP_URL="${1:-https://sage50-sync.four13.dev}"

echo "Running smoke tests for: $APP_URL"
echo ""

# Test 1: Homepage
echo "Test 1: Homepage..."
if curl -f -s "$APP_URL" > /dev/null; then
  echo "✓ Homepage responding"
else
  echo "❌ Homepage test failed"
  exit 1
fi

# Test 2: Auth endpoint
echo "Test 2: Auth endpoint..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/auth")
if [ "$STATUS" = "200" ] || [ "$STATUS" = "302" ]; then
  echo "✓ Auth endpoint responding (HTTP $STATUS)"
else
  echo "❌ Auth endpoint test failed (HTTP $STATUS)"
  exit 1
fi

# Test 3: Health endpoint
echo "Test 3: Health endpoint..."
if command -v jq &> /dev/null; then
  HEALTH_STATUS=$(curl -s "$APP_URL/api/healthz" | jq -r '.status')
  if [ "$HEALTH_STATUS" = "ok" ]; then
    echo "✓ Health endpoint reports OK status"
  else
    echo "❌ Health endpoint reports non-OK status: $HEALTH_STATUS"
    exit 1
  fi
else
  # Fallback if jq is not available
  if curl -f -s "$APP_URL/api/healthz" | grep -q '"status":"ok"'; then
    echo "✓ Health endpoint reports OK status"
  else
    echo "❌ Health endpoint test failed"
    exit 1
  fi
fi

echo ""
echo "✓ All smoke tests passed"
exit 0
