# Settle Demo Runbook

This runbook guides evaluators and team members through executing a clean, end-to-end demonstration of the Settle Autonomous Cashflow Recovery platform on either local environment or Render deployment.

---

## 1. Prerequisites & Environment

### PayPal Sandbox Buyer Account
For real sandbox payments via PayPal checkout, use the personal buyer account:
- **Email:** `sb-9rzca53715246@personal.example.com`
- **Password:** `H/<Om0q#`

### Target Base URL
- **Local:** `http://localhost:3000`
- **Render:** `https://settle-api.onrender.com` (replace with your active service URL)

---

## 2. Step-by-Step Demo Flow

### Step 1: Reset Environment to Baseline Scenario
Purges transactional records, archives existing PayPal invoice number mappings, and resets the Maya Studio baseline scenario with 14 invoices, 6 payers, and a projected $2,000 cash shortfall.

```bash
curl -X POST "$BASE_URL/api/demo/reset" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (`200 OK`):**
```json
{
  "ok": true,
  "message": "Demo data reset to baseline scenario successfully"
}
```

---

### Step 2: Provision Invoices in PayPal Sandbox
Provisions Maya Studio's candidate demo invoices into PayPal Sandbox. Invoices are created with collision-safe unique numbers (e.g. `INV-1001-XXXX`) and sent to generate live payment links.

```bash
curl -X POST "$BASE_URL/api/demo/provision-paypal" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (`200 OK`):**
```json
{
  "total": 1,
  "provisioned": [
    {
      "invoiceId": "inv_001",
      "paypalInvoiceId": "INV2-...",
      "paypalInvoiceNumber": "INV-1001-...",
      "payUrl": "https://www.sandbox.paypal.com/invoice/p/#..."
    }
  ],
  "failures": []
}
```

---

### Step 3: Run the Autonomous Recovery Agent
The agent evaluates Maya Studio's cash shortfall, policies, and payer risk profiles, then proposes high-confidence recovery actions (e.g. prompt reminders, early-payment discount offers).

```bash
curl -X POST "$BASE_URL/api/agent/run" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (`200 OK`):**
```json
{
  "actionsProposed": [
    {
      "id": "act_...",
      "invoiceId": "inv_001",
      "type": "send_reminder",
      "channel": "email",
      "status": "pending_approval",
      "score": 0.95,
      "urgency": "medium",
      "rationale": "Invoice INV-1001 is overdue..."
    }
  ]
}
```

---

### Step 4: Approve a Proposed Action
Human-in-the-loop approval: approve an action to execute it against the real PayPal Sandbox API.

```bash
# Replace act_... with an action id from Step 3
curl -X POST "$BASE_URL/api/actions/act_.../approve" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (`200 OK`):**
```json
{
  "ok": true,
  "action": {
    "id": "act_...",
    "status": "executed",
    "executedAt": "2026-11-05T..."
  }
}
```

---

### Step 5: Pay the Invoice

#### Option A: Direct Simulation Endpoint (Instant)
Simulate full receipt of $3,500 (`350000` cents) for `inv_001`:

```bash
curl -X POST "$BASE_URL/api/demo/simulate-payment" \
  -H "Content-Type: application/json" \
  -d '{"invoiceId": "inv_001", "amountCents": 350000}'
```

**Expected Response (`200 OK`):**
```json
{
  "ok": true,
  "invoiceId": "inv_001",
  "status": "PAID",
  "amountPaid": 350000,
  "newCashBalance": 1330000
}
```

#### Option B: Real PayPal Sandbox UI Payment
1. Copy the `payUrl` from Step 2.
2. Open the URL in an incognito browser window.
3. Log in with the sandbox credentials:
   - Email: `sb-9rzca53715246@personal.example.com`
   - Password: `H/<Om0q#`
4. Complete payment. The registered PayPal webhook reconciles payment within 15–90 seconds.

---

### Step 6: Verify Cashflow & Shortfall Recovery
Inspect the updated dashboard metrics. Confirm that starting cash has increased from $9,800 to $13,300, eliminating the projected $2,000 shortfall.

```bash
curl -X GET "$BASE_URL/api/dashboard"
```

**Key Verification Fields:**
- `business.startingBalance`: `1330000` ($13,300.00)
- `kpis.cash`: `1330000`
- `kpis.shortfall`: `0` (Shortfall resolved!)
- `invoices[0].status`: `"PAID"`
- `invoices[0].amountPaid`: `350000`
