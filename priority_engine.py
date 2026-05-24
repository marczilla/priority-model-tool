"""
priority_engine.py — APH State Funding Priority Model Scoring Engine
=====================================================================

Pure-Python scoring engine for state aviation funding priority models.
No APH dependencies. Importable as a library, runnable via priority_cli.py.

Architectural sibling of tools/aip_eligibility_tool/aip_engine.py — that one
implements federal NPRS scoring; this one implements configurable state-level
prioritization grounded in ACRP Synthesis 123.

Reference: ACRP Synthesis 123 — State Aviation Funding: Project Prioritization
and Selection Processes (2023). Reference state encodings: Wyoming PRM 2021,
MnDOT, ALDOT, Louisiana DOTD.

© 2026 John Marcus Cocanougher. All rights reserved.
"""

from __future__ import annotations

import ast
import csv
import json
import operator
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional, Union

# ═══════════════════════════════════════════════════════════════════
#  TYPES
# ═══════════════════════════════════════════════════════════════════

JSON = dict[str, Any]
Project = dict[str, Any]


@dataclass
class CriterionContribution:
    """How one criterion contributed to a project's total score."""
    criterion_id: str
    criterion_label: str
    bucket: Optional[str]
    matched_subcategory_ids: list[str]
    raw_score: float
    weighted_score: float
    explanation: str


@dataclass
class ProjectScore:
    """Full scoring output for one project, including audit trail."""
    project_id: str
    project_label: str
    eligibility_passed: bool
    eligibility_failures: list[str]
    base_score: float
    contributions: list[CriterionContribution]
    adjustments_applied: dict[str, float]
    set_aside_assignment: Optional[str]
    final_score: float
    audit_trail: list[str]

    def to_dict(self) -> JSON:
        d = asdict(self)
        return d


@dataclass
class RankedResult:
    """Output of a model run against a project list."""
    model_name: str
    model_state: str
    weighting_model: str
    scored: list[ProjectScore]
    excluded: list[ProjectScore]  # failed eligibility gate

    def ranked(self, descending: bool = True) -> list[ProjectScore]:
        return sorted(self.scored, key=lambda p: p.final_score, reverse=descending)


# ═══════════════════════════════════════════════════════════════════
#  SAFE EXPRESSION EVALUATOR (for formula scoring)
# ═══════════════════════════════════════════════════════════════════

_SAFE_OPS: dict[type, Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def safe_eval(expr: str, variables: dict[str, float]) -> float:
    """Evaluate an arithmetic expression with named variables. Never uses raw eval()."""
    tree = ast.parse(expr, mode="eval")

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in variables:
                raise ValueError(f"Unknown variable in formula: {node.id}")
            return variables[node.id]
        if isinstance(node, ast.BinOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"Operator not allowed: {type(node.op).__name__}")
            return op(_eval(node.left), _eval(node.right))
        if isinstance(node, ast.UnaryOp):
            op = _SAFE_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"Unary op not allowed: {type(node.op).__name__}")
            return op(_eval(node.operand))
        raise ValueError(f"Disallowed expression node: {type(node).__name__}")

    return float(_eval(tree))


# ═══════════════════════════════════════════════════════════════════
#  FIELD-MATCH EVALUATION
# ═══════════════════════════════════════════════════════════════════

_COMPARATORS = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "in": lambda a, b: a in b,
    "not_in": lambda a, b: a not in b,
    "gte": lambda a, b: float(a) >= float(b),
    "lte": lambda a, b: float(a) <= float(b),
    "gt": lambda a, b: float(a) > float(b),
    "lt": lambda a, b: float(a) < float(b),
    "matches": lambda a, b: __import__("re").search(b, str(a)) is not None,
}


