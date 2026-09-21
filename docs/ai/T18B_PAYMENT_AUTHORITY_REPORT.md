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

## Final authority graph and API contract

```text
Worker PLUS_PRICES -> authenticated /billing/plans -> plan-only selection
  -> POST /billing/payment-intents { plan }
  -> stored owner/order/price/currency/expiry -> signed PayOS create request
  -> verified PayOS response -> server instructions/QR -> presentation-only modal
  -> verified PayOS webhook -> atomic pending-to-paid + subscription grant
  -> authenticated owned status read -> fresh same-owner /me -> UI entitlement
```

All routes use the existing `/api/v1` prefix. Plans/status responses are
`Cache-Control: no-store`; billing requests now include the existing expected
user/household headers so a cross-tab cookie switch cannot attach another
account's newly created order. No payment operation is queued for offline replay.

| Endpoint | Request | Successful response |
| --- | --- | --- |
| `GET /billing/plans` | authenticated session | `{ plans: [{ plan, amountVnd, currency }] }` from the Worker table |
| `POST /billing/payment-intents` | `{ "plan": "monthly" \| "annual" }`; extra legacy monetary/identity fields ignored | 201 `{ success: true, payment: { id, orderCode, plan, amountVnd, currency, description, expiresAt, status, instructions } }` |
| `GET /billing/payment-intents/:id` | authenticated owner | `{ success: true, payment: { id, orderCode, plan, amountVnd, currency, description, expiresAt, status } }`; foreign ID 404 |

Instructions contain `bankBin`, `accountNumber`, `accountName`, `transferContent`
and `qrImageUrl`. The QR query amount and description are built server-side from
the verified provider result; the browser does not compute either. Integer VND
values stay integers. Status is `pending`, `paid`, `failed`, `expired`, or
`refunded`; unsupported cancellation/refund automation is not invented. Closing
or refreshing the modal is not cancellation and never confirms receipt.

Malformed/missing/unknown plans return 400. No provider configuration returns
503 before order creation; provider failure returns 502 and marks the inserted
intent failed. A timeout may still have created a remote PayOS link: such an
order must be reviewed/refunded by the operator, not automatically granted by a
late callback. There is no new manual-grant bypass. This task never calls that
live provider or performs that reconciliation.

The UI handles invalid contracts, stale metadata, delayed create/status results,
network errors, expired/failed orders, account/household/generation changes and
double clicks. A paid order may display receipt confirmation, but Plus success
requires a fresh `/me` with the same user and `isPlus: true`. Failed entitlement
reloads can be retried. A tampered local Plus cache does not initialize entitlement.

## Idempotency and final security review

- HMAC-SHA256 WebCrypto verification covers signed `data`; unsigned envelope
  success/code cannot change the result. Official PayOS signature fixtures are
  checked with independent test-side HMAC, not only the production signer.
- Order, amount, VND currency, stored plan/price, expiry, status and reference are
  checked. A paid duplicate with the same reference is acknowledged even after
  expiry without changing entitlement. Failed/expired/refunded orders cannot grant.
- Subscription UPSERT and intent consumption run in one D1 batch with the same
  captured expiry cutoff. Missing subscription rows are inserted. Same-order
  races grant once; separate paid orders extend existing active duration; a
  reused transaction reference rolls back both writes.
- The reusable legacy grant secret no longer writes subscriptions. The retired
  binding remains compatibility typing only, never authority. Its obsolete
  configuration warning is removed; setting it cannot enable a grant.
- A pre-existing payment-specific expected-owner-header exemption was removed;
  server cookie/CSRF/ownership enforcement itself is unchanged.
- Review also caught premature Plus-success copy during `/me` loading and a
  stale-plan loading lock; both were corrected with focused regressions.
- An initial concern about differing PayOS request/response descriptions was
  withdrawn after checking the official contract: a provider prefix is valid;
  the HMAC and explicit order binding, not string equality, are authoritative.
- Final independent review: **P0 0 / P1 0 / P2 0 / P3 0** remaining findings.
  No secret or production credential was exposed or committed.

## Checkpoints

All were pushed immediately to `feat/t18b-payment-authority`:

- A/server: `2aba91acceeefba74ea242c7a55cae3b7b6d1e40`.
- B/frontend: `c00ea9fa132455f96aea31608b689ac87709d511`.
- C/security + browser coverage: `1cef30b902435ee71b0fae60a92b36ed9c3ca268`.
- C follow-up, semantic error tokens: `1aabd32562edc2c5c37b3db9d7d19e1938896084`.
- D is the documentation commit containing this final report; its own hash is
  intentionally not self-embedded. The publication receipt supplies final HEAD.

## Verification

