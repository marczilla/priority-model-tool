"""
test_engine.py — Engine acceptance tests for sprint 2.

Confirms:
  • All 4 reference configs load and score every sample project without error.
  • Wyoming's top-ranked project is the safety/primary-runway/discretionary one.
  • MnDOT applies negative scores correctly.
  • Louisiana eligibility gate excludes non-NPIAS projects.
  • Audit trail accounts for every contribution.
  • Engine is deterministic (same inputs → same outputs).
  • safe_eval rejects unsafe expressions and accepts arithmetic.

Run:
    cd APH/tools/priority_model_tool
    python3 tests/test_engine.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).parent
TOOL_ROOT = HERE.parent
sys.path.insert(0, str(TOOL_ROOT))

from priority_engine import (
    PriorityModel, load_projects, safe_eval, rank_projects,
)

CONFIGS = TOOL_ROOT / "schema" / "reference_configs"
PROJECTS = TOOL_ROOT / "sample_projects.csv"


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test_all_configs_score_all_projects():
    """Every reference config produces a score for every sample project (eligible or not)."""
    projects = load_projects(PROJECTS)
    for cfg in ("wyoming.json", "mndot.json", "aldot.json", "louisiana.json", "idaho.json", "illinois.json", "virginia.json", "washington.json", "north_dakota.json", "arizona.json", "oregon.json", "tennessee.json", "california.json", "texas.json", "new_york.json", "colorado.json", "pennsylvania.json"):
        m = PriorityModel.from_file(CONFIGS / cfg)
        result = m.rank(projects)
        total = len(result.scored) + len(result.excluded)
        _assert(total == len(projects),
                f"{cfg}: expected {len(projects)} total scored+excluded, got {total}")


def test_wyoming_top_is_safety_primary_runway():
    """P001 (Jackson Hole RSA, safety, primary runway, discretionary) should rank #1 under Wyoming."""
    result = rank_projects(CONFIGS / "wyoming.json", PROJECTS)
    top = result.ranked()[0]
    _assert(top.project_id == "P001",
            f"Wyoming top-ranked should be P001, got {top.project_id}")
    _assert(top.final_score >= 100,
            f"Wyoming P001 should score ≥100, got {top.final_score}")


def test_mndot_applies_negative_scores():
    """MnDOT model should produce negative scores for non-compliant projects."""
    result = rank_projects(CONFIGS / "mndot.json", PROJECTS)
    has_negative = any(p.final_score < 0 for p in result.scored)
    _assert(has_negative,
            "MnDOT should produce at least one negative final_score (non-compliance)")


def test_louisiana_excludes_non_npias():
    """Louisiana eligibility gate should exclude P021 (non-NPIAS industrial)."""
    result = rank_projects(CONFIGS / "louisiana.json", PROJECTS)
    excluded_ids = {p.project_id for p in result.excluded}
    _assert("P021" in excluded_ids,
            f"Louisiana should exclude P021 (non-NPIAS); excluded = {excluded_ids}")


def test_audit_trail_complete():
    """Every project in every model must have an audit trail covering every criterion."""
    projects = load_projects(PROJECTS)
    for cfg in ("wyoming.json", "mndot.json", "aldot.json", "louisiana.json", "idaho.json", "illinois.json", "virginia.json", "washington.json", "north_dakota.json", "arizona.json", "oregon.json", "tennessee.json", "california.json", "texas.json", "new_york.json", "colorado.json", "pennsylvania.json"):
        m = PriorityModel.from_file(CONFIGS / cfg)
        result = m.rank(projects)
        for p in result.scored:
            _assert(len(p.contributions) == len(m.criteria),
                    f"{cfg}/{p.project_id}: contributions={len(p.contributions)} "
                    f"criteria={len(m.criteria)}")
            _assert(len(p.audit_trail) >= len(m.criteria),
                    f"{cfg}/{p.project_id}: audit_trail too short")


def test_deterministic():
    """Same config + projects → same output across runs."""
    projects = load_projects(PROJECTS)
    m = PriorityModel.from_file(CONFIGS / "wyoming.json")
    r1 = [p.final_score for p in m.rank(projects).ranked()]
    r2 = [p.final_score for p in m.rank(projects).ranked()]
    _assert(r1 == r2, "Engine is non-deterministic")


def test_score_contributions_sum_to_base():
    """For non-formula models, sum of weighted contributions should equal base_score."""
    projects = load_projects(PROJECTS)
    for cfg in ("wyoming.json", "mndot.json", "aldot.json", "louisiana.json", "idaho.json", "illinois.json", "virginia.json", "washington.json", "north_dakota.json", "arizona.json", "oregon.json", "tennessee.json", "california.json", "texas.json", "new_york.json", "colorado.json", "pennsylvania.json"):
        m = PriorityModel.from_file(CONFIGS / cfg)
        if m.weighting_model == "formula":
            continue
        result = m.rank(projects)
        for p in result.scored:
            total = sum(c.weighted_score for c in p.contributions)
            _assert(abs(total - p.base_score) < 0.01,
                    f"{cfg}/{p.project_id}: contributions sum {total} != base_score {p.base_score}")


