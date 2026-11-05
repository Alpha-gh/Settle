# Team Handoff Notes

## Core Financial State & Cash Balance (`Business.startingBalance`)

### Important Note for Engine and Web Teams
The API maintains `Business.startingBalance` dynamically as **current cash on hand as of `asOf`** (today's cash).

1. **Automatic Balance Updates on Receipts & Refunds**:
   - Whenever an invoice payment is reconciled (via the PayPal webhook handler or `POST /api/demo/simulate-payment`), the API computes the change in payment (`delta = liveAmountPaid - storedAmountPaid`).
   - In the exact same database transaction as the invoice update, this `delta` is added to (or in the case of refunds, subtracted from) `businesses.starting_balance`.
   - Replaying duplicate webhooks or repeated reconciliations produces `delta === 0` and never double-counts.

2. **Guidelines for Teammates**:
   - **Engine Team (`packages/engine`)**: Treat `input.business.startingBalance` directly as the business's current liquid cash position on day 0 (`business.asOf`). Inflows from already-settled payments are already factored into `startingBalance`; do not add already-paid amounts from past invoices into future receipt projections.
   - **Web Team (`apps/web`)**: Display `business.startingBalance` (and `kpis.cash`) directly as current cash on hand. When listening to Server-Sent Events (`forecast.updated` or `invoice.updated`), the updated dashboard payload will reflect the new cash balance and updated shortfall automatically.
   - **Demo Resets**: Calling `POST /api/demo/reset` truncates and restores `businesses.startingBalance` to the baseline Contract v1 seed scenario amount ($9,800.00 / 980,000 cents).
