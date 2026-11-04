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

# 5. Provision PayPal demo invoices
call_endpoint "POST" "/api/demo/provision-paypal"

# 6. Agent run (cycle)
call_endpoint "POST" "/api/agent/run"

# 7. Actions list
call_endpoint "GET" "/api/actions"

# 8. Action approve & reject (dynamically select from action list if available)
FIRST_ACTION_ID=$(curl -s "${BASE_URL}/api/actions" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4 || echo "act_001")
SECOND_ACTION_ID=$(curl -s "${BASE_URL}/api/actions" | grep -o '"id":"[^"]*' | head -n 2 | tail -n 1 | cut -d'"' -f4 || echo "act_002")

if [ -n "$FIRST_ACTION_ID" ]; then
  call_endpoint "POST" "/api/actions/${FIRST_ACTION_ID}/approve" '{"note":"Approved via smoke test"}'
fi
if [ -n "$SECOND_ACTION_ID" ]; then
  call_endpoint "POST" "/api/actions/${SECOND_ACTION_ID}/reject" '{"note":"Rejected via smoke test"}'
fi

# 9. Simulate scenario (Contract v1 shape: { change: ScenarioChange })
SIMULATE_PAYLOAD='{
  "change": {
    "type": "REMIND",
    "invoiceId": "inv_001",
    "newExpectedDate": "2026-11-08"
  }
}'
call_endpoint "POST" "/api/simulate" "$SIMULATE_PAYLOAD"

# 10. Chat (Contract v1 shape: { question: string })
CHAT_PAYLOAD='{
  "question": "What is our cash forecast for the next 14 days?"
}'
call_endpoint "POST" "/api/chat" "$CHAT_PAYLOAD"

# 11. Audit trail
call_endpoint "GET" "/api/audit"

# 12. Policy get & update & restore
echo "Reading current policy..."
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

# 13. Simulate demo payment against provisioned invoice
call_endpoint "POST" "/api/demo/simulate-payment" '{"invoiceId":"inv_001","amount":50000}'

# 14. PayPal Webhook
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

# 15. Demo Reset again
call_endpoint "POST" "/api/demo/reset"

echo "=================================================="
echo "Smoke test completed successfully!"
echo "=================================================="
