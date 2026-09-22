# T19 V2 — One Recipe Authority and the 500-recipe D1 cutover

Status: **T19_CODE_COMPLETE_PRODUCTION_BLOCKED** (see the final section for the
exact blocker). Branch `feat/t19-recipe-authority-cutover-v2` from canonical
main `4677ebb` (repository ID `1368281478`, currently `vn-tako2/Frigo-dev`).

The old unpublished T19 checkpoint (`7ac0433fba748f2c1c4af3988eaae6b08404bf74`) was never available
to this session and was **not** reconstructed. Everything below is a fresh
implementation on current code truth.

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
                          source = d1     → rich D1 catalog fenced to the snapshot's recipe IDs
                          source = static → definitions/steps from the static snapshot itself
                                            + D1 supplementary facts keyed by visible ID only
                                            (classifications, nutrition rows, families, ingredient IDs)
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

### Mode contracts (all proven by tests)

| Mode | Recipe API | Planner / alternatives / swap | Shopping origin | Cooking |
| --- | --- | --- | --- | --- |
| `static` | static 71 | static 71; D1-only swap → 422 | static plan | static (D1-only → 404) |
| `shadow` | static 71 (D1 compared off-response) | static 71 | static plan | static |
| `canary` outside cohort | static | static | static | static |
| `canary` inside cohort (same FNV-1a household bucket + operator cohort as ADR-026) | verified D1 500 | D1 500 | D1 plan | D1 |
| `d1` | verified D1 500 | D1 500 | D1 plan | D1 |
| `canary`/`d1` with D1 readiness failure | static fallback | **same** static fallback | static | static |

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

| State | `recipe_catalog_mode` | `recipe_catalog_d1_canary_percent` | derived `RECIPE_CATALOG_CUTOVER_ENABLED` |
| --- | --- | --- | --- |
| STATIC | `static` | `0` | `false` |
| SHADOW | `shadow` | `0` | `false` |
| CANARY | `canary` | `1` / `2` / `5` / `25` | `true` |
| D1 | `d1` | `0` | `true` |

Rejected: `static`/`shadow`/`d1` with any non-zero percent, `canary` with `0`
or any unreviewed percent (`10`, `50`, `100`, `05`, `1.0`, …), and a manifest
whose cutover flag contradicts its mode. Cutover is derived, never an input.
`25` is a new reviewed staging step (1 → 5 → 25 → d1); percentages remain
deterministic per household (`isRecipeCanaryTenant`), never request-random.

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
  the configured value. Tests assert the body never matches secret/PII patterns.

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
  both staging (skipped with a notice when `STAGING_RELEASE_VERIFY_TOKEN` is
  unset) and production (unconditional; `secrets.RELEASE_VERIFY_TOKEN`).

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
requires `actualSource=static`, served 71, legacy fingerprint, `fallbackReason
null`. Stored D1-authority plans become `catalog_authority_changed` and must be
regenerated (no data is destroyed). Schema rollback is a different operation and
is never performed by deletion or ledger edits.

## 8. Test evidence (this branch)

- `tests/integration/t19-recipe-authority-split.test.ts` — 10 tests: fixture
  truth (71 / 500 / 429 D1-only), per-mode universe equality (static, shadow,
  canary outside/inside, d1) through the real Worker for list → plan →
  alternatives → swap → detail → cook start, static fingerprint isolation, D1
  readiness failure (Recipe API + Planner fall back together), authority
  spoofing + cross-household, and D1-only recipe planner → swap → shopping →
  detail → cook start → cook complete (inventory events written; static 404).
- `tests/integration/t19-planner-authority-persistence.test.ts` — 9 tests:
  static/d1 planner universes, fingerprint semantics, stored authority identity,
  typed revalidation, lock dropping on rollback, pre-T19 plan compatibility.
- `tests/integration/t19-recipe-authority-observability.test.ts` — 13 tests:
  public summary per mode, invalid config, D1 fallback truthfulness, protected
  endpoint auth (404/401), per-mode evidence + release-check proof, HOLD signal
  on fallback, canary probe semantics, no-leak assertions.
- `tests/unit/release-check.test.mjs` — 117 tests including the full valid /
  contradictory state matrix and the T19D proof.
- Existing planner suites were adapted only where they depended on synthetic
  D1-only rows being plannable (`fixtureRecipeAuthority` seam; preview fixtures
  now plan from the real catalog); `shopping-hardening` lossy-boundary case now
  asserts the truthful unresolved outcome instead of a throw.

Exact commands, counts and the production gate status are in
`docs/ai/CURRENT_STATE.md` / `HANDOFF.md`.

## 9. Production status and blocker

See `docs/ai/HANDOFF.md` (T19 section). Production progression requires the
reviewed Deploy workflow (GitHub `production` Environment approval, Cloudflare
secrets, and the new `RELEASE_VERIFY_TOKEN` Worker secret + repository secret).
None of these are available to this session, so no production mutation was
performed and the staged rollout (`shadow → canary → d1`) is the operator's next
action through the workflow.

## 10. T20 handoff (unchanged product scope)

T20 Meal Composition V2 (MealPlan → Day → Meal → components[]; MANUAL /
ASSISTED / AUTO; `recipe_meal_roles`; simple foods; V1 plan compatibility) is the
next approved product phase after T19 and starts from final main on
`feat/t20-meal-composition-v2`. It is not a T19 blocker.
