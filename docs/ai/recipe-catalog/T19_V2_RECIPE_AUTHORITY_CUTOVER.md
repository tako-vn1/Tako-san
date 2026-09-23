# Current takeover receipt - 2026-09-23

**Status: `T19_V2_APPLICATION_PR_PENDING`. Production: `UNTOUCHED`.**
Repository ID `1368281478` now resolves to `vn-tako4/Frigo-dev`; starting main
is `a3b1564329932515a047f674e9ab3e5b534716ca`. The exact integration checkpoint
`62d68196f273e81c8756e29f6a3165769d61837c` is published on
`feat/t19-recipe-authority-cutover-v2-integration` and verified by local HEAD,
origin tracking ref and remote ref. Original recovery branch remains immutable
at `0a04209e512d19293ed56a19d3fd51eb29ffefcd`. PR #52 is already merged.

The fresh audit, verification counts, probe limitations and next action are in
`docs/ai/recipe-catalog/T19_V2_TAKEOVER_AUDIT.md`. Hosted CI, merge, exact-main
certification and production work remain pending. T20 is blocked until
`T19_COMPLETE`. Earlier publication-blocked statements below are historical,
not current truth.

---

# T19 V2 — One Recipe Authority and the 500-recipe D1 cutover

Status: **T19_V2_APPLICATION_INTEGRATED_CI_PENDING**. Repository ID
`1368281478` resolves to `vn-tako3/Frigo-dev`; integration base is current main
`a3b1564`. The immutable original branch
`feat/t19-recipe-authority-cutover-v2` is published at `0a04209`; its actual
application checkpoint `558be74` was integrated without replaying the later
safe-stop documentation onto
`feat/t19-recipe-authority-cutover-v2-integration`.

Fresh local focused and canonical verification is complete and recorded in
[T19_V2_WIP_HANDOFF.md](T19_V2_WIP_HANDOFF.md). Hosted CI for the integration
branch has not run yet. Production is untouched and T20 remains blocked until
`T19_COMPLETE`. PR #52 and the original publication-blocked record remain
historical evidence.

## 1. Root cause (verified before any change)

Every recipe-facing HTTP route resolved recipe content through
`resolveRecipeAuthority(env, { tenantKey })` (ADR-026): `/recipes`,
`/recipes/:id`, `/recommendations`, cooking start/complete, legacy Week and
shopping attribution. The newer Meal Planner did not. `loadMealPlanningSnapshot`
in `packages/db/src/meal-planning-snapshot.ts` read the **raw D1 catalog**
(`prepareRecipeCatalogRead`) unconditionally, and
`src/worker/services/meal-planning.ts` used that snapshot for `generate`,
`alternatives`, `regenerate`, `swap`, `freshness` and (through the stored plan)
`shopping`.

With the 500-recipe ledger applied (`0036`, `0037`) and production configured
`static`/`shadow`, the Recipe API served 71 recipes while the planner planned
from 500. `tests/integration/t19-recipe-authority-split.test.ts` reproduced this
on unmodified main: the planner selected `imp-26a36c69306143bc` under `static`,
`shadow` and `canary-outside` while `GET /recipes/imp-26a36c69306143bc` and
`POST /recipes/imp-26a36c69306143bc/cook/start` returned 404. A second defect:
the planner catalog fingerprint hashed the whole D1 catalog, so an invisible
D1-only recipe change made static plans `stale_catalog`.

## 2. New authority architecture (T19A)

```
resolveRecipeAuthority(env, { tenantKey: householdId })   ← ONE decision per operation
        │  RecipeAuthoritySnapshot { source: static|d1, fingerprint, list() }
        ├── Recipe API / Week / Shopping attribution / Cooking   (unchanged consumers)
        └── Meal Planner
              loadMealPlanningSnapshot(db, scope, now, authoritySnapshot)
                    └── projectPlannerCatalogOnAuthority(...)     packages/db/src/planner-catalog-authority.ts
                          recipe content + steps ALWAYS come from the authority snapshot itself
                          source = d1     → + D1 planner enrichment (families, classifications,
                                            provenance, nutrition rows) fenced to the visible IDs;
                                            enrichment failure keeps the authority universe
                          source = static → no D1 planner reads at all (static/shadow/canary-outside)
```

- `MealPlanningServiceOptions.recipeAuthority(scope)` is **required**; route
  composition (`createMealPlanningRoutes`) installs
  `resolveRecipeAuthority(c.env, { tenantKey: scope.householdId })`. Request
  input never reaches it (strict intent/swap schemas reject unknown fields).
- Planner universe = `snapshot.visibleRecipeIds`. `alternatives` list only
  fenced recipes; `swap` of an invisible recipe is `REPLACEMENT_NOT_FOUND` (422),
  never a substitution; `regenerate` drops locks on invisible recipes rather
  than re-pointing them.
