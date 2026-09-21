# T18A — authoritative OTP resend expiry

Date: 2026-09-21. Status: **T18A_READY_FOR_REVIEW**.
No merge or deployment is authorized by this task.

## Identity and preserved checkpoints

- Repository ID: `1368281478`.
- GitHub ID resolution returns `omin-jp/Frigo-dev`; the supplied
  `omin-vn/Frigo-dev` name redirects to this same repository ID.
- Exact starting main: `51d0d3755d83b64185066228d98f44ab7bad5e3c`.
- Branch: `feat/t18a-auth-resend-expiry-contract`.
- Server checkpoint: `88096cb7fbea8e3b95f5627ff5a46e8c3d34b462`.
- Client/browser checkpoint: `47c3a3391e086caf2760b61ee4e2bfacd331cacf`.
- Final security-fixture checkpoint: `53f9fefdc9d935bb736a37cdcd9f5b0d0479685e`.
- Each checkpoint was pushed immediately. The certification commit containing
  this report cannot contain its own SHA; its exact SHA is recorded in the PR
  and final handoff reply.
- Start checks: fetched origin, verified exact main, no overlapping open auth
  PR, hosted main CI #137 (`35541952081`) successful. Deploy #50
  (`35542177288`) has successful release/staging jobs and a skipped production
  job. T17B history and PR #45 are not rewritten.
- Initial application worktree was clean except platform-generated
  `.hoplite/settings.json`. It was preserved in the named stash
  `Preserve pre-existing Hoplite settings before T18A`, then the new branch was
  created from exact main. That settings change is not part of this PR.

## Audit checkpoint and previous limitation

Before implementation, inspected the Worker auth routes, OTP creation/digests,
expiry verification, delivery, Turnstile, rate limiting, schemas, reset flow,
typed auth service, AuthPage, OtpMode, verify-context, VerifyRouteLifecycle,
auth store and relevant auth/unit/integration/security tests.

Registration already returned `expiresInMinutes: 10`, but storage and response
used separate literals. Registration/login resend omitted expiry, so T17B
correctly replaced presentation expiry with `null`. Forgot-password uses the
same stored OTP TTL but different business rules: generic known/unknown-account
responses, equivalent HMAC work for unknown accounts, no unknown-account OTP
storage/mail, and scheduled rather than awaited email delivery.

Decision: use the existing duration representation, with one server-owned
constant. No migration, architecture change or client TTL default is needed.

## Contract and behavior

Successful registration/login resend before:

```json
{ "success": true, "message": "..." }
```

Successful registration/login resend after:

```json
{ "success": true, "message": "...", "expiresInMinutes": 10 }
```

`OTP_TTL_MINUTES` in `src/worker/routes/auth.ts` is the common source for
`auth_otps.expires_at`, registration metadata, successful resend metadata and
generic reset-policy metadata. The existing ten-minute lifetime is unchanged.
The existing environment-gated `devOtp` extension is unchanged; production
success/error payloads do not gain any code or credential.

- **Registration:** unchanged successful contract, now derived from the same
  constant as persistence. Delivery-unavailable registration still returns 503
  with `accountCreated`; the client ignores expiry when delivery is false.
- **Registration resend:** the typed client requires numeric
  `expiresInMinutes`. AuthPage reuses its existing bounded parser through
  `enterVerification`, replacing old expiry with response-receipt time plus
  the server duration. This is approximate presentation time, not a claim of
  exact server-clock alignment; network/mail latency may shift its display.
  D1 verification of `expires_at` remains the final authority.
- **Cooldown:** the current 60-second client policy restarts on success and
  the existing 60-second email/purpose server cooldown remains enforced. A 429
  retains existing error behavior and does not replace a code. No new client
  authority is introduced.
- **Malformed success:** absent, nonnumeric, nonpositive or over-24-hour
  duration becomes `expiresAt: null`; the existing honest unknown-expiry UI
  handles the contract mismatch. No fabricated ten-minute fallback, no raw
  response logging or credential persistence. The 24-hour bound validates
  presentation metadata; it is not an OTP validity policy.
- **Delivery unavailable:** existing resend 503 and
  `OTP_DELIVERY_UNAVAILABLE` response are unchanged, with no fresh expiry.
  Production invalidates the failed replacement and clears its cooldown key.
  Client sets `delivered: false`, `expiresAt: null`, permits resend, and clears
  old code entry/dev-code state.
