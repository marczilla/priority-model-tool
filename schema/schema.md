# priority_model.json — Schema Reference

The canonical configuration file for an APH m49 state funding priority model. Every state's model — Wyoming's PRM, MnDOT's 100-pt scale, ALDOT's three-category system, Louisiana's statute-driven program — encodes into one of these.

The JSON Schema (draft 2020-12) lives at `priority_model.schema.json` in this folder. This document explains the design and walks through how the four reference configs use it.

---

## Design principles

1. **Round-trip without loss.** Every reference state model in `reference_configs/` must encode without information loss. If a state model can't be expressed cleanly, the schema is wrong, not the state.
2. **One source of truth.** The configurator UI, scoring engine (Python and JS), Excel companion, and policy-manual generator all read from the same JSON. No format duplication.
3. **Composable, not template-based.** Rather than offering a fixed Wyoming-style template and a fixed MnDOT-style template, the schema lets a state mix patterns: Wyoming's category weights with MnDOT's negative-scoring tiers and Louisiana's eligibility gate.
4. **Auditable.** Every model carries a `decisions_log` recording what changed, when, why, and from what source. This is the artifact a state takes to its commission.
5. **Source-grounded.** Every criterion can carry an `acrp_category` mapping it to ACRP Synthesis 123's taxonomy, so the same comparison logic works across all models.

---

## Top-level structure

```json
{
  "schema_version": "1.0.0",
  "metadata": { ... },
  "eligibility_gate": { ... },        // optional (Louisiana pattern)
  "criteria": [ ... ],                 // 1+ scoring criteria
  "weighting_model": "...",            // how criterion scores combine
  "global_formula": "...",             // required if weighting_model = formula
  "set_asides": [ ... ],               // optional
  "adjustments": { ... },              // optional
  "governance": { ... },
  "disclaimer": "..."
}
```

---

## Weighting models

Four supported, covering every state pattern observed:

### `multiplicative` — Wyoming pattern
Each criterion has a `weight` (typically 1–5). Each criterion's `subcategories` provide a score (typically 0–4 or 0–5). The criterion's contribution is `weight × selected_score`. Final project score is the sum across all criteria.

> Wyoming Purpose of Project (weight 5, Safety subcategory score 4) → contribution = 20 points to that project.

### `additive_100pt` — MnDOT, ALDOT, Louisiana pattern
Each criterion has `max_points` capping its contribution. The criterion's score is the value of the matching subcategory (or sum of selected subcategories for `select_many`). Final project score is the sum across all criteria, designed to total 100 (or thereabouts).

> MnDOT Master Plan/ALP (max 10 points) → if updated and project is in plan, contributes 10. If inadequate with no programmed update, contributes −5.

### `formula` — Illinois pattern
A `global_formula` expression references criterion ids and computes the final score. Evaluated with a safe AST-based evaluator, never raw `eval()`.

> Illinois Rebuild IL: `PR = [((4*A) + (2*C) + (0.7*P) + (0.7*T))/4.2] + X` where A, C, P, T, X are individual criterion scores.

### `dual_objective_subjective` — North Dakota pattern
Two parallel scoring tracks: an objective set of criteria scored normally, plus a subjective override layer where commissioners can adjust rankings with documented justification. The schema tags some criteria as `subjective: true` (carried in `acrp_category` semantics) and the engine produces both an objective ranking and an adjusted ranking.

---

## Scoring styles (per criterion)

The `scoring_style` field on each criterion controls how the engine resolves a project to a score:

| Style | Picks | Used by |
|---|---|---|
| `select_one` | Exactly one subcategory matches; that subcategory's `score` is used | Wyoming Purpose, MnDOT Airport Component, Louisiana Facility Usage |
| `select_many` | Sum of all subcategory scores that match | ALDOT Sponsor Responsibility, Louisiana Special Considerations |
| `tiered_score` | Picks the matching tier; supports negative scores when `negative_scores_allowed: true` | MnDOT all five System Plan Alignment criteria |
| `flat_lookup` | Project's project_type field maps directly to a fixed point value | ALDOT Project Type (the 60+ entry lookup tables A–F) |
| `accumulating` | Sum of qualifying subcategories up to `max_points` | Wyoming Status of Airport Protection (4+3+1+1=9 max) |
| `formula` | Per-criterion expression over project fields | Custom states |

---

## ACRP taxonomy mapping

Every criterion can carry an `acrp_category` from ACRP Synthesis 123's 14-criterion catalog (extended with `system_plan_alignment` which appears in every state model we examined):

```
agency_goals             demand_accommodation     economic_development
safety_security          level_of_service         revenue_cost
environment              congestion               asset_preservation
community_impact         sustainability           benefit_cost
competition              risk                     regulatory_mandate
operational_effectiveness energy                  system_plan_alignment
```

This mapping powers the cross-state comparison view: when a consultant asks "how does Wyoming weight Safety vs. MnDOT?", the engine groups all `acrp_category: safety_security` criteria across loaded models and shows the comparison.

---

## Eligibility gate (Louisiana pattern)

Optional pre-scoring filter. If `eligibility_gate.enabled` is true, every project is checked against the `filters` array before scoring. Each filter has:

- `rule` — plain-language description (always shown to user)
- `field_check` — optional structured match for engine auto-evaluation
- `on_fail` — `exclude` (project removed from ranking), `warn` (scored but flagged), or `flag_for_review` (scored, sent to manual review)

