# PayPal Sandbox Invoicing v2 Spike Report

## Overview
This document records the empirical results of probing PayPal Invoicing v2 in the sandbox environment, verifying the round-trip invoicing lifecycle, and documenting operational behaviors.

---

## Operations & Endpoint Results Table

| Step | Operation | Method | PayPal Endpoint | HTTP Status | Observed Result & Notes |
|:---:|:---|:---:|:---|:---:|:---|
| 1 | **OAuth 2.0 Token** | `POST` | `/v1/oauth2/token` | 200 OK | Basic auth (`base64(client_id:client_secret)`). Returned `access_token` valid for 32,400s (~9h). Cached in-memory with early refresh buffer. |
| 2 | **Generate Invoice #** | `POST` | `/v2/invoicing/generate-next-invoice-number` | 200 OK | Returns next sequential invoice number (e.g. `0001`, `0002`). |
| 3 | **Create Draft** | `POST` | `/v2/invoicing/invoices` | 201 Created | Requires `Prefer: return=representation` to return full JSON body with `id` (`INV2-XXXX-XXXX-XXXX-XXXX`). Created with status `DRAFT`. |
| 4 | **Send Invoice** | `POST` | `/v2/invoicing/invoices/{id}/send` | 200 OK / 202 Accepted | Transitions status from `DRAFT` to `SENT`. Returns `rel: "payer-view"` link: `https://www.sandbox.paypal.com/invoice/p/#{id}`. |
| 5 | **Send Reminder** | `POST` | `/v2/invoicing/invoices/{id}/remind` | 200 OK / 204 No Content | Sends reminder to payer email. Allowed only when invoice status is `SENT`, `UNPAID`, or `PARTIALLY_PAID`. |
| 6 | **Update Due Date & Discount** | `PUT` | `/v2/invoicing/invoices/{id}` | 200 OK | **Direct update on SENT invoice works!** Updated `payment_term.due_date` and applied 10% discount under `amount.breakdown.discount.invoice_discount.percent`. Total amount correctly re-evaluated. |
| 7 | **Partial Payments** | `PUT` | `/v2/invoicing/invoices/{id}` | 400 Bad Request | Account returned `"Partial payments are not available in your country."` On refusal, client fallback can cancel-and-reissue or record partial payments externally. |
| 8 | **Cancel Invoice** | `POST` | `/v2/invoicing/invoices/{id}/cancel` | 204 No Content | Transitions `SENT` invoice to `CANCELLED`. Used as fallback when direct `PUT` is refused for restricted fields. |
| 9 | **Record Payment** | `POST` | `/v2/invoicing/invoices/{id}/payments` | 200 OK | External payment recorded (e.g. `method: "OTHER"`). Full payment transitions status to `MARKED_AS_PAID` (mapped to `PAID`). Partial payment transitions status to `PARTIALLY_PAID`. |
| 10 | **Get Invoice** | `GET` | `/v2/invoicing/invoices/{id}` | 200 OK | Returns status and `payments.paid_amount.value`. Successfully mapped to domain `InvoiceStatus` and integer `Cents`. |
| 11 | **Webhook Query** | `GET` | `/v1/notifications/webhooks-events` | 200 OK | Lists recent asynchronous webhook event deliveries. |

---

## Key Findings & Sandbox Behaviors

### 1. Update-After-Send Behavior
- **Does update-after-send work?**
  **YES.** Direct `PUT /v2/invoicing/invoices/{id}` on an already-`SENT` invoice is supported by PayPal Invoicing v2 for `due_date` and `discount` (`invoice_discount`).
- **Calculation Rule**:
  When modifying discount or line items, `amount.value` must exactly equal `item_total - discount`. Omitting or mismatching this produces HTTP 400 `calculation_error: Amount is invalid`.
- **Cancel-and-Reissue Fallback**:
  If a direct `PUT` is rejected (e.g. due to field-level business constraints or account limitations), our `PayPalClient` implements a seamless fallback:
  1. Cancels the existing invoice via `POST /v2/invoicing/invoices/{id}/cancel`.
  2. Generates a new invoice number and creates a new draft with the updated terms.
  3. Sends the new invoice to the recipient.
  4. Maintains an internal mapping (`reissuedMap`) from the original ID to the new ID so subsequent calls resolve transparently.

