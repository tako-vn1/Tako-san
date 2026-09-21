# T18B — payment authority unification

## Start gate and scope

- Repository ID `1368281478` resolved through GitHub to `omin-jp/Frigo-dev`.
- Fetched main and starting HEAD: `13ff3f22082fc0601a81b90c96edded4741194ac`.
- Clean tree; new branch `feat/t18b-payment-authority` from that exact SHA.
- Main CI run `35550927573` SUCCESS; Deploy run `35551180810` SUCCESS.
- Open PRs #4, #7, #8 inspected; none modifies payment authority.
- The supplied T18B packet explicitly authorizes payment changes, superseding
  earlier tasks' protected-payment boundary only for this task. No auth OTP,
  inventory, planner, OCR/AI, infrastructure, migration or deployment change is planned.

## Pre-implementation audit

Search covered payment/PayOS/billing/checkout/subscription/entitlement/Plus/
activate/grant/status/amount/monthly/annual and all four conflicting prices in
`src`, `packages`, `tests`, `migrations` and `docs/ai`. The active payment writers
are `routes/billing.ts` and the payment-only block of `routes/auth.ts`.
Subscription readers use `scan-quota-policy.ts`; seed/free-subscription creation
is not a paid grant. No newer owner-approved commercial price authority was found.

| Source / field | Old authority | Desired authority |
| --- | --- | --- |
| `PlusPaywallPage` / plan | Browser selection; server silently defaults unknown plan | Browser selects identity; server strictly validates |
| `PlusPaywallPage` / display price | Annual 599000 / monthly 79000; invented saving/equivalent-month copy | Read-only server plan metadata |
| `billing.ts` / payable amount | Server annual 499000 / monthly 49000, but unused by checkout | One server price table feeding metadata and intents |
| `billing.ts` / currency | VND, callback does not check it | Server VND checked against signed provider data |
| `VietQRModal` / order/reference | Browser builds user-ID description, unrelated to stored order | Server-generated order and verified provider description |
| `VietQRModal` / bank and QR | Browser constants, amount prop, locally constructed URL | Validated provider bank instructions and server-built QR URL |
| `VietQRModal` / expiration | Browser 15 minutes vs server 30 minutes | Intent `expiresAt` only |
| `billing.ts` / payment status | Callback, but unsigned outer `code` wins | Signed `data.code`, bound to stored order/amount/currency |
| `VietQRModal` / success | Legacy activation response and unfenced delayed callback | Owned intent status from authenticated server; no redirect authority |
| `subscriptions` / entitlement | Webhook unconditional UPDATE and reusable shared-secret activation | Atomic, once-per-intent grant; `/me` remains read authority |

Browser monetary influence: the paywall price table controls the modal amount,
copy amount and QR query; the annual discount/equivalent-month claims are also
local. `api.createPaymentIntent` has no caller. Its route ignores submitted
amount but silently maps invalid plans to monthly. Legacy activation accepts
`cycle` plus reusable `grantCode`, not an order. No other active checkout caller
or payment provider creation/status integration exists.

### Security findings before implementation

- P1: QR checkout bypasses server intent identity and price.
- P1: signed callback can be wrapped in a tampered unsigned success code.
- P1: replayed paid callback rewrites subscription expiry even when no payment
  transition occurs; missing subscription rows are never inserted.
- P1: shared-secret legacy grants have no payment binding or replay protection.
- P2: invalid plan fallback, unchecked currency, non-cryptographic order suffix,
  stale modal/account state, hard-coded bank destination and unrelated QR expiry.
- Existing cookie/CSRF/expected-owner checks and private-session HTTP generation
  fences are preserved, not replaced. Payment-specific tests were absent.

## Implementation decision (before code)

- Retain **monthly 49000, annual 499000, VND**. This corrects presentation, not
  commercial pricing; no business-price decision is required.
- Add read-only plan metadata, strict plan-only intent creation and owned status
  reads. Prices live only in Worker code, never a shared/client price table.
- Create a PayOS payment link server-side with server credentials, verifying its
  signed response and amount/order/currency before returning bank/QR instructions.
  No configured provider means honest unavailable checkout, never a demo bank QR.
  Tests replace provider fetch; no live provider request is authorized.
- Keep existing payment schema. Distinct orders remain distinct purchases;
  single-flight UI prevents accidental double-click creation. Each verified paid
  order grants once, including concurrent/replayed callbacks. Closing the modal
  is not provider cancellation; no cancellation capability is invented.
- Use a transactional conditional subscription UPSERT followed by the terminal
  intent update. Renewals extend from the later of now/current active expiry.
- Retire the unbound shared-secret writer; retain the old activation endpoint as
  a non-granting compatibility response. This is the only intended `auth.ts`
  change and does not touch any T18A/OTP code.
- Fence payment requests, status, entitlement reload and UI by private-session
  generation and intent identity. Reload real `/me`, never `setPlus(true)` from
  browser interaction, URL, modal close, or redirect.

Provider protocol references (read 2026-09-21):
- https://payos.vn/docs/api/ — v2 payment-requests request/response contract.
- https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature.md — signed-data canonicalization/HMAC.
- https://payos.vn/docs/du-lieu-tra-ve/webhook/ — signed amount/currency/order/reference/code.

## Checkpoint A — server implementation

Implemented `src/worker/payment/{authority,payos}.ts`, shared type-only contract,
plan metadata/create/status routes, atomic webhook transitions and retirement of
the orderless legacy writer. No schema change. PayOS link creation requires
server-only `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` and existing
`APP_URL`; no deployment binding/configuration was changed. A missing or failing
provider produces 503/502 without bank instructions or entitlement.

The old activation route still returns a non-granting pending compatibility
response; submitting `grantCode` returns 410. No T18A handler changed.

## Verification so far

- Audit baseline: `pnpm exec vitest run tests/unit/account-gates.test.tsx tests/integration/auth-me-quota.test.ts` — 20 passed.
- `git diff --check` — PASS before implementation.
- `pnpm exec tsc -p tsconfig.worker.json --noEmit` — PASS.
- `pnpm exec vitest run tests/integration/payment-authority.test.ts tests/integration/auth-me-quota.test.ts` — 41 passed (24 payment, 17 existing entitlement).
- Initial `pnpm typecheck` failed because the new integration test directly
  imported the Worker into the DOM target. Reused the existing
  `tests/helpers/worker-fetch.mjs` bridge; no Worker/static-handler change.
- Frontend implementation, final security review, browser evidence and full gates pending.
- No real payment, remote migration, merge or deployment performed.

Current status: `T18B_PARTIAL`.