- **Offline/ambiguous network failure:** client sets `delivered: null` and
  `expiresAt: null`; it never claims success or old-code validity. Retry remains
  subject to the server cooldown if the interrupted request reached the server.
- **Development:** existing dev OTP can be usable without proving email
  delivery, so successful resend keeps `delivered: null` when `devOtp` exists.
  A response with no new dev OTP now clears any stale in-memory dev OTP.
- **Forgot password:** `/auth/resend-otp` accepts `forgot_password` and calls
  the same helper as `/auth/forgot-password`. Both return the same generic
  `expiresInMinutes` policy for known, unknown and failed issuance outcomes.
  It means "lifetime if issued", not proof of account existence, issuance or
  delivery. Conditional field presence would be an enumeration regression.
  The product's forgot-password UI currently calls `/auth/forgot-password`,
  then submits OTP plus new password to `/auth/reset-password`; it has no
  registration verify-context or expiry display. That architecture is unchanged.
  Preliminary forgot-password verification does not consume the OTP; final
  reset does. The separate reset-token lifetime is unchanged.
- **Local expiry:** canonical wording moves from unknown expiry to
  `Mã hết hạn lúc HH:mm`, then communicates locally elapsed metadata. The
  form still submits to the server after the local clock expires; server
  invalid/expired responses still win when the local timer is positive.

## Security and contract review

The final application diff adds metadata only, plus its client consumption.
Explicitly reviewed:

- No OTP/password/token values added to production payloads, logs or storage.
- No new account-existence oracle. Reset response shape is identical for
  known/unknown accounts, including pending delivery and failures.
- No increased OTP lifetime or client-provided TTL accepted by the Worker.
- No changes to auth rate limiter, resend cooldown, Turnstile, CSRF, attempt
  budget, lockout, HMAC digest binding, single-use consumption or email/purpose
  matching. Replacement still invalidates old challenges; failure invalidates
  the replacement in production.
- No account-verification/session authority or ownership changes. DEC-012
  still refuses guest inventory transfer before consuming the OTP; explicit
  retry without transfer preserves guest/account isolation.
- Context has exactly `email`, `resendAvailableAt`, `expiresAt`, nullable
  `delivered`, and `owner`. No OTP, code, password, token, resetToken or session
  credential. Refresh restores the newly resent expiry, never credentials.
- Existing route-generation/private-session guards still reject late resend
  results after leave-and-return, logout or identity replacement. Back/forward,
  session reset, logout and successful verification retain T17B cleanup.
- No new database or production configuration changes. Existing nonproduction
  `devOtp` behavior is retained, not widened or presented as email delivery.

Review identified a test-only random-code collision risk; deterministic
one-shot randomness now guarantees different old/new OTP fixtures while
exercising the real generator. No application security regression was found.

## Worker diff, line by line

Only `src/worker/routes/auth.ts` changes under `src/worker` (7 added/4 removed).

1. Add `const OTP_TTL_MINUTES = 10` and its separating blank line.
2. Replace the storage-expiry literal with `OTP_TTL_MINUTES * 60 * 1000`.
3. Add generic reset-response `expiresInMinutes: OTP_TTL_MINUTES`.
4. Remove the duplicated TTL wording from the registration issuance comment.
5. Replace registration response literal `10` with `OTP_TTL_MINUTES`.
6. Add `expiresInMinutes: OTP_TTL_MINUTES` to the successful resend return only.
   The failure return above it, invalidation, cooldown and all auth gates are
   untouched.

## Executed verification

Logs: `.hoplite/artifacts/t18a-validation/` (local, uncommitted).

- `pnpm exec vitest run tests/integration/auth-hardening.test.ts`: initial
  checkpoint **81/81**, final explicit anti-abuse fixtures **86/86**.
- `pnpm exec vitest run tests/unit/auth-verify-route.test.tsx tests/unit/auth-resend-turnstile.test.tsx tests/unit/auth-funnel-ui.test.tsx tests/unit/auth-google-credential.test.tsx tests/unit/auth-guest-transfer-deferred.test.tsx tests/unit/client-session.test.ts`:
  **83/83**, six files.
- `pnpm exec vitest run tests/unit/auth*.test.* tests/unit/client-session.test.ts tests/integration/auth*.test.ts tests/integration/browser-security.test.ts tests/integration/frontend-security-integration.test.ts tests/integration/t07-security.test.ts`:
  initial **295/295**; final **300/300**, twelve files including all five
  additional anti-abuse cases (`focused-auth-security-final.log`).