- Fingerprints: the `catalog` part hashes only authority-visible catalog,
  nutrition rows and steps. A D1-only edit does not stale a static plan; a
  D1-visible edit does stale a D1 plan.
- Planner recipe definitions and steps are taken from the resolved authority
  snapshot in every mode, so a later raw D1 read can never race the Recipe
  API's content view. Under `static`/`shadow`/`canary-outside` the planner
  batch reads no D1 catalog, nutrition or step rows; under `d1` the D1 rows only
  add planner enrichment (families of visible recipes, classifications,
  provenance, nutrition, diagnostics) fenced to the visible universe, and an
  enrichment read failure degrades to the authority-only D1 projection instead
  of failing or widening the universe. Hidden D1-only recipes, ingredients,
  families and diagnostics therefore cannot perturb static planning identity.

### Mode contracts (all proven by tests)

| Mode                                                                               | Recipe API                           | Planner / alternatives / swap | Shopping origin | Cooking                |
| ---------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- | --------------- | ---------------------- |
| `static`                                                                           | static 71                            | static 71; D1-only swap → 422 | static plan     | static (D1-only → 404) |
| `shadow`                                                                           | static 71 (D1 compared off-response) | static 71                     | static plan     | static                 |
| `canary` outside cohort                                                            | static                               | static                        | static          | static                 |
| `canary` inside cohort (same FNV-1a household bucket + operator cohort as ADR-026) | verified D1 500                      | D1 500                        | D1 plan         | D1                     |
| `d1`                                                                               | verified D1 500                      | D1 500                        | D1 plan         | D1                     |
| `canary`/`d1` with D1 readiness failure                                            | static fallback                      | **same** static fallback      | static          | static                 |

### Stored plan authority identity (section 11)

`generated_meal_plans.source_json.data` now carries
`authority: { source, fingerprint (SHA-256 of the authority snapshot), recipeCount }`
next to the four planner fingerprint parts (still `version: 1`; migration 0022
CHECKs unchanged; pre-T19 rows without `authority` still decode). If the
household's effective authority source differs from the stored one:

- `GET` freshness → `requires_revalidation`, reason `catalog_authority_changed`;
- `swap` and `shopping` → `CATALOG_AUTHORITY_CHANGED` (409), plan untouched;
- `regenerate` is the recovery path and re-stamps the new authority.

Frontend labels for the new reason/error code were added in
`src/web/features/planner/presentation.ts` (vi/en).

### Shopping boundary fix required by real recipes

Planning two meals of a 3-serving legacy recipe at 2 servings aggregates to a
non-terminating rational (`2/3 + 2/3`). The T05 boundary previously threw
`QuantityRangeError` → HTTP 500. `aggregateShoppingDemand` now reports such a
requirement as `unresolved` (`UNRESOLVED_PURCHASE_QUANTITY`, no purchase line,
unknown budget) — still never rounding. Inventory, lots, FEFO, idempotency and
cooking deductions are unchanged.

## 3. Release state machine (T19B)

`scripts/release-check.mjs` (`validateRecipeCatalogRollout`) and
`.github/workflows/deploy.yml` now accept exactly:

| State  | `recipe_catalog_mode` | `recipe_catalog_d1_canary_percent` | derived `RECIPE_CATALOG_CUTOVER_ENABLED` |
| ------ | --------------------- | ---------------------------------- | ---------------------------------------- |
| STATIC | `static`              | `0`                                | `false`                                  |
| SHADOW | `shadow`              | `0`                                | `false`                                  |
| CANARY | `canary`              | `1` / `2` / `5` / `25`             | `true`                                   |
| D1     | `d1`                  | `0`                                | `true`                                   |

Rejected: `static`/`shadow`/`d1` with any non-zero percent, `canary` with `0`
or any unreviewed percent (`10`, `50`, `100`, `05`, `1.0`, …), and a manifest
whose cutover flag contradicts its mode. Cutover is derived, never an input.
`25` is a new reviewed staging step (1 → 5 → 25 → d1); percentages remain
deterministic per household (`isRecipeCanaryTenant`), never request-random.
Before production mutation, the workflow authenticates the protected current
state, confirms `RELEASE_VERIFY_TOKEN` exists in both GitHub and the Worker,
and snapshots the sole 100% Worker version. Promotions must follow
shadow → canary 1 → optional 2 / 5 → 25 → d1 on the same exact SHA; stale,
skipped and reverse dispatches fail. A downgrade requires the explicit rollback
checkbox, so an old queued dispatch cannot silently undo a later stage.
Additional gates: the release ref must resolve to the current `origin/main`
tip (`validateReleaseSource`), a candidate SHA that is not a descendant of the
currently deployed commit is rejected as moving code backwards even while
authority stays `static`/`shadow`, bootstrap from an unavailable protected
endpoint requires the explicit confirmation checkbox, and `shadow → canary-1`
requires the shadow probe evidence to prove D1 (ready, 500 served, release
fingerprint) — `shadow` can no longer promote on `not_evaluated` readiness.

