/*
 * smoketest_configurator.js — Headless smoke test for priority_tool.html
 *
 * Verifies (without a browser):
 *   1. The configurator HTML loads its embedded data.
 *   2. priority_engine.js runs all 4 reference configs against the embedded
 *      sample_projects without throwing.
 *   3. Wyoming top-ranked is P001 (Jackson Hole RSA), matching the Python
 *      engine's known-answer.
 *   4. JSON export round-trips through import without loss.
 *
 * Uses jsdom-light hand-rolled extraction (no npm install needed): we just
 * regex-extract the embedded data + load priority_engine.js.
 *
 * Run:
 *   cd APH/tools/priority_model_tool
 *   node tests/smoketest_configurator.js
 */

const fs = require("fs");
const path = require("path");

const TOOL_DIR = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(TOOL_DIR, "priority_tool.html"), "utf8");

// ── Extract the embedded data from the HTML ─────────────────────────
function extractEmbedded() {
  const cfgMatch = HTML.match(/window\.PM_REFERENCE_CONFIGS\s*=\s*(\{[\s\S]*?\});\s*\n/);
  const samMatch = HTML.match(/window\.PM_SAMPLE_PROJECTS\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!cfgMatch || !samMatch) {
    throw new Error("Could not find embedded data in priority_tool.html (run build_embedded_data.py).");
  }
  return {
    configs: JSON.parse(cfgMatch[1]),
    projects: JSON.parse(samMatch[1]),
  };
}

// ── Set up window-like globals so priority_engine.js loads cleanly ──
global.self = global;
global.window = global;
const Engine = require(path.join(TOOL_DIR, "priority_engine.js"));

// ── Tests ───────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

test("embedded data extractable from HTML", () => {
  const { configs, projects } = extractEmbedded();
  assert(Object.keys(configs).length === 24, "expected 24 reference configs");
  assert(projects.length === 25, "expected 25 sample projects");
  assert(configs.wyoming && configs.mndot && configs.aldot && configs.louisiana,
         "all four reference configs should be present");
});

test("all 24 configs score all 25 projects without error", () => {
  const { configs, projects } = extractEmbedded();
  for (const [name, cfg] of Object.entries(configs)) {
    const m = new Engine.PriorityModel(cfg);
    const r = m.rank(projects);
    const total = r.scored.length + r.excluded.length;
    assert(total === 25, `${name}: expected 25 total, got ${total}`);
  }
});

test("Wyoming top-ranked under embedded data is P001 (matches Python)", () => {
  const { configs, projects } = extractEmbedded();
  const m = new Engine.PriorityModel(configs.wyoming);
  const r = m.rank(projects);
  const top = r.ranked()[0];
  assert(top.project_id === "P001", `expected P001, got ${top.project_id}`);
  assert(top.final_score >= 100, `expected score ≥100, got ${top.final_score}`);
});

test("Louisiana excludes P021 via eligibility gate", () => {
  const { configs, projects } = extractEmbedded();
  const m = new Engine.PriorityModel(configs.louisiana);
  const r = m.rank(projects);
  assert(r.excluded.some(p => p.project_id === "P021"),
         "Louisiana should exclude P021 (non-NPIAS)");
});

test("MnDOT produces negative scores for non-compliance", () => {
  const { configs, projects } = extractEmbedded();
  const m = new Engine.PriorityModel(configs.mndot);
  const r = m.rank(projects);
  assert(r.scored.some(p => p.final_score < 0),
         "MnDOT should produce at least one negative score");
});

test("Export → Import round-trip preserves config", () => {
  const { configs } = extractEmbedded();
  const original = configs.wyoming;
  const exported = JSON.stringify(original, null, 2);
  const reimported = JSON.parse(exported);
  // Run engine on both — outputs must be identical
  const sample = extractEmbedded().projects;
  const r1 = new Engine.PriorityModel(original).rank(sample).ranked();
  const r2 = new Engine.PriorityModel(reimported).rank(sample).ranked();
  assert(r1.length === r2.length, "ranking length differs");
  for (let i = 0; i < r1.length; i++) {
    assert(r1[i].project_id === r2[i].project_id, `rank ${i} project differs`);
    assert(r1[i].final_score === r2[i].final_score, `rank ${i} score differs`);
  }
});

test("Engine equivalence: Python ranked outputs match (Wyoming top 5)", () => {
  // Known answer from Python engine (priority_engine.py + sample_projects.csv)
  const expected = [
    ["P001", 103.0],
    ["P004", 100.0],
    ["P012", 97.0],
    ["P006", 96.0],
    ["P024", 90.0],
  ];
  const { configs, projects } = extractEmbedded();
  const m = new Engine.PriorityModel(configs.wyoming);
  const r = m.rank(projects).ranked();
  for (let i = 0; i < 5; i++) {
    assert(r[i].project_id === expected[i][0],
           `rank ${i + 1}: expected ${expected[i][0]}, got ${r[i].project_id}`);
    assert(Math.abs(r[i].final_score - expected[i][1]) < 0.01,
           `rank ${i + 1}: expected score ${expected[i][1]}, got ${r[i].final_score}`);
  }
});

// ── Runner ──────────────────────────────────────────────────────────
let passed = 0;
const failed = [];
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${t.name}: ${e.message}`);
    failed.push(t.name);
  }
}
console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${passed}/${tests.length} passed`);
if (failed.length) console.log("FAILED: " + failed.join(", "));
console.log("=".repeat(60));
process.exit(failed.length ? 1 : 0);
