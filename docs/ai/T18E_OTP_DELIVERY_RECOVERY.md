# T18E OTP delivery recovery

Date: 2026-09-22

Status: `T18E_OTP_TEST_RECIPIENT_REQUIRED`

## Scope and boundaries

- Repository ID: `1368281478`
- Repository: `vn-tako1/Frigo-dev`
- Starting main and production SHA: `66627ffea890dad1cec4e31674449775a940c660`
- Branch: `feat/t18e-otp-email-delivery-recovery`
- Review-only PR: `https://github.com/vn-tako1/Frigo-dev/pull/50`
- Production URL: `https://frigo.tungjpstore.net`
- No Google Sign-In, Google OAuth, GIS, CSP, client ID, or iOS behavior changed.
- No migration, workflow change, production mutation, merge, or production deploy.

## Original symptom

Production registration created an unverified account and persisted an OTP
digest, but the user did not receive the email needed to verify the account.
The production path correctly failed closed when delivery was rejected:
the issued challenge was invalidated and the API returned
`OTP_DELIVERY_UNAVAILABLE` without `devOtp`.

## Diagnosis and evidence

Confirmed facts:

- Production readiness and `wrangler.jsonc` show the unrestricted `SEND_EMAIL`
  binding is present.
- The operator subsequently supplied a Resend API key through the local
  clipboard. It was provisioned directly as the production Worker secret
  `RESEND_API_KEY`; its value was never printed, logged, or written to disk.
- The active Cloudflare account owns an active `tungjpstore.net` zone.
- The fixed sender in code is `no-reply@tungjpstore.net`.
- Current readiness reports email as configured solely from binding/secret
  presence. It does not prove sender onboarding or real delivery.
- Stored Workers Observability and Email Sending subdomain APIs returned
  authorization errors with the available OAuth scopes. The Cloudflare
  dashboard session was not authenticated. No sanitized production
  `email_delivery_failed` or `otp_delivery_failed` event was available.

The exact current primary-provider failure category is therefore **not
observed** and is not fabricated. Sender authorization for
`no-reply@tungjpstore.net` in the production Cloudflare account remains
`UNKNOWN` in this task.

The supplied Resend key authenticates successfully. The operator completed the
DNS correction and Resend now reports `tungjpstore.net` plus its DKIM and both
SPF-purpose records as `verified`. No email was sent during configuration, so
inbox delivery and OTP verification still require an explicitly authorized
test recipient.

Historical T16 evidence proved that the old subdomain sender
`no-reply@frigo.tungjpstore.net` was unauthorized and that the current apex
sender was accepted at that time. That historical acceptance is useful context,
but it is not treated as proof of current sender authorization or inbox delivery.

## Provider state

### Cloudflare Workers Email

- Binding present: YES
- Binding restriction in repository: unrestricted
- Sender: `no-reply@tungjpstore.net`
- Sender/domain authorization now: UNKNOWN (operator/API scope required)
- Current production failure category: UNKNOWN (no sanitized event captured)
- Controlled test send in this task: NOT RUN

### Resend

- `RESEND_API_KEY` Worker secret present: YES
- API authentication: PASS
- Sending-domain state: VERIFIED
- Fallback router implemented: YES
- Deterministic fallback tests: PASS
- Real provider test: NOT RUN
- Provider setup: `tungjpstore.net` and all reported sending records VERIFIED

No secret value was printed, stored, logged, or committed.

## Code changes

- Preserved provider order: Workers Email, then Resend when configured, then
  fail closed.
- Expanded Cloudflare classification for suppressed recipients while retaining
  the existing sender, recipient, rate, daily-limit, and unavailable categories.
- Classified Resend quota, rate-limit, sender-domain, recipient-policy, HTTP,
  network, and timeout failures without logging provider response bodies.
- Added sanitized structured provider diagnostics containing only event,
  provider, category, OTP purpose, and environment.