## 4. Observability (T19C)

- Public `GET /api/v1/health/ready` gains a sanitized `recipeAuthority` summary:
  `configuredMode | invalid`, `cutoverEnabled`, `canaryPercent`, `globalSource`
  (`static` / `d1` / `mixed` during a canary), `fallbackReason`, `releaseId`,
  `expectedRecipeCount`. No household, user, token or binding data.
- Protected `GET /api/v1/health/recipe-authority` (bearer
  `RELEASE_VERIFY_TOKEN` Worker secret, ≥32 chars, constant-time compare; 404
  when the secret is absent) returns full evidence: environment, commit,
  configured/selected/actual source, served count and fingerprint, expected
  release fingerprint, `fingerprintMatchesRelease`, `d1Readiness` +
  `d1ReadinessCode`, fallback reason, bounded counters. In `canary` the probe is
  resolved as an in-cohort tenant (probe-only percent 100, operator cohort not
  consulted) so D1 readiness is actually exercised; the reported percent stays
  the configured value. In `shadow` the probe resolves through a probe-local
  D1 configuration (users keep receiving static) so the protected evidence
  proves D1 readiness and the release fingerprint before any canary; `static`
  evidence must report `d1Readiness: not_evaluated`. The public `/health/ready`
  canary summary also probes in-cohort and reports a real fallback instead of a
  fabricated `null`. Tests assert the body never matches secret/PII patterns.

## 5. Post-deploy verification (T19D)

- `scripts/post-deploy-smoke.sh` requires a parsed `recipeAuthority` mode,
  `EXPECTED_RECIPE_CATALOG_MODE` equality when provided, and no fallback while a
  D1 state is configured.
- `node scripts/release-check.mjs authority release-manifest.json` reads the
  protected evidence (`APP_SMOKE_URL` + `RELEASE_VERIFY_TOKEN`) and requires it
  to echo the approved manifest (environment, exact SHA, mode, cutover,
  percent, release ID, expected count) and to serve exactly what the state
  promises: static states → 71 legacy recipes with the legacy fingerprint and
  no fallback; D1 states → verified D1, served count 500, served fingerprint ==
  `expectedRuntimeFingerprint`, `d1Readiness: ready`, `fallbackReason: null`.
  Any D1 fallback fails the step — a HOLD/ROLLBACK signal, never a pass.
- The workflow runs it after `wait-for-deployed-release.mjs` and the smoke in
  both staging and production. Staging is fail-closed: before deploying it
  requires `STAGING_URL` (exact HTTPS origin), `STAGING_RELEASE_VERIFY_TOKEN`
  (≥32 chars) and the staging Worker secret `RELEASE_VERIFY_TOKEN`
  (`wrangler secret list --config wrangler.staging.jsonc`); production uses
  `secrets.RELEASE_VERIFY_TOKEN` unconditionally.
- Production pre-deploy certification is read-only and fail-closed:
  `d1-migration-check.mjs config` (committed `wrangler.jsonc` parsed as JSONC
  with duplicate-key rejection; exactly one D1 binding `DB → frigo-db` with the
  pinned database ID), `wrangler whoami` + `d1 list` (+ `d1 info` when the
  token scope allows) identity, the SELECT-only schema gate, the migration
  ledger, and `release-certify`: exact recipe count, `runtime_fields` count,
  `runtime_order` 0..N-1, ordered recipe IDs equal to the release manifest's
  `orderedRecipeIds`, zero duplicate IDs/slugs, per-recipe completeness, media
  still pending, the complete release with its runtime fingerprint expectation,
  `PRAGMA foreign_key_check` empty and `PRAGMA quick_check = ok`. The
  migration workflow additionally certifies runtime content (`runtime-catalog`:
  the Worker's own reader → hydrator → fingerprint pipeline over the remote
  rows must reproduce `expectedRuntimeFingerprint`).
- Worker identity is proven before and after the mutation: `rollback-target`
  reads the previous 100% version (`wrangler versions view`) and requires its
  D1 binding to be `DB` → the pinned production database; `deployed-binding`
  requires the new active 100% version to carry the same binding and a new
  deployment ID.
- Any production deploy or proof failure — including a cancelled run after a
  successful preflight — restores the preflight-snapshotted version through
  `scripts/cloudflare-worker-rollback.mjs` (Cloudflare API percentage
  deployment, bounded deadline, one `force=true` retry only for Cloudflare code
  10220, token never logged). The proof then requires a new deployment ID, the
  exact previous version at 100%, its D1 binding, the mutation receipt, and
  the complete prior protected authority evidence (all stable fields) to be
  restored within 180 s; a failed rollback keeps the run failed.

