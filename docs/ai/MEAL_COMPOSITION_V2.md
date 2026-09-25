# T20 — Meal Composition V2

Status: code-complete candidate on `feat/t20-meal-composition-v2`, gated off by
default. No production deployment, no production D1 migration. See ADR-031.

## Architecture map (audited current state → T20)

| Area | Current authority (unchanged) | T20 addition |
| --- | --- | --- |
| Planner persistence | `generated_meal_plans` (0022): versioned JSON envelopes, creator-private, `revision` optimistic lock, creation `Idempotency-Key` | `generated_meal_plan_compositions` + `generated_meal_plan_components` (0039) keyed by the existing plan ID and V1 slot ID |
| Planner engine | T04 `planWeeklyMeals` (beam search, one recipe per slot, locks) | Unchanged; used as the V1 anchor and by V1 regenerate |
| Recipe authority | T19 `RecipeAuthoritySnapshot` resolved by server composition; planner catalog projected onto it | Consumed as-is: every component, picker item and Auto candidate is fenced to `snapshot.visibleRecipeIds` / `authority.list()` |
| Inventory | T02 availability + T04 `applyProjectedConsumption` (FEFO witness, branch-local, no real stock writes) | One running projection over every component of every meal |
| Shopping | T05 `aggregateShoppingDemand` / `optimizeShopping` over per-slot shortages | Composed plans feed the same T05 with composition shortages from the single projection |
| Personalization / safety | T03 hard eligibility (allergen, dietary, forbidden, never-recommend, time) | Auto/Assisted candidates ranked by T03; Manual rejects hard conflicts |
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
| GET | `/compositions/picker` | `role, q, kind, cursor, limit ≤ 24` |

Requests are strict Zod objects: unknown fields (authority, household, provenance,
role source, confidence, inventory, prices, weights) are 422. Manual adds are
locked by default (explicit user intent is protected from regeneration). Roles
must be permitted for the dish. Past slots and authority changes are typed 409s.
Retrying a mutation with the same revision is a 409 and cannot duplicate
components (partial unique indexes also enforce one dish per meal).

## Assisted and Auto

`candidates.ts` + `composer.ts`. Candidates: authority-fenced recipes whose roles
intersect the roles to fill, evaluated by T02 against the inventory state at that
slot (after earlier slots' components), ranked by T03 (hard eligibility first);
unresolved quantities and wrong meal types are excluded as in V1; simple foods are
excluded when any allergen/dietary policy exists (unknown safety) or a forbidden
ingredient applies. Search: ≤ 4 anchors (mains), ≤ 6 candidates per role, beam 8,
≤ 1,200 partial expansions, ≤ 2,400 scoring operations, ≤ 3 options, ≤ 320
catalog candidates; hard compatibility rules (duplicate, two mains, two soups,
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

## Picker

Server-authoritative summary DTOs (no ingredients/steps), role/kind/text filters,
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

1. Apply `0039` to the target D1 (the schema gate blocks deploys until the ledger
   matches the repository — merging T20 therefore requires the migration step).
2. Enable `MEAL_COMPOSITION_V2_ENABLED` (server) and `VITE_MEAL_COMPOSITION_V2_ENABLED`
   (build) together, independent of every T19 recipe-authority flag.
3. Append the 0039 SHA-256 to `tests/fixtures/migration-sha256.json` after it is
   applied (fixture policy).

## Deferred

Leftovers (produced-serving ledger) — future T20B/T21; the component model has
room for a `leftover` kind/provenance without changing identity or locks.
Per-component servings, reviewed role curation UI/import, AI-assisted offline role
proposals, drag-and-drop reordering, whole-week Auto, price-aware scoring.