### 2. Partial Payments
- In certain PayPal sandbox country accounts, `configuration.partial_payment.allow_partial_payment: true` is disallowed with error:
  `"Partial payments are not available in your country."`
- However, recording an external payment of less than the full amount via `POST /v2/invoicing/invoices/{id}/payments` succeeds and natively transitions the invoice status to `PARTIALLY_PAID`.

### 3. Invoice Dates & Statuses
- If `invoice_date` is in the future, sending the invoice puts it into `SCHEDULED` status rather than `SENT`.
- Scheduled invoices cannot be reminded (`CANNOT_REMIND_INVOICE`) and cannot be cancelled (`CANNOT_CANCEL_SCHEDULED_INVOICE`).
- To prevent accidental `SCHEDULED` status, `createAndSendInvoice` sets `invoice_date` to today or past dates only.

### 4. Status Mapping to Settle Domain
PayPal Invoicing v2 statuses map cleanly to Settle's `InvoiceStatus`:
- `DRAFT` $\rightarrow$ `DRAFT`
- `SENT`, `SCHEDULED`, `UNPAID` $\rightarrow$ `SENT`
- `PARTIALLY_PAID` $\rightarrow$ `PARTIALLY_PAID`
- `PAID`, `MARKED_AS_PAID` $\rightarrow$ `PAID`
- `CANCELLED`, `VOIDED` $\rightarrow$ `CANCELLED`
- `REFUNDED`, `PARTIALLY_REFUNDED` $\rightarrow$ `REFUNDED`

### 5. Webhook Timing & Notifications
- Webhook notifications are delivered asynchronously by PayPal's background event workers (typically 15–90 seconds after transaction).
- For local development and automated spikes, querying `/v1/notifications/webhooks-events` or polling `/v2/invoicing/invoices/{id}` provides deterministic state verification.

### 6. Past Invoice & Due Dates
- **Empirical Test Result**:
  Tested creating and sending draft invoices where `invoice_date` and `due_date` are both in the past (e.g. `invoice_date: 2026-10-15` and `due_date: 2026-10-25`).
- **Observed Behavior**:
  PayPal Invoicing v2 accepted past dates without error (returned HTTP 201 Created on draft and HTTP 200 OK on send). The invoice immediately becomes `SENT` and overdue on PayPal.
  Therefore, Settle seed scenario invoices can be provisioned with their authentic past issue and due dates preserved, exactly matching our local database.

### 7. Invoice Number Uniqueness & Suffix Trade-Off (`PAYPAL_NUMBER_SUFFIX`)
- **Empirical Root Cause**:
  PayPal Invoicing v2 enforces strict global uniqueness on `detail.invoice_number` across the entire merchant account. When demo data is reset locally via `POST /api/demo/reset`, previous invoice numbers (`INV-1001` through `INV-1014`) remain registered permanently in the PayPal sandbox merchant account. Subsequent creation attempts fail with HTTP 422 `UNPROCESSABLE_ENTITY` and detail issue `DUPLICATE_INVOICE_NUMBER`.
- **Suffix Architecture**:
  To allow seamless and repeatable resets against the same sandbox account, Settle appends a 4-character base36 uppercase suffix to each invoice created in PayPal (e.g. `INV-1001-K7Q2`, or `INV-1042-1/3-K7Q2` for instalment children). Settle's internal database maintains the canonical clean invoice number (`INV-1001`), while `invoice_paypal_ids` tracks the mapping to `paypal_invoice_number`.
- **Collision Prevention & Retry**:
  1. Before sending to PayPal, candidate numbers are checked locally against `invoice_paypal_ids`.
  2. If PayPal still returns `DUPLICATE_INVOICE_NUMBER`, the client automatically generates a new suffix and retries up to 3 times.
- **`PAYPAL_NUMBER_SUFFIX` Configuration & Trade-Off**:
  - `PAYPAL_NUMBER_SUFFIX=true` (default): Appends the 4-char suffix. Recommended for iterative development, demo restarts, automated tests, and shared sandbox accounts to guarantee successful provisioning.
  - `PAYPAL_NUMBER_SUFFIX=false`: Disables the suffix, sending clean `INV-1001` numbers to PayPal. Use this only for a single clean final recording or customer-facing demo against a fresh, unused PayPal sandbox merchant account.