- `pnpm test --maxWorkers=2 --minWorkers=2`: **180/180 files, 4117/4117 tests**,
  PASS in 456.47 seconds. Full suite, no filters; all auth integration/security
  tests included. Existing negative-case diagnostics and React Router future
  warnings are expected test output, not failures.
- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm check:migrations`: PASS, `migration-smoke=ok`.
- `pnpm build`: PASS (local Web/Worker build, not deployment).
- `pnpm exec eslint tests/integration/auth-hardening.test.ts`: PASS after final
  fixture changes.
- `pnpm exec playwright test --config playwright.t17.config.ts --grep 'T18A|auth surface|auth: mode switch|OTP screen announces'`:
  **42/42**: 24 new T18A cases and 18 existing T17 auth/OTP checks across 360,
  390, 430, 768, 1024 and 1440 widths. The default Playwright config remains
  T13-only by convention; the separate T17 config discovers the new auth spec.
- Managed isolated preview: real registration, resend, 60-second cooldown,
  unknown-to-fresh expiry and refresh recovery verified with agent-browser.
  Settled screenshot inspected:
  `.hoplite/artifacts/t18a-validation/managed-resend-expiry.png`; only synthetic
  email/presentation metadata, no OTP or credential visible. Browser errors
  command produced no errors. This proves local behavior, not real email delivery.
- `git diff --check`: PASS.

## Publication and current release state

- New [PR #46](https://github.com/omin-jp/Frigo-dev/pull/46), OPEN against main.
  At implementation head `53f9fefdc9d935bb736a37cdcd9f5b0d0479685e` it was
  mergeable, with no review comments or unresolved threads; hosted CI run
  `35549781613` **succeeded** (validate, 4m40s). Final documentation push triggers a fresh check of the
  final head. Check the PR for its live result rather than treating an older
  head's CI as certification of the new SHA.
- CI/review auto-fix subscription is enabled and will resume the task when
  checks/reviews settle. No merge or deploy action is permitted.
- Main remains `51d0d3755d83b64185066228d98f44ab7bad5e3c`; main CI #137 and
  staging Deploy #50 successful. That Deploy run's production job was skipped.
  T18A itself is not merged and has not been deployed to staging or production.
- No remaining local implementation/test blockers. Human review and the live
  final-head hosted check remain the publication gates.

## Failures and environment recovery

- First browser run: all 42 tests failed at launch because Playwright Chromium
  revision 1243 was absent; no app assertions executed. Installed the locked
  browser via repository-runbook command `pnpm exec playwright install chromium`;
  exact rerun passed 42/42.
- First `pnpm test`: shell terminated at 600 seconds without a reported test
  failure. A longer rerun was intentionally stopped after final test-fixture
  improvements. Final run uses `pnpm test --maxWorkers=2 --minWorkers=2` with a
  3600-second shell budget; no test filtering or coverage weakening.
- Inferred sandbox configuration ran only Vite and omitted SQLite setup.
  Project-scoped overrides restore the repository's existing isolated preview
  and SQLite/frozen-install setup, plus locked Chromium installation. No
  production config or setup file is included in this PR. Preview runs on 5173
  with local in-memory Worker API on 8788 to avoid the browser-test ports.
- `sandbox_control setup` twice refused its lifecycle claim despite ready/no
  active setup. Reported platform fault; ran the same durable idempotent setup
  through shell successfully (`sqlite3` verified). No approval was bypassed.
- Two initial manual browser locator attempts did not exercise resend; a fresh
  accessibility snapshot/ref click then confirmed the actual flow. Only the
  successful current result and inspected settled screenshot count as evidence.

## Protected boundaries and next action

Against exact base `51d0d3755d83b64185066228d98f44ab7bad5e3c`:

```sh
git diff BASE HEAD -- src/worker/routes/billing.ts
git diff BASE HEAD -- src/web/components/payment
git diff BASE HEAD -- src/web/pages/PlusPaywallPage.tsx
git diff BASE HEAD -- migrations
```

Each is empty. Billing diff = **0**; payment UI diff = **0**; payment behavior
diff = **ZERO**. Only auth expiry implementation/tests and task documentation
are in scope. PayOS, grants, webhooks, Inventory Truth, OCR/AI, recipe/planner
authority and production configuration remain unchanged. The known separate
payment-authority mismatch remains T18B work.

Next action: review PR #46 and its final-head hosted checks; the enabled
auto-fix subscription handles subsequent CI/review feedback. Do not
merge, deploy, run remote migrations or change production.