def test_safe_eval_arithmetic():
    """safe_eval handles standard arithmetic with named variables."""
    _assert(safe_eval("4*A + 2*C", {"A": 5, "C": 3}) == 26, "safe_eval basic mult+add")
    _assert(safe_eval("(a + b) / 2", {"a": 10, "b": 4}) == 7, "safe_eval parens+div")
    _assert(safe_eval("-x + 5", {"x": 2}) == 3, "safe_eval unary minus")
    _assert(safe_eval("2 ** 10", {}) == 1024, "safe_eval power")


def test_safe_eval_rejects_unsafe():
    """safe_eval rejects function calls, attribute access, etc."""
    rejected = ["__import__('os')", "x.attr", "f(1)", "x and y"]
    for expr in rejected:
        try:
            safe_eval(expr, {"x": 1, "y": 2})
            raise AssertionError(f"safe_eval accepted unsafe expression: {expr}")
        except (ValueError, SyntaxError):
            pass


def test_eligibility_gate_disabled_by_default():
    """Configs without eligibility_gate.enabled should pass all projects."""
    m = PriorityModel.from_file(CONFIGS / "wyoming.json")
    projects = load_projects(PROJECTS)
    result = m.rank(projects)
    _assert(len(result.excluded) == 0,
            f"Wyoming has no eligibility gate; expected 0 excluded, got {len(result.excluded)}")


# ─────────────────────────────────────────────────────────────────
def main():
    tests = [
        test_all_configs_score_all_projects,
        test_wyoming_top_is_safety_primary_runway,
        test_mndot_applies_negative_scores,
        test_louisiana_excludes_non_npias,
        test_audit_trail_complete,
        test_deterministic,
        test_score_contributions_sum_to_base,
        test_safe_eval_arithmetic,
        test_safe_eval_rejects_unsafe,
        test_eligibility_gate_disabled_by_default,
        test_sprint6_five_new_states_present,
        test_sprint6_illinois_formula_evaluates,
        test_sprint6_north_dakota_dual_layer,
    ]
    passed = 0
    failed = []
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {t.__name__}: {e}")
            failed.append(t.__name__)
        except Exception as e:
            print(f"  ✗ {t.__name__} (error): {type(e).__name__}: {e}")
            failed.append(t.__name__)
    print()
    print("=" * 60)
    print(f"RESULT: {passed}/{len(tests)} passed")
    if failed:
        print(f"FAILED: {', '.join(failed)}")
    print("=" * 60)
    sys.exit(0 if not failed else 1)





def test_sprint6_five_new_states_present():
    """Sprint 6: Verify the 5 new ACRP case-example state configs load and have expected weighting models."""
    projects = load_projects(PROJECTS)
    expected = {
        "idaho.json": "multiplicative",
        "illinois.json": "formula",
        "virginia.json": "additive_100pt",
        "washington.json": "additive_100pt",
        "north_dakota.json": "dual_objective_subjective",
    }
    for fname, wm in expected.items():
        m = PriorityModel.from_file(CONFIGS / fname)
        _assert(m.config["weighting_model"] == wm,
                f"{fname} expected weighting_model={wm}, got {m.config['weighting_model']}")
        result = m.rank(projects)
        _assert(len(result.scored) > 0, f"{fname} produced no scored projects")
        # Top project should be primary-runway safety project P001 (or P004 obstruction removal)
        top_id = result.scored[0].project_id
        _assert(top_id in ("P001", "P004", "P005", "P006", "P012"),
                f"{fname} top should be a safety/primary-runway project; got {top_id}")


def test_sprint6_illinois_formula_evaluates():
    """Sprint 6: Illinois formula weighting model evaluates without raising."""
    projects = load_projects(PROJECTS)
    m = PriorityModel.from_file(CONFIGS / "illinois.json")
    _assert(m.config.get("global_formula"), "Illinois must have global_formula")
    result = m.rank(projects)
    _assert(len(result.scored) == len(projects),
            f"Illinois formula scored {len(result.scored)}/{len(projects)} projects")
    # All scores should be positive (formula always produces > 0 for these inputs)
    for row in result.scored:
        _assert(row.final_score > 0,
                f"Illinois project {row.project_id} produced non-positive score {row.final_score}")


def test_sprint6_north_dakota_dual_layer():
    """Sprint 6: North Dakota dual_objective_subjective produces objective layer with rankings."""
    projects = load_projects(PROJECTS)
    m = PriorityModel.from_file(CONFIGS / "north_dakota.json")
    result = m.rank(projects)
    _assert(len(result.scored) == len(projects),
            f"ND scored {len(result.scored)}/{len(projects)}")
    # Verify revenue-producing project (P017 fuel facility) does NOT outrank safety projects in objective layer
    scores = {row.project_id: row.final_score for row in result.scored}
    _assert(scores.get("P001", 0) > scores.get("P017", 0),
            "ND objective layer: safety P001 must outrank revenue-producing P017")


if __name__ == "__main__":
    main()
