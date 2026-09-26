-- T20 Meal Composition V2 (ADR-031). Additive only: no existing table, row or migration changes.
-- A V1 generated plan slot without a composition row keeps its V1 meaning and is projected at read
-- time as a one-component composition (role main, provenance legacy_v1). Rows below exist only for
-- slots a user explicitly edited, completed or auto-composed through the gated V2 API.

-- MealComposition: one row per edited generated-plan slot. Presence means the component rows are
-- canonical for that slot (including an intentionally empty meal).
CREATE TABLE generated_meal_plan_compositions (
  plan_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  slot_id TEXT NOT NULL CHECK (length(slot_id) BETWEEN 1 AND 64),
  mode TEXT NOT NULL CHECK (mode IN ('manual', 'assisted', 'auto')),
  created_revision INTEGER NOT NULL CHECK (typeof(created_revision) = 'integer' AND created_revision >= 1),
  updated_revision INTEGER NOT NULL CHECK (typeof(updated_revision) = 'integer' AND updated_revision >= created_revision),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    CHECK (created_at IS strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    CHECK (updated_at IS strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  PRIMARY KEY (plan_id, slot_id),
  FOREIGN KEY (plan_id, household_id, creator_user_id)
    REFERENCES generated_meal_plans(id, household_id, creator_user_id) ON DELETE CASCADE
);

-- MealComponent: ordered, lockable dishes of one composition. Recipe IDs are validated against the
-- request's effective recipe authority by the application (T19); there is deliberately no FK to
-- recipes so catalog maintenance can never cascade into stored user plans.
CREATE TABLE generated_meal_plan_components (
  plan_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  slot_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 7),
  kind TEXT NOT NULL CHECK (kind IN ('recipe', 'simple_food')),
  role TEXT NOT NULL CHECK (role IN ('main', 'side', 'vegetable', 'soup', 'staple', 'dessert', 'simple_food')),
  recipe_id TEXT CHECK (recipe_id IS NULL OR length(recipe_id) BETWEEN 1 AND 200),
  simple_food_id TEXT CHECK (simple_food_id IS NULL OR length(simple_food_id) BETWEEN 4 AND 63),
  locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
  provenance TEXT NOT NULL CHECK (provenance IN ('legacy_v1', 'manual', 'assisted', 'auto')),
  created_revision INTEGER NOT NULL CHECK (typeof(created_revision) = 'integer' AND created_revision >= 1),
  updated_revision INTEGER NOT NULL CHECK (typeof(updated_revision) = 'integer' AND updated_revision >= created_revision),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    CHECK (created_at IS strftime('%Y-%m-%dT%H:%M:%fZ', created_at)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    CHECK (updated_at IS strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)),
  CHECK ((kind = 'recipe' AND recipe_id IS NOT NULL AND simple_food_id IS NULL)
    OR (kind = 'simple_food' AND simple_food_id IS NOT NULL AND recipe_id IS NULL)),
  PRIMARY KEY (plan_id, id),
  UNIQUE (plan_id, slot_id, ordinal),
  FOREIGN KEY (plan_id, slot_id) REFERENCES generated_meal_plan_compositions(plan_id, slot_id) ON DELETE CASCADE
);

-- The same dish cannot appear twice in one meal.
CREATE UNIQUE INDEX idx_generated_meal_plan_components_recipe
  ON generated_meal_plan_components(plan_id, slot_id, recipe_id) WHERE recipe_id IS NOT NULL;
CREATE UNIQUE INDEX idx_generated_meal_plan_components_simple_food
  ON generated_meal_plan_components(plan_id, slot_id, simple_food_id) WHERE simple_food_id IS NOT NULL;

-- Persisted recipe-role metadata with provenance. Rule-derived roles are computed deterministically
-- (versioned rules) and are not duplicated here; rows record reviewed, imported, AI-inferred or
-- legacy assignments. Global catalog metadata: no household API writes this table.
CREATE TABLE recipe_role_assignments (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('main', 'side', 'vegetable', 'soup', 'staple', 'dessert', 'simple_food')),
  source TEXT NOT NULL CHECK (source IN ('reviewed', 'imported', 'rule', 'ai', 'legacy')),
  decision TEXT NOT NULL DEFAULT 'assign' CHECK (decision IN ('assign', 'reject')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  evidence TEXT CHECK (evidence IS NULL OR length(evidence) <= 500),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    CHECK (recorded_at IS strftime('%Y-%m-%dT%H:%M:%fZ', recorded_at)),
  PRIMARY KEY (recipe_id, role, source),
  -- Confidence is meaningful only for inferred classifications; never fabricated for others.
  CHECK ((source = 'ai') = (confidence IS NOT NULL)),
  CHECK (source <> 'reviewed' OR reviewed = 1),
  CHECK (decision = 'assign' OR reviewed = 1)
);
