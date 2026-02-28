#!/bin/bash
# CI Health Check Script
# Usage: ./scripts/ci-health-check.sh <health-endpoint-url>
# Example: ./scripts/ci-health-check.sh https://sage50-sync.four13.dev/api/healthz

set -e

HEALTH_URL="${1:-https://sage50-sync.four13.dev/api/healthz}"
MAX_ATTEMPTS=12
INTERVAL=10
ATTEMPT=1

echo "Starting health check for: $HEALTH_URL"
echo "Max attempts: $MAX_ATTEMPTS, Interval: ${INTERVAL}s"
echo ""

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo "Attempt $ATTEMPT/$MAX_ATTEMPTS..."

  if RESPONSE=$(curl -f -s "$HEALTH_URL" 2>&1); then
    echo "✓ Health check passed!"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    exit 0
  else
    echo "Health check failed, retrying in ${INTERVAL}s..."
    sleep $INTERVAL
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

echo "❌ Health check failed after $MAX_ATTEMPTS attempts"
exit 1