- Added a defensive catch around the auth delivery router so an unexpected
  `sendEmail()` rejection still invalidates the production OTP.
- Changed readiness email state to separate `providerConfigured` from
  `deliveryVerified`; readiness never sends email and always reports delivery
  verification as false.
- Removed the stale MailChannels fallback description. MailChannels was not
  restored.
- Documented the optional Resend secret name in `.dev.vars.example` without a
  value and added production operator guidance to `DEPLOYMENT.md`.

## OTP lifecycle certification

- Registration success persists only a digest, returns truthful ten-minute
  expiry, and verifies the delivered challenge: PASS.
- Registration delivery failure creates the unverified account, invalidates
  the failed challenge, returns `OTP_DELIVERY_UNAVAILABLE`, and does not leak
  `devOtp`: PASS.
- Workers Email failure followed by Resend success keeps the challenge usable:
  PASS (deterministic provider plus auth integration coverage).
- Initial registration failure followed by secured resend issues a different
  challenge; the failed code remains unusable and the replacement verifies:
  PASS.
- Resend cooldown, fresh Turnstile, and server-authoritative expiry: PASS.
- Forgot-password known-account delivery and unknown-account anti-enumeration:
  PASS.
- Unexpected forgot-password delivery exception keeps the public response
  identical and invalidates the production challenge: PASS.
- Correct OTP single-use, replay rejection, expiry, failure limits, lockout,
  tenant/session isolation, and contextual digest binding: PASS.

## Security review

- Plaintext production OTP persistence: NO
- Production `devOtp` exposure: NO
- Recipient address in delivery logs: NO
- Subject/body/provider exception in delivery logs: NO
- Provider credential in source/logs: NO
- Account enumeration regression: NO
- Turnstile regression: NO
- Resend cooldown/rate-limit regression: NO
- Stale or simultaneously valid registration OTP regression: NO
- Failed-delivery invalidation regression: NO
- Cross-user/context OTP verification regression: NO
- Open T18E findings: P0 = 0, P1 = 0, P2 = 0

## Validation

- Focused auth/email/readiness: 6 files / 165 tests PASS
- Full Vitest: 185 files / 4238 tests PASS (baseline was 185 / 4226)
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm check:migrations`: PASS (`migration-smoke=ok`)
- `pnpm build`: PASS
- `git diff --check`: PASS before documentation checkpoint
- Hosted PR CI run `35685553412` on publication head `eec404a`:
  `validate` PASS; PR reported `MERGEABLE` / `CLEAN`. The final documentation
  receipt triggers a fresh exact-head CI check before handoff.
- Hosted PR CI run `35686094736` on head `2d75579`: `validate` PASS and the PR
  remained `MERGEABLE` / `CLEAN` before the operator-authorized secret receipt.
- `pnpm audit --audit-level high`: reports the unchanged lockfile baseline of
  21 advisories (6 high) in Wrangler/Miniflare Undici, jsdom ws, and build-time
  sharp paths. No dependency changed in T18E; remediation requires a separate
  reviewed dependency upgrade.

## Real delivery status

- Authorized test recipient supplied: NO
- Provider accepted controlled OTP send: NOT RUN
- Inbox receipt: NOT RUN
- Verification with delivered OTP: NOT RUN
- Replay rejection with delivered OTP: NOT RUN
- `REAL_OTP_DELIVERY`: NOT RUN

A random address was not selected and no production request was generated.

## Remaining operator action

1. Confirm in the production Cloudflare account that `tungjpstore.net` and the
   fixed sender `no-reply@tungjpstore.net` are authorized for Email Service.
2. Supply an explicitly authorized test inbox outside source control.
3. After review and merge, require exact-main CI and automatic staging, then run
   the controlled staging OTP smoke if provider configuration is available.
4. Separately authorize any production deploy. After deployment, run one
   controlled registration or reset delivery, verify the received OTP, and
   confirm replay rejection without recording the code.

The task must not be called complete until those real delivery steps pass.
