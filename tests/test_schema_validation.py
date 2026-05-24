"""
test_schema_validation.py — Validates every reference config against priority_model.schema.json.

This is the sprint 1 acceptance test. Engine tests come in sprint 2.

Run with:
    pytest tools/priority_model_tool/tests/
or:
    python tools/priority_model_tool/tests/test_schema_validation.py
"""

import json
import sys
from pathlib import Path

# Ensure jsonschema is available
try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("Installing jsonschema...")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "jsonschema", "--quiet"], check=True)
    from jsonschema import Draft202012Validator


HERE = Path(__file__).parent
TOOL_ROOT = HERE.parent
SCHEMA_PATH = TOOL_ROOT / "schema" / "priority_model.schema.json"
CONFIGS_DIR = TOOL_ROOT / "schema" / "reference_configs"

REFERENCE_CONFIGS = ["wyoming.json", "mndot.json", "aldot.json", "louisiana.json"]


def load_schema():
    return json.loads(SCHEMA_PATH.read_text())


def load_config(name):
    return json.loads((CONFIGS_DIR / name).read_text())


def validate_config(schema, config, name):
    """Run JSON Schema validation; return list of error strings (empty = pass)."""
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(config), key=lambda e: e.path)
    return [f"  {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message}" for e in errors]


def test_schema_is_valid_jsonschema():
    """The schema itself must be a valid JSON Schema document."""
    schema = load_schema()
    Draft202012Validator.check_schema(schema)


def test_all_reference_configs_validate():
    """All four reference configs must validate against the schema."""
    schema = load_schema()
    failures = {}
    for name in REFERENCE_CONFIGS:
        config = load_config(name)
        errs = validate_config(schema, config, name)
        if errs:
            failures[name] = errs
    assert not failures, "Validation failures:\n" + "\n".join(
        f"\n{name}:\n" + "\n".join(errs) for name, errs in failures.items()
    )


def test_each_config_has_required_metadata():
    """Sanity: every config has agency, source citation, and at least one decision logged."""
    for name in REFERENCE_CONFIGS:
        cfg = load_config(name)
        meta = cfg["metadata"]
        assert meta.get("agency"), f"{name}: missing metadata.agency"
        assert meta.get("source_citation"), f"{name}: missing metadata.source_citation"
        assert meta.get("decisions_log"), f"{name}: missing decisions_log entries"


def test_weighting_model_consistency():
    """If weighting_model = formula, global_formula must be present.
    If weighting_model = multiplicative, every criterion must have a weight.
    If weighting_model = additive_100pt, every criterion must have max_points.
    """
    for name in REFERENCE_CONFIGS:
        cfg = load_config(name)
        wm = cfg["weighting_model"]
        if wm == "formula":
            assert cfg.get("global_formula"), f"{name}: formula weighting requires global_formula"
        elif wm == "multiplicative":
            for c in cfg["criteria"]:
                assert "weight" in c, f"{name}: criterion {c['id']} needs weight in multiplicative model"
        elif wm == "additive_100pt":
            for c in cfg["criteria"]:
                assert "max_points" in c, f"{name}: criterion {c['id']} needs max_points in additive_100pt model"


def test_acrp_categories_used():
    """Round-trip check: every config should map at least one criterion to the ACRP taxonomy."""
    for name in REFERENCE_CONFIGS:
        cfg = load_config(name)
        mapped = sum(1 for c in cfg["criteria"] if c.get("acrp_category"))
        assert mapped > 0, f"{name}: no criteria mapped to acrp_category"


def main():
    """Run all tests as a script."""
    schema = load_schema()
    print(f"Schema loaded from: {SCHEMA_PATH}")
    Draft202012Validator.check_schema(schema)
    print("✓ Schema is a valid JSON Schema document")

    print(f"\nValidating {len(REFERENCE_CONFIGS)} reference configs...")
    all_pass = True
    for name in REFERENCE_CONFIGS:
        cfg = load_config(name)
        errs = validate_config(schema, cfg, name)
        if errs:
            all_pass = False
            print(f"\n✗ {name} FAILED:")
            for e in errs:
                print(e)
        else:
            print(f"  ✓ {name}")

    print("\nRunning sanity checks...")
    try:
        test_each_config_has_required_metadata()
        print("  ✓ Required metadata present in all configs")
    except AssertionError as e:
        all_pass = False
        print(f"  ✗ {e}")

    try:
        test_weighting_model_consistency()
        print("  ✓ Weighting model consistency holds in all configs")
    except AssertionError as e:
        all_pass = False
        print(f"  ✗ {e}")

    try:
        test_acrp_categories_used()
        print("  ✓ ACRP taxonomy mapping present in all configs")
    except AssertionError as e:
        all_pass = False
        print(f"  ✗ {e}")

    print("\n" + ("=" * 50))
    print("RESULT:", "ALL PASS" if all_pass else "FAILURES")
    print("=" * 50)
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