- Audit baseline: `pnpm exec vitest run tests/unit/account-gates.test.tsx tests/integration/auth-me-quota.test.ts` — 20 passed.
- `git diff --check` — PASS before implementation.
- `pnpm exec tsc -p tsconfig.worker.json --noEmit` — PASS.
- `pnpm exec vitest run tests/integration/payment-authority.test.ts tests/integration/auth-me-quota.test.ts` — 41 passed (24 payment, 17 existing entitlement).
- Initial `pnpm typecheck` failed because the new integration test directly
  imported the Worker into the DOM target. Reused the existing
  `tests/helpers/worker-fetch.mjs` bridge; no Worker/static-handler change.
- Final focused command:
  `pnpm exec vitest run --maxWorkers=2 --minWorkers=2 tests/integration/payment-authority.test.ts tests/unit/payment-checkout.test.tsx tests/unit/billing-service.test.ts tests/unit/account-gates.test.tsx tests/unit/client-session.test.ts tests/integration/auth-me-quota.test.ts`
  — **121 passed**: payment server 35, checkout 19, billing service 14,
  account gates 3, existing client sessions 33, existing entitlement 17.
- Checkpoint B rerun of checkout/billing/account-gates — **36 passed**.
- `pnpm test --maxWorkers=2 --minWorkers=2` — **183 files / 4185 tests PASS**
  on `1aabd32562edc2c5c37b3db9d7d19e1938896084`, no exclusions or skips.
  Final log: `.hoplite/artifacts/t18b-full-vitest-final.log`.
- `pnpm lint`, `pnpm typecheck`, `pnpm check:migrations`, `pnpm build` — PASS.
- `pnpm exec vitest run tests/unit/takosan-brand.test.tsx tests/unit/payment-checkout.test.tsx`
  — **38 passed**; `node scripts/t17/style-residuals.mjs` — **39 allowlisted,
  0 unjustified**, with the existing modal palette allowlist unchanged.
- `PORT=3100 PREVIEW_API_PORT=8790 pnpm exec playwright test tests/e2e/t17-ui/payment-authority.e2e.ts --config=playwright.t17.config.ts`
  — **48 passed**, all six configured viewports.
- `PORT=3100 PREVIEW_API_PORT=8790 pnpm exec playwright test tests/e2e/t17-ui/payment-authority.e2e.ts --config=playwright.t17.config.ts --project=mobile-390 --project=desktop-1440 --grep 'checkout does not fabricate' --output=.hoplite/artifacts/t18b-browser-error-results`
  — **4 passed** after the final error-style fix.
- Initial browser command:
  `pnpm exec playwright test tests/e2e/t17-ui/payment-authority.e2e.ts --config=playwright.t17.config.ts --project=mobile-390 --project=desktop-1440`
  — **16 passed**. QR-reference parity was then strengthened and its scoped
  test reran **2 passed**. Images are synthetic, never payable provider QR codes.
- Managed Preview was exercised with `agent-browser`: actual Worker metadata
  displays 49000/499000 VND; missing provider configuration displays an error,
  no payment dialog/QR, and no uncaught browser error.
- No real payment, remote migration, merge or deployment performed.
- Fresh mobile/desktop modal screenshots were pixel-inspected and retained at
  `.hoplite/artifacts/t18b-payment-{mobile,desktop}.png`. The mobile synthetic
  evidence is shared in PR #47; neither screenshot contains real payment details.

### Failures and recovery

- First full Vitest: **4184 passed / 1 failed**. The existing brand gate caught
  three raw palette tokens in the new checkout error alert. Changed the alert
  to existing semantic tokens, kept the test/allowlist unchanged, and reran the
  entire suite: **4185 passed**.
- The unbounded-parallel six-file focused run had one 5-second cold-load timeout
  in existing `client-session.test.ts`, followed by a pending-logout-state failure.
  The identical six files passed 121/121 with two workers; no test was removed,
  skipped, weakened, or given a longer timeout. Full Vitest uses two workers too.
- A concurrent typecheck briefly read partially edited billing-service tests;
  the final complete-file typecheck passes. Initial Worker/DOM import failure and
  its existing-helper repair are recorded above.
- An independent review build encountered a generated service-worker-token error;
  a clean rebuild passed. The primary sequential `pnpm build` also passed without
  source/build-configuration changes. No cause beyond the generated-output state
  is asserted.
- Managed Preview initially hard-coded PORT=5173 despite the platform's 3000
  listener, allowing its readiness probe to hit a temporary Playwright server.
  The project-only run override now respects injected PORT and retains isolated
  API 8788: `PREVIEW_API_PORT=8788 node scripts/security-preview.mjs`.
  Restarted Preview is ready on 3000 and the real unavailable-checkout flow was
  rerun successfully. Browser tests use 3100/8790 to avoid interference.

## Merge-readiness follow-up (2026-09-21)

