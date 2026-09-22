# Google Safari and Turnstile recovery — 2026-09-22

## Symptom

Google Sign-In loaded in Safari private browsing but the normal profile showed
`Không tải được Google Sign-In`. Cloudflare Turnstile also appeared on login,
password recovery and OTP resend instead of only during registration.

## Reproduction and root cause

Production SHA `8dc9198918837cb15f4a7ddf4f9029875b015091` loaded Google GIS and
opened the real `accounts.google.com` popup in clean Chromium/WebKit. Aborting
`https://accounts.google.com/gsi/client` reproduced the user-visible warning.
With the production service worker controlling the page, the same profile then
remained broken after reopening without the simulated blocker:

```text
FetchEvent.respondWith received an error: Returned response is null.
```

The service worker handled all GET requests, including third-party scripts, and
its default network fallback could resolve an empty cache match. Unregistering
the worker and clearing its release cache recovered GIS immediately. This
explains the clean private profile: it had isolated website/service-worker data.
No `/auth/google` backend request occurs in the failing path.

## Changes

- `public/sw.js` returns before `respondWith` whenever the request origin is not
  the application origin. Google GIS, Turnstile and other third-party resources
  are fetched directly by the browser.
- A same-origin default cache miss now rejects explicitly instead of returning
  an invalid null response.
- Turnstile remains rendered and verified on account registration only.
- Login, forgot-password and OTP resend no longer require another challenge.
- Existing auth rate limiting, CSRF, OTP resend cooldown, digest storage,
  single-use verification, expiry and production fail-closed registration stay
  intact.
- Register/login resend checks account state and sends no OTP email for an
  unknown or already verified address.

## Verification

- Focused auth/PWA/browser-security: 4 files, 124 tests PASS.
- Full Vitest: 185 files, 4242 tests PASS.
- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm check:migrations`: PASS.
- `pnpm build`: PASS.
- `git diff --check`: PASS.
- Candidate WebKit smoke on the production origin with local built assets:
  active service worker YES; first GIS load blocked YES; retry recovered GIS
  YES; Google iframe visible at 362x44; warning after recovery NO; login
  Turnstile frames 0; registration Turnstile frames 1.
- `pnpm audit --prod`: two pre-existing moderate React Router 6 advisories;
  patched upstream only in React Router 7.18+. No dependency changed here.

## Release impact

No migration, secret, DNS, environment variable, workflow, payment, D1, KV, R2,
or queue change is required. A new build SHA rotates the release-keyed PWA cache;
the activating worker claims and refreshes existing clients, replacing the
cross-origin-intercepting worker. Rollback is a normal code rollback.
