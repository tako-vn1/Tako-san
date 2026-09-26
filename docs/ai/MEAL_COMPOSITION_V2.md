# T20 — Meal Composition V2

Status: branch-local code gate green at `869f035` (PR #9 stacked on open PR #8);
not exact-main or staging certified. Default OFF. No production deployment or
production D1 migration. See ADR-031 and the current HANDOFF for blockers.

## Hardening certification boundary (2026-09-26)

- Torn plan/composition reads are revision-checked before component mutations,
  and Auto/Assisted apply rechecks before resolving an option. A slot that
  remains absent returns 404; one concurrently added with a stale request
  returns 409. True current-revision component misses remain 404. One fenced
  D1 batch remains the sole write. Worker/SQLite races cover the stale cases.
- Manual changes recheck the edited slot from its first affected component
  using the same T02 inventory before each component as shopping. Later meals
  whose T02 safety inputs change are rechecked too, including V1 family
  variants; unchanged prefix and unrelated later meals stay trusted. The same
  T03 hard restrictions and T19 authority apply throughout. The forbidden
  reviewed substitutions in regressions are injected test fixtures, not a
  statement about production policy.
- Cuisine picker drops stale responses/pages when filters change, keeping only
  rows tied to the active filter tuple. API strict cuisine validation, stable
  ordering and pre-pagination filtering were checked with combined queries;
  the isolated paired-flag preview was inspected at 390/768/1280px.
- Local `pnpm check` at `869f035`: 202 files / 4,574 tests, migration smoke and
  build PASS; PR #9 exact-head hosted CI is not yet available until PR #8 is
  merged and #9 is retargeted to main. Staging identity/ledger cannot be
  verified here without staging credentials; no staging or production mutation
  occurred. Never infer 0039's remote status from local migration smoke.

Pending production packet (do not dispatch until staging and exact-main are
certified): pin the merged main SHA; an authorized operator must read the
actual production ledger and confirm its expected pre-tip before applying
`0039_meal_composition_v2.sql` via the reviewed
`production-d1-migrate.yml` workflow (`ref`, `expected_pre_tip`, `migration`,
`confirm_production_migration`) with required production Environment approval
and Cloudflare secrets. Record the workflow's Time Travel bookmark, aggregate
baseline, FK/quick check and catalog identity receipt. For deploy use
`deploy.yml` with `environment=production`, exact `ref`/`hardened_sha`,
`confirm_production=true`, existing T19 catalog inputs and
`meal_composition_v2_enabled=false`; smoke V1/auth/recipe detail/cooking/
shopping/500 catalog before a separately approved dispatch with that one
flag `true`. Rollback enablement by redeploying the same certified code with
flag false; D1 restoration, if required, is an operator-approved Time Travel
decision. No production inputs are currently authorized for this task.

## Architecture map (audited current state → T20)

| Area | Current authority (unchanged) | T20 addition |
| --- | --- | --- |
| Planner persistence | `generated_meal_plans` (0022): versioned JSON envelopes, creator-private, `revision` optimistic lock, creation `Idempotency-Key` | `generated_meal_plan_compositions` + `generated_meal_plan_components` (0039) keyed by the existing plan ID and V1 slot ID |
| Planner engine | T04 `planWeeklyMeals` (beam search, one recipe per slot, locks) | Unchanged; used as the V1 anchor and by V1 regenerate |
| Recipe authority | T19 `RecipeAuthoritySnapshot` resolved by server composition; planner catalog projected onto it | Consumed as-is: every component, picker item and Auto candidate is fenced to `snapshot.visibleRecipeIds` / `authority.list()` |
| Inventory | T02 availability + T04 `applyProjectedConsumption` (FEFO witness, branch-local, no real stock writes) | One running projection over every component of every meal |
| Shopping | T05 `aggregateShoppingDemand` / `optimizeShopping` over per-slot shortages | Composed plans feed the same T05 with composition shortages from the single projection |
| Personalization / safety | T03 hard eligibility (allergen, dietary, forbidden, never-recommend, time, hard nutrition; unknown = excluded) | One definition, `evaluateHardRestrictions`: Auto/Assisted via T03 ranking, Manual via `composition/restrictions.ts` on the same T02 candidate; no manual override |
| API | `/api/v1/meal-planning/plans…` (cookie auth, tenancy, CSRF, rate limits, 64 KiB body) | New sub-routes under the same middleware plus `MEAL_COMPOSITION_V2_ENABLED` |
| UI | `/planner` (T06B) behind `VITE_MEAL_PLANNER_ENABLED` | Composer, picker and composed week cards behind `VITE_MEAL_COMPOSITION_V2_ENABLED` |

## Domain model

`MealComposition` (one per slot) → ordered `MealComponent[]`
(`packages/recipes/src/composition/model.ts`). A component has a stable ID
(unique within the plan), `kind` (`recipe` | `simple_food`), `role`, `ordinal`,
`locked`, `provenance` (`legacy_v1` | `manual` | `assisted` | `auto`),
`recipeId` **or** `simpleFoodId` (never overloaded), and created/updated
revisions. Manual, Assisted and Auto share this one model; they differ only in
the operation and provenance recorded. Operations are pure: add, remove, swap,
update (lock/role/order), replace (Manual save) and `applyGenerated`, which
refuses to remove or change a locked component and re-verifies every locked
component after application.

Roles: `main`, `side`, `vegetable`, `soup`, `staple`, `dessert`, `simple_food`
(closed enum in contracts, SQL CHECKs and the domain). Meal profiles are flexible
(`profiles.ts`): breakfast requires `main`; lunch requires `main` and recommends
`vegetable`, `staple`; dinner requires `main`, `staple` and recommends
`vegetable`, `soup`. Optional roles are only added by the user. One-dish mains
imply roles (`includes_staple` covers staple, `brothy` covers soup).

## Storage and V1 compatibility

Migration `0039_meal_composition_v2.sql` is additive (three new tables, two
partial unique indexes). No existing table/row changes; no FK to `recipes` from
components (authority is validated by the application, catalog maintenance can
never cascade into user plans).

- A slot **without** a composition row is read as the V1 projection:
  `Dinner → pho-bo` ≡ one component `{id: "v1.<slotId>", role: main,
  provenance: legacy_v1, recipeId: pho-bo}`, locked iff the V1 plan has a lock.
- The first V2 mutation materialises the slot (same component ID). From then on
  the component rows are canonical for that slot; the V1 `result_json` stays the
  unchanged generation record. V1 GET responses keep their exact schema.
- One revision authority: every V2 mutation bumps `generated_meal_plans.revision`
  in the same D1 batch, behind a fence statement that aborts the batch unless the
  owned plan is still at the expected revision.
- V1 operations with the V2 flag on: `swap` on a composed slot → 409
  `COMPOSITION_MANAGED_SLOT`; `regenerate` turns locked V2 mains into V1 locks,
  keeps every locked component and replaces unlocked ones with the new anchor, in
  one atomic write; `shopping` projects every component. With the flag off every
  V1 path is byte-for-byte pre-T20 and no composition table is read.

## Role enrichment

`roles.ts`: deterministic rules (`ROLE_RULES_VERSION = t20-roles-v1`) over title,
category, tags, ingredient lines and cook time. Protein and soup/dessert keywords
are matched diacritic-aware (`cà chua` ≠ `cá`, `canh` ≠ `cánh`, `nấm đùi gà` is a
mushroom). Rule assignments carry evidence strings and **no confidence**.
`recipe_role_assignments` persists reviewed / imported / AI / legacy rows with
SQL-enforced provenance: confidence only (and always) for `ai`; `reviewed`
source implies `reviewed=1`; only human review can `reject`. Resolution: any
human-reviewed assignment set is authoritative; otherwise rule ∪ imported ∪
legacy ∪ AI(confidence ≥ 0.8) minus reviewed rejections; low-confidence AI rows
and rule fallbacks are flagged `reviewRequired`. Persisted rows are read only for
`d1` authority and fenced to the visible universe (static reads no D1 planner
rows, as in T19). No runtime AI call exists.

500-recipe D1 release (pinned test): main 362, side 87, soup 70, vegetable 37,
simple_food 7, staple 0, dessert 0; unclassified 0; invalid 0; duplicates 0;
contradictions 0; review-required 0. Staple and dessert are served by simple foods.

## Simple foods

`simple-foods.ts`: nine bounded items (rice, boiled egg, cucumber, water spinach,
broccoli, milk, bread, fruit, yogurt). A portion names one canonical ingredient
per serving (e.g. rice 80 g) or `null` = not inventory-tracked (bread, fruit,
yogurt: no canonical ingredient exists; they add no shopping demand and are shown
as “not tracked”). No nutrition claims. No cooking workflow (UI says so).

## Manual builder

Routes (all under `/api/v1/meal-planning`, cookie auth, tenancy, CSRF, 64 KiB):

| Method | Path | Body / query |
| --- | --- | --- |
| GET | `/plans/:id/compositions` | — |
| GET | `/plans/:id/slots/:slotId/composition` | — |
| PUT | `/plans/:id/slots/:slotId/composition` | `{revision, components[]}` (Manual save) |
| POST | `/plans/:id/slots/:slotId/components` | `{revision, target, role, locked=true}` |
| POST | `/plans/:id/slots/:slotId/components/:componentId/swap` | `{revision, target, role?}` |
| PATCH | `/plans/:id/slots/:slotId/components/:componentId` | `{revision, locked?, role?, ordinal?}` |
| DELETE | `/plans/:id/slots/:slotId/components/:componentId` | `?revision=N` |
| POST | `/plans/:id/slots/:slotId/assist` · `/assist/apply` | `{revision, action, variant}` · `+ proposalId` |
| POST | `/plans/:id/slots/:slotId/auto` · `/auto/apply` | `{revision, variant}` · `+ optionId` |
| GET | `/compositions/picker` | `role, cuisine, q, kind, cursor, limit ≤ 24` |

Requests are strict Zod objects: unknown fields (authority, household, provenance,
role source, confidence, inventory, prices, weights) are 422. Manual adds are
locked by default (explicit user intent is protected from regeneration). Roles
must be permitted for the dish. Past slots and authority changes are typed 409s.
Retrying a mutation with the same revision is a 409 and cannot duplicate
components (partial unique indexes also enforce one dish per meal).

Hard restrictions (review P1 remediation): every component from the first
affected position of a Manual mutation (add, swap, reorder, role, remove,
replace/save, and Assisted/Auto apply) is judged by T03
`evaluateHardRestrictions` — the same function T03 ranking uses — over the same
trusted planning context as Auto: the recipe's T02 candidate at this slot's
projected inventory (planner substitution policy included, so a forbidden
approved substitute counts), the server evidence provider, and the household +
member hard policies. Requested allergen/dietary tags without review evidence,
unknown or exceeded `hardMaxTimeMinutes`, and hard nutrition targets without
reviewed nutrition all reject with 422 `HARD_CONSTRAINT_CONFLICT` (event
`composition_hard_restriction_rejected` carries reason codes only). Simple foods
have no safety/nutrition evidence: any requested allergen/dietary tag or hard
nutrition target rejects them; their `prepMinutes` is the total time; only the
tracked portion ingredient is checked for forbidden ingredients. A changed
inventory prefix also rechecks affected later meals, including legacy-family
variants, through the shared T03 evaluator; stable unchanged prefixes and
unrelated meals are not re-judged. Lock-only updates need no safety replay.
The picker still lists recipes with `constraintState: unknown` when safety is
requested (the server rejects on save); simple foods the contract rejects are
hidden.

V1 family-variant meals: not composable (Manual, Assisted and Auto are 422
`LEGACY_FAMILY_COMPOSITION_UNSUPPORTED`); the UI keeps the V1 “Swap meal”
control for those slots and shows no composer. They still take part in the single
projection as a `legacy_family` projection component (the exact T04 variant:
family ID, version, variant ID), so composed-plan shopping includes their demand;
a variant that no longer resolves is 409 `COMPOSITION_REVALIDATION_REQUIRED`.

## Assisted and Auto

`candidates.ts` + `composer.ts`. Candidates: authority-fenced recipes whose roles
intersect the roles to fill, evaluated by T02 against the inventory state at that
slot (after earlier slots' components), ranked by T03 (hard eligibility first);
unresolved quantities and wrong meal types are excluded as in V1; simple foods are
judged by the same `simpleFoodRestrictions` as Manual. Every role-matching recipe
is generated and ranked before selection; eligible simple foods reserve slots
inside the same **absolute 320-candidate total cap**. A fair per-role selection
uses the T03-ranked recipes to cover scarce roles (multi-role recipes count toward
each role but take just one slot); remaining slots are backfilled by global rank.
The result is independent of catalog input order. Search: ≤ 4 anchors (mains),
≤ 6 candidates per role, beam 8, ≤ 1,200 partial expansions, ≤ 2,400 *executed*
scoring operations, ≤ 3 options; when scoring budget is exhausted, no further
scoring runs and already-scored partials are returned. Hard compatibility rules (duplicate, two mains, two soups,
staple conflict) prune; soft rules (dominant-ingredient repeat, all fried) lower
`variety`. Score = weighted parts (roleCompleteness .30, inventoryCoverage .20,
shoppingCostProxy .15, preferenceFit .15, variety .10, ingredientReuse .05,
effort .05) returned decomposed; no currency claims. Deterministic total order;
`variant` 0–9 is the only variation. Explanations are codes (uses N fridge
ingredients, N extra ingredients, role added, locked kept, role unfilled).

Suggestion vs mutation: `assist`/`auto` never write. `…/apply` recomputes the
options from current trusted inputs and applies only if the requested ID still
matches (`PROPOSAL_STALE` otherwise). “complete” keeps every component and adds
missing required + recommended roles; “regenerate_unlocked” and Auto keep locked
components and replace unlocked ones.

## Shopping (single subtraction)

`projection.ts`: every component of every meal is evaluated by T02 against ONE
running projected inventory, chronologically, applying T04's exact consumption
witness after each component. Tomato 300 g (soup) + 300 g (salad) vs 500 g stock
buys 100 g — never `max(0,300−500)+max(0,300−500)`. The per-slot concatenated
shortages go to the unchanged T05 aggregation (unit normalization, contextual
units stay unresolved). Planning and shopping never mutate inventory.

The projection's `EvaluationScope` requires the substitution policy
(`substitutions`, `approvedSubstitutionIds`, `activeConstraints`) and is built by
`evaluationScope(context)` from the same trusted planning context the planner and
Auto candidates use, so an approved substitute Auto relied on is also what
shopping consumes (regression: direct vs substitute competition across
components and slots, and an unapproved rule is never used). The current
production context has no reviewed substitution registry (empty lists, as in V1).

## Picker

Server-authoritative summary DTOs (no ingredients/steps), role/cuisine/kind/text
filters (cuisine matches stored recipe metadata only; simple foods have none and
are excluded when it is set),
stable ordering (normalized title, ID), offset cursor, ≤ 24 per page. One
authority resolution + one ranking-context batch + one role read per request;
statement count is constant across pages (tested). Static authority lists exactly
the 71 static recipes; d1 lists the 500.

## UI

`MealComposer.tsx`, `ComponentPicker.tsx`, composed cards in `PlannerWeek.tsx`.
Progressive disclosure (per-dish actions in a disclosure), lock toggles with
`aria-pressed`, role labels, one polite live region, focus restoration across
the revision remount, picker as focus-trapped modal (bottom sheet on mobile,
Escape cancels without mutation). Once a slot is composed, the V1 dish title,
ingredients and method are hidden (each component links to recipe detail and
cooking; simple foods state that no cooking steps exist).

## Observability

`composition_generated`, `composition_manual_update`, `composition_assisted_update`,
`composition_auto_generated`, `composition_generation_failed`,
`composition_budget_exhausted`, `composition_role_enrichment_unavailable`: mode,
counts, duration and failure code only. No notes, titles, lists, IDs or tokens.

## Rollout prerequisites (not performed)

1. Apply `0039` to the target D1 before deployment (the production schema gate
   blocks deploys until the ledger matches the repository). This does not block
   merging; staging must also be migrated before enabling V2 there.
2. Enable both flags in one reviewed release: `deploy.yml` dispatch input
   `meal_composition_v2_enabled` (default false) is normalized once by
   `release-check.mjs gate` (`'true'` only for an explicit dispatch; pushes and any
   other value are `'false'`, recorded in the release manifest). The same output
   feeds the Build step's `VITE_MEAL_COMPOSITION_V2_ENABLED` and the Worker
   `--var MEAL_COMPOSITION_V2_ENABLED`; `scripts/composition-flags.mjs verify`
   fails the job unless server, UI, manifest and the value Vite actually compiled
   (`dist/composition-flags.json`) are all `true` or all `false`. Wrangler configs
   default the var to `"false"`. Independent of every T19 recipe-authority flag. A
   mismatched runtime (UI on, server 404) falls back to the V1 meal controls.
3. Append the 0039 SHA-256 to `tests/fixtures/migration-sha256.json` after it is
   applied (fixture policy).

## Deferred

Leftovers (produced-serving ledger) — future T20B/T21; the component model has
room for a `leftover` kind/provenance without changing identity or locks.
Per-component servings, reviewed role curation UI/import, AI-assisted offline role
proposals, drag-and-drop reordering, whole-week Auto, price-aware scoring.