## 6. Catalog truth (verified locally)

`pnpm recipe:import:check` → `releaseId=rel-bd00a4f53fcaeee4 recipes=500 batches=2`.
`data/recipe-import/approved-batches.json`: `t14f-pilot-30-v1` (30,
`0036_recipe_catalog_pilot.sql`) + `t14f-scale-399-v1` (399,
`0037_recipe_catalog_scale.sql`); legacy 71. Fresh SQLite replay of the whole
ledger yields 500 recipes and D1 authority readiness `ready` with the release
fingerprint (existing T14F suites + new T19 suites). No recipe prose was
regenerated.

## 7. Rollback semantics

Serving-authority rollback is configuration only: dispatch Deploy with
`recipe_catalog_mode=shadow` (or `static`), percent `0`. The release proof then
requires the state's evidence contract (`static`: static 71, legacy
fingerprint, `not_evaluated`; `shadow`: users static while the probe proves D1
500 with the release fingerprint), `fallbackReason null`. Stored D1-authority
plans become `catalog_authority_changed` and must be
regenerated (no data is destroyed). Schema rollback is a different operation and
is never performed by deletion or ledger edits. Automatic Worker-version
rollback after a failed deployment is described in section 5.

## 8. Test evidence (this branch)

- `tests/integration/t19-recipe-authority-split.test.ts` — 10 tests: fixture
  truth (71 / 500 / 429 D1-only), per-mode universe equality (static, shadow,
  canary outside/inside, d1) through the real Worker for list → plan →
  alternatives → swap → detail → cook start, static fingerprint isolation, D1
  readiness failure (Recipe API + Planner fall back together), authority
  spoofing + cross-household, and D1-only recipe planner → swap → shopping →
  detail → cook start → cook complete (inventory events written; static 404).
- `tests/integration/t19-planner-authority-persistence.test.ts` — 18 tests:
  static/d1 planner universes, hidden-family/ingredient fencing, enrichment
  failure keeping the D1 universe, planner content from the resolved snapshot
  (not a later raw read), fingerprint semantics incl. same-source drift, stored
  authority identity, typed revalidation, lock dropping on rollback, pre-T19
  plan compatibility, one authority resolution per mutation.
- `tests/integration/t19-recipe-authority-observability.test.ts` — 16 tests:
  public summary per mode, invalid config, D1 fallback truthfulness, protected
  endpoint auth (404/401, Bearer scheme required), per-mode evidence +
  release-check proof, HOLD signal on fallback, canary and shadow probe
  semantics, no-leak assertions.
- `tests/unit/release-check.test.mjs` — 155 tests including the full valid /
  contradictory state matrix, monotonic transition/stale-dispatch/backwards-SHA
  checks, shadow D1-proof requirement, exact-version + binding + mutation
  rollback proof, deployed-binding proof, the T19D authority proof and the
  workflow guardrails (step order, cancellation rollback, staging fail-closed).
- `tests/unit/d1-migration-check.test.mjs` — 32 tests: JSONC config
  certification, identity, catalog identity/duplicates/order, runtime-content
  pipeline, release certification, health checks.
- `tests/unit/cloudflare-worker-rollback.test.mjs` — 10 tests: input
  validation, exact request body, transient retries within a deadline, single
  forced retry on code 10220, no secret leakage.
- Existing planner suites were adapted only where they depended on synthetic
  D1-only rows being plannable (`fixtureRecipeAuthority` seam; preview fixtures
  now plan from the real catalog); `shopping-hardening` lossy-boundary case now
  asserts the truthful unresolved outcome instead of a throw.

Exact commands, counts and the production gate status are in
`docs/ai/CURRENT_STATE.md` / `HANDOFF.md`.

## 9. Production status and blocker

The historical publication blocker is resolved: the immutable original branch
is on GitHub and the application checkpoint is integrated from current main.
The current gates are publication of the integration branch, an application PR,
exact-head hosted CI/review, merge, and exact-main certification. Production
then requires the reviewed Deploy workflow, GitHub `production` Environment
approval, verified Cloudflare/D1 identity, and the required release-evidence
secrets. No production mutation has been performed.

## 10. T20 handoff (unchanged product scope)

T20 Meal Composition V2 (MealPlan → Day → Meal → components[]; MANUAL /
ASSISTED / AUTO; `recipe_meal_roles`; simple foods; V1 plan compatibility) is the
next approved product phase after `T19_COMPLETE` and starts from final main on
`feat/t20-meal-composition-v2`. T20 is blocked and has not started.
