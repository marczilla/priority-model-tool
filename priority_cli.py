"""
priority_cli.py — Command-line runner for priority_engine.py
=============================================================

Mirrors the m9 aip_cli.py pattern. Loads a priority model and a project list,
produces ranked output as a CSV, terminal table, or full audit JSON.

Usage:
    python priority_cli.py --config schema/reference_configs/wyoming.json \\
                           --projects sample_projects.csv \\
                           --output ranked.csv

    python priority_cli.py --config <c> --projects <p> --format table
    python priority_cli.py --config <c> --projects <p> --format json --explain

© 2026 John Marcus Cocanougher. All rights reserved.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from priority_engine import PriorityModel, load_projects, RankedResult, ProjectScore


def _output_csv(result: RankedResult, out_path: Path):
    fieldnames = [
        "rank", "project_id", "project_label", "final_score", "base_score",
        "eligibility_passed", "set_aside", "adjustments", "audit_summary",
    ]
    rows = []
    for i, p in enumerate(result.ranked(), 1):
        rows.append({
            "rank": i,
            "project_id": p.project_id,
            "project_label": p.project_label,
            "final_score": round(p.final_score, 2),
            "base_score": round(p.base_score, 2),
            "eligibility_passed": p.eligibility_passed,
            "set_aside": p.set_aside_assignment or "",
            "adjustments": ";".join(f"{k}={v:+}" for k, v in p.adjustments_applied.items()),
            "audit_summary": " | ".join(
                f"{c.criterion_id}={c.weighted_score}"
                for c in p.contributions
            ),
        })
    for p in result.excluded:
        rows.append({
            "rank": "—",
            "project_id": p.project_id,
            "project_label": p.project_label,
            "final_score": "EXCLUDED",
            "base_score": "",
            "eligibility_passed": False,
            "set_aside": "",
            "adjustments": "",
            "audit_summary": "; ".join(p.eligibility_failures),
        })
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote ranked output: {out_path}")


def _output_json(result: RankedResult, out_path: Path, explain: bool = False):
    body = {
        "model_name": result.model_name,
        "model_state": result.model_state,
        "weighting_model": result.weighting_model,
        "scored_count": len(result.scored),
        "excluded_count": len(result.excluded),
        "ranked": [],
        "excluded": [],
    }
    for i, p in enumerate(result.ranked(), 1):
        d = {
            "rank": i,
            "project_id": p.project_id,
            "project_label": p.project_label,
            "final_score": p.final_score,
            "base_score": p.base_score,
            "set_aside": p.set_aside_assignment,
            "adjustments_applied": p.adjustments_applied,
            "contributions": [
                {
                    "criterion_id": c.criterion_id,
                    "criterion_label": c.criterion_label,
                    "bucket": c.bucket,
                    "raw_score": c.raw_score,
                    "weighted_score": c.weighted_score,
                    "matched": c.matched_subcategory_ids,
                    "explanation": c.explanation,
                }
                for c in p.contributions
            ],
        }
        if explain:
            d["audit_trail"] = p.audit_trail
        body["ranked"].append(d)
    for p in result.excluded:
        body["excluded"].append({
            "project_id": p.project_id,
            "project_label": p.project_label,
            "eligibility_failures": p.eligibility_failures,
        })
    out_path.write_text(json.dumps(body, indent=2))
    print(f"Wrote ranked output: {out_path}")


def _output_table(result: RankedResult, top_n: int = 25):
    print()
    print(f"═══ {result.model_name} ({result.model_state}) — {result.weighting_model} ═══")
    print(f"  Scored: {len(result.scored)}    Excluded by gate: {len(result.excluded)}")
    print()
    print(f"  {'Rank':>4}  {'Score':>7}  {'ID':<6}  {'Project':<55}  Set-aside")
    print(f"  {'─'*4}  {'─'*7}  {'─'*6}  {'─'*55}  {'─'*15}")
    ranked = result.ranked()
    for i, p in enumerate(ranked[:top_n], 1):
        sa = p.set_aside_assignment or ""
        label = p.project_label[:55]
        print(f"  {i:>4}  {p.final_score:>7.1f}  {p.project_id:<6}  {label:<55}  {sa}")
    if result.excluded:
        print()
        print(f"  Excluded ({len(result.excluded)}):")
        for p in result.excluded:
            print(f"    {p.project_id}  {p.project_label[:55]}")
            for f in p.eligibility_failures:
                print(f"      ✗ {f}")
    print()


def main(argv: list[str] | None = None):
    ap = argparse.ArgumentParser(
        description="Score and rank airport projects using a state priority model."
    )
    ap.add_argument("--config", "-c", required=True, type=Path,
                    help="Path to priority_model.json config")
    ap.add_argument("--projects", "-p", required=True, type=Path,
                    help="Path to project list (CSV or JSON)")
    ap.add_argument("--output", "-o", type=Path, default=None,
                    help="Output path (.csv or .json). If omitted, prints table to stdout.")
    ap.add_argument("--format", "-f", choices=["table", "csv", "json"], default=None,
                    help="Output format. Defaults to inferred from --output extension or 'table'.")
    ap.add_argument("--explain", action="store_true",
                    help="Include full audit trail in JSON output.")
    ap.add_argument("--top", type=int, default=25,
                    help="Top-N rows for table output (default 25).")
    args = ap.parse_args(argv)

    model = PriorityModel.from_file(args.config)
    projects = load_projects(args.projects)
    result = model.rank(projects)

    fmt = args.format
    if fmt is None:
        if args.output and args.output.suffix.lower() == ".csv":
            fmt = "csv"
        elif args.output and args.output.suffix.lower() == ".json":
            fmt = "json"
        else:
            fmt = "table"

    if fmt == "table":
        _output_table(result, top_n=args.top)
    elif fmt == "csv":
        out = args.output or Path("ranked.csv")
        _output_csv(result, out)
    elif fmt == "json":
        out = args.output or Path("ranked.json")
        _output_json(result, out, explain=args.explain)


if __name__ == "__main__":
    main()