def _coerce(value: Any) -> Any:
    """Coerce CSV-string values to bool/number where appropriate."""
    if not isinstance(value, str):
        return value
    s = value.strip()
    if s.lower() in ("true", "yes"):
        return True
    if s.lower() in ("false", "no"):
        return False
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def evaluate_field_match(field_match: JSON, project: Project) -> bool:
    fld = field_match["field"]
    op = field_match["operator"]
    expected = field_match["value"]
    actual = _coerce(project.get(fld))
    cmp = _COMPARATORS.get(op)
    if cmp is None:
        raise ValueError(f"Unknown operator: {op}")
    try:
        return cmp(actual, expected)
    except (TypeError, ValueError):
        return False


# ═══════════════════════════════════════════════════════════════════
#  ENGINE
# ═══════════════════════════════════════════════════════════════════

class PriorityModel:
    """A loaded priority model, ready to score projects."""

    SCHEMA_VERSION = "1.0.0"

    def __init__(self, config: JSON):
        if config.get("schema_version") != self.SCHEMA_VERSION:
            raise ValueError(
                f"Schema version mismatch: expected {self.SCHEMA_VERSION}, "
                f"got {config.get('schema_version')}"
            )
        self.config = config
        self.metadata = config["metadata"]
        self.weighting_model = config["weighting_model"]
        self.criteria = config["criteria"]
        self.eligibility_gate = config.get("eligibility_gate", {"enabled": False})
        self.set_asides = config.get("set_asides", [])
        self.adjustments = config.get("adjustments", {})
        self.governance = config["governance"]

    @classmethod
    def from_file(cls, path: Union[str, Path]) -> "PriorityModel":
        return cls(json.loads(Path(path).read_text()))

    # ── Eligibility gate ─────────────────────────────────────────────
    def check_eligibility(self, project: Project) -> tuple[bool, list[str]]:
        if not self.eligibility_gate.get("enabled"):
            return True, []
        failures = []
        for f in self.eligibility_gate.get("filters", []):
            fc = f.get("field_check")
            if fc and not evaluate_field_match(fc, project):
                if f.get("on_fail", "exclude") == "exclude":
                    failures.append(f"{f['label']}: {f['rule']}")
        return (len(failures) == 0), failures

    # ── Subcategory matching ─────────────────────────────────────────
    def _subcategory_matches(self, criterion: JSON, sub: JSON, project: Project) -> bool:
        """Does this subcategory match this project under this criterion?"""
        # 1. Explicit field_match on the subcategory wins
        if "field_match" in sub:
            return evaluate_field_match(sub["field_match"], project)

        # 2. Otherwise look up the criterion's project_field (or fall back to criterion id)
        field_name = criterion.get("project_field") or criterion["id"]
        proj_value = project.get(field_name)
        if proj_value is None or proj_value == "":
            return False
        return str(proj_value).strip() == sub["id"]

    # ── Per-criterion scoring ────────────────────────────────────────
    def _score_criterion(
        self, criterion: JSON, project: Project
    ) -> CriterionContribution:
        cid = criterion["id"]
        clabel = criterion["label"]
        bucket = criterion.get("bucket")
        style = criterion["scoring_style"]
        max_points = criterion.get("max_points")
        weight = criterion.get("weight", 1)

        matched_ids: list[str] = []
        raw_score: float = 0.0
        explanation: str

        subs = criterion.get("subcategories", [])

        if style == "formula":
            expr = criterion.get("formula", "0")
            # Variables: each subcategory id maps to its score if matched, else 0
            vars_map = {
                s["id"]: float(s["score"])
                for s in subs
                if self._subcategory_matches(criterion, s, project)
            }
            try:
                raw_score = safe_eval(expr, vars_map)
                explanation = f"formula '{expr}' = {raw_score}"
            except Exception as e:
                raw_score = 0
                explanation = f"formula evaluation error: {e}"

        elif style == "select_one":
            # If multiple subcategories match (e.g., gte tiers), take highest score
            candidates = [s for s in subs if self._subcategory_matches(criterion, s, project)]
            if candidates:
                best = max(candidates, key=lambda s: s["score"])
                matched_ids = [best["id"]]
                raw_score = float(best["score"])
                explanation = f"matched {best['id']} (score {best['score']})"
            else:
                explanation = "no subcategory matched"

        elif style == "tiered_score":
            # Mutually exclusive — first match wins
            for sub in subs:
                if self._subcategory_matches(criterion, sub, project):
                    matched_ids = [sub["id"]]
                    raw_score = float(sub["score"])
                    explanation = f"matched tier {sub['id']} (score {sub['score']})"
                    break
            else:
                explanation = "no tier matched"

        elif style == "select_many":
            # Sum all matching subcategory scores
            matched = [s for s in subs if self._subcategory_matches(criterion, s, project)]
            matched_ids = [s["id"] for s in matched]
            raw_score = sum(float(s["score"]) for s in matched)
            explanation = (
                f"summed {len(matched)} matches: " + ", ".join(matched_ids)
                if matched else "no subcategories matched"
            )

        elif style == "accumulating":
            # Like select_many but capped at max_points
            matched = [s for s in subs if self._subcategory_matches(criterion, s, project)]
            matched_ids = [s["id"] for s in matched]
            raw_score = sum(float(s["score"]) for s in matched)
            if max_points is not None and raw_score > max_points:
                raw_score = max_points
            explanation = (
                f"accumulated {len(matched)} matches (capped at {max_points}): "
                + ", ".join(matched_ids)
                if matched else "no subcategories matched"
            )

        elif style == "flat_lookup":
            # One subcategory match — uses the criterion's project_field for direct lookup
            for sub in subs:
                if self._subcategory_matches(criterion, sub, project):
                    matched_ids = [sub["id"]]
                    raw_score = float(sub["score"])
                    explanation = f"lookup hit {sub['id']} (score {sub['score']})"
                    break
            else:
                explanation = f"no lookup match for project_type"

        else:
            raise ValueError(f"Unknown scoring_style: {style}")

        # Apply weighting based on the model's overall weighting_model
        if self.weighting_model == "multiplicative":
            weighted = raw_score * float(weight)
        elif self.weighting_model == "additive_100pt":
            weighted = raw_score
            if max_points is not None:
                # Cap contribution at max_points (allows negatives below 0)
                weighted = max(weighted, -abs(max_points)) if weighted < 0 else min(weighted, max_points)
        elif self.weighting_model == "formula":
            # Per-criterion weighting handled inside global formula at caller level
            weighted = raw_score
        elif self.weighting_model == "dual_objective_subjective":
            weighted = raw_score
        else:
            weighted = raw_score

        return CriterionContribution(
            criterion_id=cid,
            criterion_label=clabel,
            bucket=bucket,
            matched_subcategory_ids=matched_ids,
            raw_score=raw_score,
            weighted_score=weighted,
            explanation=explanation,
        )

    # ── Apply post-scoring adjustments ───────────────────────────────
    def _apply_adjustments(
        self, base: float, project: Project
    ) -> tuple[float, dict[str, float], list[str]]:
        adj_applied: dict[str, float] = {}
        notes: list[str] = []
        score = base

        rev = self.adjustments.get("revenue_producing_bump", {}) or {}
        if rev.get("enabled"):
            applies_to = rev.get("applies_to_project_types", [])
            ptype = project.get("project_type")
            if any(tag in str(ptype) for tag in applies_to):
                bonus = float(rev.get("bonus_amount", 0))
                score += bonus
                adj_applied["revenue_producing_bump"] = bonus
                notes.append(f"revenue_producing_bump +{bonus}")

        lfp = self.adjustments.get("low_federal_priority_bonus", {}) or {}
        if lfp.get("enabled"):
            nprs = _coerce(project.get("nprs_score"))
            if isinstance(nprs, (int, float)):
                if nprs <= float(lfp.get("nprs_threshold", 0)):
                    bonus = float(lfp.get("bonus_amount", 0))
                    score += bonus
                    adj_applied["low_federal_priority_bonus"] = bonus
                    notes.append(f"low_federal_priority_bonus +{bonus}")

        return score, adj_applied, notes

    # ── Set-aside assignment ─────────────────────────────────────────
    def _assign_set_aside(self, project: Project) -> Optional[str]:
        for sa in self.set_asides:
            ff = sa.get("field_filter")
            if ff and evaluate_field_match(ff, project):
                return sa["id"]
        return None

    # ── Score one project ────────────────────────────────────────────
    def score_project(self, project: Project) -> ProjectScore:
        project_id = str(project.get("project_id", "?"))
        project_label = project.get("description") or project.get("airport_name") or project_id
        audit: list[str] = []

        # 1. Eligibility gate
        passed, failures = self.check_eligibility(project)
        if not passed:
            audit.append(f"FAILED eligibility gate: {'; '.join(failures)}")

        # 2. Per-criterion scoring
        contributions: list[CriterionContribution] = []
        for crit in self.criteria:
            contrib = self._score_criterion(crit, project)
            contributions.append(contrib)
            audit.append(
                f"  {contrib.criterion_id}: raw={contrib.raw_score} "
                f"weighted={contrib.weighted_score} ({contrib.explanation})"
            )

        # 3. Combine into base_score
        if self.weighting_model == "formula":
            expr = self.config.get("global_formula", "0")
            vars_map = {c.criterion_id: c.raw_score for c in contributions}
            try:
                base_score = safe_eval(expr, vars_map)
                audit.append(f"global formula '{expr}' = {base_score}")
            except Exception as e:
                base_score = 0
                audit.append(f"global formula error: {e}")
        else:
            base_score = sum(c.weighted_score for c in contributions)

        # 4. Apply adjustments
        final_score, adj_applied, adj_notes = self._apply_adjustments(base_score, project)
        audit.extend(adj_notes)

        # 5. Set-aside
        sa = self._assign_set_aside(project) if passed else None
        if sa:
            audit.append(f"set-aside assignment: {sa}")

        return ProjectScore(
            project_id=project_id,
            project_label=str(project_label),
            eligibility_passed=passed,
            eligibility_failures=failures,
            base_score=base_score,
            contributions=contributions,
            adjustments_applied=adj_applied,
            set_aside_assignment=sa,
            final_score=final_score if passed else 0,
            audit_trail=audit,
        )

    # ── Score a batch / produce ranking ──────────────────────────────
    def rank(self, projects: list[Project]) -> RankedResult:
        scored: list[ProjectScore] = []
        excluded: list[ProjectScore] = []
        for p in projects:
            s = self.score_project(p)
            (excluded if not s.eligibility_passed else scored).append(s)
        return RankedResult(
            model_name=self.metadata["name"],
            model_state=self.metadata["state"],
            weighting_model=self.weighting_model,
            scored=scored,
            excluded=excluded,
        )


# ═══════════════════════════════════════════════════════════════════
#  CSV / JSON LOADERS
# ═══════════════════════════════════════════════════════════════════

def load_projects(path: Union[str, Path]) -> list[Project]:
    """Load projects from CSV or JSON."""
    p = Path(path)
    if p.suffix.lower() == ".json":
        data = json.loads(p.read_text())
        return data if isinstance(data, list) else data.get("projects", [])
    rows: list[Project] = []
    with p.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append({k: _coerce(v) for k, v in r.items()})
    return rows


# ═══════════════════════════════════════════════════════════════════
#  CONVENIENCE
# ═══════════════════════════════════════════════════════════════════

def rank_projects(config_path: Union[str, Path], projects_path: Union[str, Path]) -> RankedResult:
    """One-call helper: load model + projects, return ranked result."""
    model = PriorityModel.from_file(config_path)
    projects = load_projects(projects_path)
    return model.rank(projects)


__all__ = [
    "PriorityModel",
    "ProjectScore",
    "RankedResult",
    "CriterionContribution",
    "rank_projects",
    "load_projects",
    "safe_eval",
]