Used by Louisiana's two-step process. Optional for everyone else.

---

## Set-asides

Funding portions reserved for specific project categories before ranking is applied. Each set-aside has:

- `allocation_pct` — percentage of total state funds
- `eligibility_filter` — plain-language rule
- `field_filter` — optional structured match

**Examples in reference configs:**
- Louisiana ACE Program: 21.622% reserved for air carrier airports
- Washington (when added): 25% non-NPIAS, 10% transformational

---

## Adjustments

Three optional post-scoring adjustments:

### `revenue_producing_bump`
Bonus for projects that don't compete well for FAA funds. ~1/3 of states use this per ACRP Ch 5. ALDOT's economic-development +10 is one form.

### `low_federal_priority_bonus` (Illinois pattern)
When integrated with m9 AIP Eligibility, projects with FAA NPRS scores below `nprs_threshold` get a `bonus_amount` added to their state score. Lets a state explicitly target federally underfunded projects.

### `tradeoff_layer` (North Dakota pattern)
Post-scoring sequencing. `urgency_sort` reorders by urgency within score tiers. `financial_impact_sort` reorders by funding impact. `discretion_override_allowed` permits the governing body to move projects up/down with documented justification.

---

## Governance block

The metadata that turns a model into adoptable policy:

- `decision_authority` — who has final approval (e.g., commission name)
- `decision_cadence` — annual / quarterly / monthly / rolling / biennial
- `statute_required` — boolean
- `statute_citation` — for Louisiana-style statutory states
- `model_review_cycle_years` — how often the model itself is reviewed and re-approved
- `scoring_authority` — typically the state aviation division
- `approval_process` — plain-language path from scoring to approval

The policy-manual generator (sprint 5) reads this block to produce the governance section of the output document.

---

## Worked example: how Wyoming encodes

Wyoming's PRM has 7 categories with weights 1–5 multiplied by subcategory scores 0–5. Total possible = 105 points.

```json
{
  "weighting_model": "multiplicative",
  "criteria": [
    {
      "id": "purpose_of_project",
      "weight": 5,
      "scoring_style": "select_one",
      "subcategories": [
        {"id": "safety", "score": 4},
        {"id": "security", "score": 3},
        {"id": "maintenance", "score": 3},
        {"id": "airport_enhancement", "score": 2},
        {"id": "planning", "score": 2}
      ]
    },
    ...
  ]
}
```

A safety-purpose project scores `5 × 4 = 20` from this category alone.

---

## Worked example: how MnDOT encodes

MnDOT's 100-point scale splits into 60 (System Plan Alignment) + 40 (MnDOT Priorities). Five criteria support negative scoring.

```json
{
  "weighting_model": "additive_100pt",
  "criteria": [
    {
      "id": "master_plan_alp",
      "bucket": "System Plan Alignment",
      "max_points": 10,
      "scoring_style": "tiered_score",
      "negative_scores_allowed": true,
      "subcategories": [
        {"id": "updated_and_included", "score": 10},
        {"id": "programmed_or_in_process", "score": 5},
        {"id": "inadequate_no_update", "score": -5}
      ],
      "external_metric_source": "https://mnsasp-mndot.hub.arcgis.com/"
    },
    ...
  ]
}
```

The `external_metric_source` field is what powers MnDOT's integration with their public MnSASP Hub dashboards.

---

## Worked example: how ALDOT encodes

ALDOT's Project Type (40 points) is a literal lookup table with 60+ entries. The schema uses `flat_lookup` to capture this without forcing a state into ALDOT-specific structure.

```json
{
  "id": "project_type",
  "max_points": 40,
  "scoring_style": "flat_lookup",
  "subcategories": [
    {"id": "primary_rwy_obstruction_removal", "score": 40},
    {"id": "primary_rwy_rsa", "score": 40},
    ...
    {"id": "infra_utilities", "score": 2}
  ]
}
```

A project with `project_type = "primary_rwy_rsa"` matches the second entry and contributes 40 points (capped by `max_points`).

---

## Worked example: how Louisiana encodes

Louisiana uses the eligibility gate plus four scoring categories. Specific point values defer to LA Adm Code Title 70 — placeholder tiers in the reference config let users adopt and customize.

```json
{
  "eligibility_gate": {
    "enabled": true,
    "filters": [
      {"id": "airport_sponsor_eligible", "rule": "...", "on_fail": "exclude"},
      {"id": "public_use_airport", "rule": "...", "on_fail": "exclude"},
      ...
    ]
  },
  "weighting_model": "additive_100pt",
  "set_asides": [
    {"id": "ace_program", "allocation_pct": 21.622, "field_filter": {...}}
  ],
  ...
}
```

---

## Validation

Every config in `reference_configs/` must pass:
1. JSON Schema validation against `priority_model.schema.json`.
2. Round-trip through the engine (sprint 2) producing scores against `sample_projects.csv`.
3. Known-answer tests where the encoded model produces the same ranking as the source state's published example calculations.

The `tests/` folder ships with the validation harness.

---

## Schema versioning

`schema_version` is a semver-like string. Major version bumps indicate breaking changes; minor bumps indicate additive fields; patch bumps are clarifications. Engines must check `schema_version` and refuse models with incompatible major versions.

Migration scripts (when needed) live in `schema/migrations/` and are run by the engine on load if the model's schema is older than the engine's current version.
