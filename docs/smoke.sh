#!/usr/bin/env bash
# ==============================================================================
# Settle API Smoke Test Script
#
# Tests all Contract v1 endpoints against a running Settle API server
# and prints HTTP status codes and responses.
#
# Usage:
#   bash docs/smoke.sh [BASE_URL]
# Default BASE_URL: http://localhost:3000
# ==============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
echo "=================================================="
echo "Settle API Smoke Test: target ${BASE_URL}"
echo "=================================================="

call_endpoint() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local url="${BASE_URL}${path}"

  echo -n "[$method] $path -> "

  if [ -n "$payload" ]; then
    http_code=$(curl -s -o /tmp/smoke_res.json -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$payload" "$url" 2>/dev/null || echo "000")
  else
    http_code=$(curl -s -o /tmp/smoke_res.json -w "%{http_code}" -X "$method" \
      "$url" 2>/dev/null || echo "000")
  fi

  echo "HTTP $http_code"
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    # Print sample / summary of response (first 120 chars)
    head -c 120 /tmp/smoke_res.json 2>/dev/null || true
    echo ""
  else
    echo "  Response body:"
    cat /tmp/smoke_res.json 2>/dev/null || true
    echo ""
  fi
}

# 1. Health check
call_endpoint "GET" "/health"

# 2. Reset to baseline seed scenario
call_endpoint "POST" "/api/demo/reset"

# 3. Dashboard
call_endpoint "GET" "/api/dashboard"

# 4. Invoices
call_endpoint "GET" "/api/invoices"

# 5. Agent run (cycle)
call_endpoint "POST" "/api/agent/run"

# 6. Actions list
call_endpoint "GET" "/api/actions"

# 7. Action approve & reject
call_endpoint "POST" "/api/actions/act_001/approve"
call_endpoint "POST" "/api/actions/act_001/reject"

# 8. Simulate scenario
SIMULATE_PAYLOAD='{
  "horizonDays": 14,
  "changes": [
    {
      "type": "PAY_EARLY",
      "invoiceId": "inv_001",
      "expectedDay": 3,
      "discountPct": 5
    }
  ]
}'
call_endpoint "POST" "/api/simulate" "$SIMULATE_PAYLOAD"

# 9. Chat
CHAT_PAYLOAD='{
  "message": "What is our cash forecast for the next 14 days?"
}'
call_endpoint "POST" "/api/chat" "$CHAT_PAYLOAD"

# 10. Audit trail
call_endpoint "GET" "/api/audit"

# 11. Policy get & update
call_endpoint "GET" "/api/policy"

POLICY_PAYLOAD='{
  "maxDiscountPct": 12,
  "maxInstalments": 4,
  "minInstalmentSpacingDays": 7,
  "quietHours": {
    "startHour": 20,
    "endHour": 8
  },
  "maxRemindersPerInvoicePerWeek": 2,
  "autoApproveMaxAmount": 500000,
  "requireApprovalFor": ["OFFER_DISCOUNT"]
}'
call_endpoint "PUT" "/api/policy" "$POLICY_PAYLOAD"

# 12. PayPal Webhook
WEBHOOK_PAYLOAD='{
  "id": "WH-SMOKE-TEST-001",
  "event_type": "INVOICING.INVOICE.PAID",
  "resource": {
    "invoice": {
      "id": "INV2-SMOKE-TEST"
    }
  }
}'
call_endpoint "POST" "/api/webhooks/paypal" "$WEBHOOK_PAYLOAD"

# 13. Demo Reset again
call_endpoint "POST" "/api/demo/reset"

echo "=================================================="
echo "Smoke test completed!"
echo "=================================================="

