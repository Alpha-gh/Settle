#!/usr/bin/env bash
# ==============================================================================
# Settle API Smoke Test Script
#
# Tests all Contract v1 endpoints against a running Settle API server
# and verifies HTTP status codes.
#
# Usage:
#   bash docs/smoke.sh [BASE_URL]
# Example:
#   bash docs/smoke.sh https://settle-api.onrender.com
# Default BASE_URL: http://localhost:3000
# ==============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
# Strip any trailing slash from BASE_URL
BASE_URL="${BASE_URL%/}"

TEMP_FILE="${TMPDIR:-/tmp}/settle_smoke_res.json"
FAILURES=0

echo "=================================================="
echo "Settle API Smoke Test: target ${BASE_URL}"
echo "=================================================="

call_endpoint() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local expected_codes="${4:-200 201 204}"
  local url="${BASE_URL}${path}"

  echo -n "[$method] $path -> "

  local http_code
  if [ -n "$payload" ]; then
    http_code=$(curl -s -o "$TEMP_FILE" -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$payload" "$url" 2>/dev/null || echo "000")
  else
    http_code=$(curl -s -o "$TEMP_FILE" -w "%{http_code}" -X "$method" \
      "$url" 2>/dev/null || echo "000")
  fi

  echo "HTTP $http_code"
  if [[ " $expected_codes " =~ " $http_code " ]] || ([ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]); then
    head -c 120 "$TEMP_FILE" 2>/dev/null || true
    echo ""
  else
    echo "  [ERROR] Response body:"
    cat "$TEMP_FILE" 2>/dev/null || true
    echo ""
    FAILURES=$((FAILURES + 1))
  fi
}

# 1. Landing Page at /
call_endpoint "GET" "/"

# 2. Health check
call_endpoint "GET" "/health"

# 3. Reset to baseline seed scenario
call_endpoint "POST" "/api/demo/reset" "{}"

# 4. Dashboard
call_endpoint "GET" "/api/dashboard"

# 5. Invoices
call_endpoint "GET" "/api/invoices"

# 6. Provision PayPal demo invoices
call_endpoint "POST" "/api/demo/provision-paypal" "{}"

# 7. Agent run (cycle)
call_endpoint "POST" "/api/agent/run" "{}"

# 8. Actions list
call_endpoint "GET" "/api/actions"

# 9. Action approve & reject
FIRST_ACTION_ID=$(curl -s "${BASE_URL}/api/actions" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4 || echo "")
SECOND_ACTION_ID=$(curl -s "${BASE_URL}/api/actions" | grep -o '"id":"[^"]*' | head -n 2 | tail -n 1 | cut -d'"' -f4 || echo "")

if [ -n "$FIRST_ACTION_ID" ]; then
  call_endpoint "POST" "/api/actions/${FIRST_ACTION_ID}/approve" '{"note":"Approved via smoke test"}'
fi
if [ -n "$SECOND_ACTION_ID" ]; then
  call_endpoint "POST" "/api/actions/${SECOND_ACTION_ID}/reject" '{"note":"Rejected via smoke test"}'
fi

# 10. Simulate scenario
SIMULATE_PAYLOAD='{
  "change": {
    "type": "REMIND",
    "invoiceId": "inv_001",
    "newExpectedDate": "2026-11-08"
  }
}'
call_endpoint "POST" "/api/simulate" "$SIMULATE_PAYLOAD"

# 11. Chat
CHAT_PAYLOAD='{
  "question": "What is our cash forecast for the next 14 days?"
}'
call_endpoint "POST" "/api/chat" "$CHAT_PAYLOAD"

# 12. Audit trail
call_endpoint "GET" "/api/audit"

# 13. Policy get, update, and restore original defaults
echo "Capturing current policy..."
ORIG_POLICY=$(curl -s "${BASE_URL}/api/policy" || echo "{}")
call_endpoint "GET" "/api/policy"

POLICY_PAYLOAD='{
  "maxDiscountPct": 12,
  "maxInstalments": 4,
  "quietHours": {
    "startHour": 20,
    "endHour": 8
  },
  "maxRemindersPerInvoicePerWeek": 2,
  "autoApproveMaxAmount": 500000,
  "requireApprovalFor": ["OFFER_DISCOUNT"]
}'
call_endpoint "PUT" "/api/policy" "$POLICY_PAYLOAD"

echo "Restoring original policy defaults..."
call_endpoint "PUT" "/api/policy" "$ORIG_POLICY"

# 14. Simulate demo payment against provisioned invoice
call_endpoint "POST" "/api/demo/simulate-payment" '{"invoiceId":"inv_001","amountCents":50000}'

# 15. PayPal Webhook (accepts 200 or 400 INVALID_SIGNATURE for unsigned test payload)
WEBHOOK_PAYLOAD='{
  "id": "WH-SMOKE-TEST-001",
  "event_type": "INVOICING.INVOICE.PAID",
  "resource": {
    "invoice": {
      "id": "INV2-SMOKE-TEST"
    }
  }
}'
call_endpoint "POST" "/api/webhooks/paypal" "$WEBHOOK_PAYLOAD" "200 400"

# 16. Final reset to leave clean state
call_endpoint "POST" "/api/demo/reset" "{}"

# Clean up temp file
rm -f "$TEMP_FILE" 2>/dev/null || true

echo "=================================================="
if [ "$FAILURES" -gt 0 ]; then
  echo "Smoke test FAILED with $FAILURES endpoint errors!"
  exit 1
fi

echo "Smoke test completed successfully (0 errors)!"
echo "=================================================="
exit 0