- Fetched main/head and verified CI run `35554499704` SUCCESS for
  `2d6ff5a4a2bc1ad43a52d929adb5af88285adc4a`, clean merge state, and no review
  threads. This receipt does not substitute for the follow-up head's CI.
- Found that the deployed image policy blocked VietQR despite Preview passing.
  Added only `https://img.vietqr.io` to `img-src` in the Worker and static CSPs;
  scripts, connections and other policy directives are unchanged. Unit coverage
  requires exact image sources and identical Worker/static policies. Browser
  fixtures now enforce the production image directive and require decoded QR
  pixels (`naturalWidth > 0`), not just a visible image element.
- Removed the obsolete `PLUS_GRANT_SECRET` warning, its misleading deployment
  guidance and health-test comment. Config coverage proves presence/absence of
  the retired binding cannot alter readiness warnings; email/auth guards remain.
- Red/green evidence: new CSP unit assertion failed against the old policy;
  browser QR decode also failed with width 0. Both pass after the policy fix.
  The first managed-Preview adapter run hit the existing external-WebSocket
  guard because its origin was `127.0.0.1`, not Preview's `localhost`; matching
  the adapter origin fixed the harness without relaxing network isolation.
- `pnpm exec vitest run tests/unit/csp.test.ts tests/unit/config-validation.test.ts tests/unit/health.test.ts tests/integration/payment-authority.test.ts --maxWorkers=2 --minWorkers=2`
  — **104 passed** (4 files).
- `pnpm exec playwright test --config .hoplite/payment-readiness.playwright.config.ts payment-authority.e2e.ts`
  — **48 passed** with the new CSP/decode assertions, all six viewports, against
  managed Preview on 3000. The local-only adapter disables Playwright's second
  server and uses `http://localhost:3000`; it was archived after the run as
  `.hoplite/artifacts/payment-readiness/playwright.config.ts`, not committed.
  Red/green logs and synthetic screenshots are in that artifact directory.
- `pnpm lint`, `pnpm typecheck`, `pnpm check:migrations`, `pnpm build`,
  `cmp public/_headers dist/client/_headers`, `git diff --check origin/main`
  — **PASS** after the follow-up. Full-diff whitespace initially caught a trailing
  blank line in the payment integration test; removed it without test changes.
- Independent review found no remaining runtime/payment blocker. The complete
  local 4185-test result above is the implementation checkpoint; the new head's
  full-suite result is supplied by its hosted CI receipt, not inferred here.

## Protected boundaries and release state

- `git diff BASE -- src/worker/routes/auth.ts` is intentionally nonzero ONLY for
  retiring `/auth/plus/activate`. A byte comparison of everything before that
  endpoint passes; all T18A/OTP/login/logout behavior is unchanged.
- Inventory Truth, OCR/AI, recipe authority, planner algorithms, Week behavior,
  packages, migrations, Wrangler configs and workflows have **zero diff**.
  Application-config changes are limited to the QR image allowlist and retired
  payment-secret warning described above; no bindings or infrastructure changed.
- Migration ledger: **38**, new/changed migrations **0**; no remote D1 action.
- Final baseline check: main remains `13ff3f22082fc0601a81b90c96edded4741194ac`;
  main CI #140 / `35550927573` SUCCESS; Deploy #51 / `35551180810` staging
  SUCCESS, production job SKIPPED. T18B is not merged or deployed anywhere.
- The payment/release owner must provision or verify Worker secrets
  `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, the existing `APP_URL`,
  and PayOS delivery to `/api/v1/billing/payos/webhook`; retire legacy
  `/auth/plus/activate` shared-secret callers. These are payment-activation/release
  prerequisites, not a schema change or code-merge blocker. None was performed;
  mocked protocol verification is not live-provider certification. Deployment
  still requires separate authorization.

## Publication and next action

- [PR #47](https://github.com/omin-jp/Frigo-dev/pull/47) is OPEN against main,
  review-only; CI/review auto-fix subscription **enabled**, auto-merge **disabled**.
- Hosted CI run `35554499704` passed for `2d6ff5a`; the follow-up receives its own
  CI run. Exact remote HEAD/checks/review threads are reverified on the PR before
  declaring merge readiness, never inferred from this older successful receipt.
- No local implementation/verification blocker remains. Next is owner review
  and merge permission once final-head hosted CI is green, never agent merge or
  deployment from this task. The auto-fix
  subscription resumes the task when provider CI/review feedback settles.
- Frontend monetary authority removed: **YES**. VietQR server-authoritative:
  **YES**. Client amount tampering: **BLOCKED**. Entitlement server-authoritative:
  **YES**. Webhook/provider verification: **PASS in deterministic protocol tests**,
  live provider untested. Idempotency: **PASS**. Business-price decision: **not required**.

Current status: `T18B_READY_FOR_REVIEW`.
