"""
build_deploy.py — Build a deployable static bundle of the priority tool.

Outputs a self-contained folder at .deploy/ that can be:
  • Pushed to GitHub Pages
  • Connected to Cloudflare Pages (build output dir = .deploy/)
  • Served by any static-file host (Netlify, Vercel, S3, etc.)

The bundle contains:
  • index.html                (renamed from priority_tool.html)
  • priority_engine.js        (the scoring engine)
  • README.md                 (small landing description)
  • acrp_taxonomy.js          (if present — sprint 4)

Usage:
    cd APH/tools/priority_model_tool
    python3 build_embedded_data.py    # ensure data is fresh
    python3 build_deploy.py           # build .deploy/ bundle
"""

from __future__ import annotations

import shutil
from pathlib import Path

HERE = Path(__file__).parent
DEPLOY = HERE / ".deploy"


def build():
    DEPLOY.mkdir(exist_ok=True)
    # priority_tool.html → index.html
    src_html = HERE / "priority_tool.html"
    if not src_html.exists():
        raise SystemExit("priority_tool.html not found; nothing to deploy.")
    (DEPLOY / "index.html").write_text(src_html.read_text(encoding="utf-8"))

    # Engine + taxonomy + wizard + generators
    for filename in ("priority_engine.js", "acrp_taxonomy.js", "wizard.js", "generators.js"):
        src = HERE / filename
        if src.exists():
            (DEPLOY / filename).write_text(src.read_text(encoding="utf-8"))

    # Generate a small landing README for the deploy bundle
    readme = """# State Funding Priority Model Builder — APH m49

Live demo of the State Funding Priority Model Builder, an APH tool that helps
state aviation agencies and consultants design, modify, and govern their
funding-prioritization models.

Grounded in ACRP Synthesis 123 — *State Aviation Funding: Project Prioritization
and Selection Processes* (2023). Reference state encodings include Wyoming PRM
2021, MnDOT, ALDOT, and Louisiana DOTD.

Source code in [the parent APH repository](../).

© 2026 John Marcus Cocanougher. All rights reserved.
"""
    (DEPLOY / "README.md").write_text(readme)

    # CNAME placeholder (user can replace with custom domain)
    cname = DEPLOY / "CNAME.example"
    cname.write_text("priority-model.example.com\n")

    # _headers for Cloudflare Pages: cache rules + security headers
    headers = """/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.js
  Cache-Control: public, max-age=3600

/*.html
  Cache-Control: public, max-age=300
"""
    (DEPLOY / "_headers").write_text(headers)

    # robots.txt — discourage indexing of the demo
    (DEPLOY / "robots.txt").write_text("User-agent: *\nAllow: /\n")

    print(f"Built deploy bundle: {DEPLOY}/")
    for p in sorted(DEPLOY.iterdir()):
        size = p.stat().st_size if p.is_file() else 0
        print(f"  {size:>8d}  {p.name}")


if __name__ == "__main__":
    build()
