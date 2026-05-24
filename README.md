# State Funding Priority Model Builder

A web-based tool that helps **state aviation agencies and their consultants** design, modify, and govern their funding-prioritization models. Grounded in **ACRP Synthesis 123** — *State Aviation Funding: Project Prioritization and Selection Processes* (2023).

[![Deploy](https://github.com/marczilla/priority-model-tool/actions/workflows/deploy.yml/badge.svg)](https://github.com/marczilla/priority-model-tool/actions/workflows/deploy.yml)

**Live demo:** https://marczilla.github.io/priority-model-tool/

This is **Module m49** of the [Airport Planning Hub (APH)](https://github.com/marczilla/airport-planning-hub) platform, published here as a standalone deployment. The source files are mirrored from `tools/priority_model_tool/` inside APH.

© 2026 John Marcus Cocanougher. All rights reserved.

---

## What it does

State aviation agencies allocate state funds (and match federal funds) using priority models with weighted criteria. ACRP Synthesis 123 surveyed 33 states and found no two use the same model — but the design space is bounded. This tool helps you:

- **Build a new model from scratch** with a 16-step wizard, grounded in ACRP best practices and four reference state models (Wyoming PRM 2021, MnDOT, ALDOT, Louisiana DOTD).
- **Modify an existing model** by uploading it (Excel, Word, JSON, or pasted text) and getting an automated gap analysis against the ACRP 14-criterion taxonomy.
- **Score and rank projects** through the model with a live preview that updates as you tune weights.
- **Generate adoption-ready artifacts:** a JSON config, a 4-sheet Excel workbook, and a policy manual in Wyoming-PRM or Louisiana-admin-code style.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  priority_tool.html  (single-page configurator)             │
│  ├── priority_engine.js  (browser scoring engine)           │
│  ├── wizard.js           (16-step Build New + 4-step Modify)│
│  ├── acrp_taxonomy.js    (ACRP 14-criterion catalog)        │
│  └── generators.js       (xlsx + docx outputs)              │
├─────────────────────────────────────────────────────────────┤
│  schema/                                                    │
│  ├── priority_model.schema.json   (canonical JSON Schema)   │
│  ├── schema.md                    (human-readable docs)     │
│  └── reference_configs/           (4 reference states)      │
├─────────────────────────────────────────────────────────────┤
│  priority_engine.py + priority_cli.py  (Python parity)      │
│  tests/  (5 suites, 34 tests covering schema, engine,       │
│          configurator, wizard, generators)                  │
└─────────────────────────────────────────────────────────────┘
```

The whole thing runs **client-side** — no backend, no database. Browse the live demo or clone and open `priority_tool.html` locally.

---

## Quick start (local)

```bash
git clone https://github.com/marczilla/priority-model-tool.git
cd priority-model-tool
python3 build_embedded_data.py   # syncs reference configs into the HTML
open priority_tool.html          # opens in default browser
```

Optional: run all tests before opening:

```bash
python3 tests/test_schema_validation.py
python3 tests/test_engine.py
node tests/smoketest_configurator.js
node tests/smoketest_wizard.js
node tests/smoketest_generators.js
```

---

## CLI

```bash
python3 priority_cli.py \
  --config schema/reference_configs/wyoming.json \
  --projects sample_projects.csv \
  --format table
```

Or output a ranked CSV:

```bash
python3 priority_cli.py -c schema/reference_configs/wyoming.json \
                       -p sample_projects.csv -o ranked.csv
```

---

## Deployment

Already wired for GitHub Pages via `.github/workflows/deploy.yml`. Every push to `main` runs all 34 tests, builds the static bundle in `.deploy/`, and publishes to Pages automatically.

Alternative hosts: any static-file CDN (Cloudflare Pages, Netlify, S3). Build command: `python3 build_embedded_data.py && python3 build_deploy.py` — output directory: `.deploy/`.

---

## Source documents

- **ACRP Synthesis 123** — *State Aviation Funding: Project Prioritization and Selection Processes* (2023, 251 pp.)
- **Wyoming Aeronautics Commission** — Priority Rating Model for Project Evaluation (2021)
- **MnDOT Aeronautics** — State Funding Prioritization Model Guide
- **ALDOT** — Airport Project Priority Rating System
- **Louisiana DOTD** — Aviation Program Policy Manual (July 2024)

---

## Disclaimer

This tool is built using publicly available data sources including FAA NASR, TAF, BTS T-100/DB1B, BEA, BLS, ACI-NA, and published FAA Advisory Circulars and ACRP research reports. It is intended for **planning-level analysis only** and does not constitute engineering design or official FAA determination. The four reference configs encode published forms of state models as of the dates indicated; states adopting these as templates should review against their statute, commission, and current guidance.

---

## License

Copyright © 2026 John Marcus Cocanougher. All rights reserved.
