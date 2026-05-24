/*
 * smoketest_wizard.js — Headless smoke test for the wizard logic.
 *
 * The wizard's UI runs in the browser, but its core data transformations
 * (parsing uploaded models, computing gap analyses, materializing draft
 * configs) are pure-data and testable in node.
 *
 * This test extracts the wizard's helper functions by re-evaluating wizard.js
 * inside a controlled context, then exercises:
 *   1. Free-text parser handles common phrasings
 *   2. JSON extract round-trips through the gap-analysis routine
 *   3. ACRP category guess produces sensible matches
 *   4. Full build flow produces a config that validates against the schema
 *      and runs through priority_engine.js without error.
 */

const fs = require("fs");
const path = require("path");

const TOOL_DIR = path.resolve(__dirname, "..");

// ── Set up a window-like context shared between engine + taxonomy + wizard ──
global.self = global;
global.window = global;
global.alert = () => {};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => [],
};

// Load engine + taxonomy. The UMD wrappers see module.exports in node,
// so require() returns the exported API directly.
const engine = require(path.join(TOOL_DIR, "priority_engine.js"));
require(path.join(TOOL_DIR, "acrp_taxonomy.js"));

// Load embedded sample projects from priority_tool.html
const html = fs.readFileSync(path.join(TOOL_DIR, "priority_tool.html"), "utf8");
const samMatch = html.match(/window\.PM_SAMPLE_PROJECTS\s*=\s*(\[[\s\S]*?\]);\s*\n/);
global.PM_SAMPLE_PROJECTS = samMatch ? JSON.parse(samMatch[1]) : [];

// To exercise wizard internals we re-eval wizard.js after stubbing out
// document/DOM access. Then we expose helpers by replacing the IIFE wrapper.
const wizardSrc = fs.readFileSync(path.join(TOOL_DIR, "wizard.js"), "utf8");

// Pull out the inner functions we want to test by exposing them on a temp object
// (a minimal extraction approach: rewrite the IIFE end so we capture refs).
const exposed = {};
const patched = wizardSrc.replace(
  "})();",
  "global._wfTest = { parseFreeText, parseJsonExtract, computeGapAnalysis, guessAcrpCategory, BUILD_STEPS, MODIFY_STEPS };\n})();"
);
eval(patched);
const T = global._wfTest;

const tests = [];
function test(n, fn) { tests.push({ n, fn }); }
function assert(c, m) { if (!c) throw new Error(m); }

test("BUILD has 16 steps, MODIFY has 4 steps", () => {
  assert(T.BUILD_STEPS.length === 16, "expected 16 build steps");
  assert(T.MODIFY_STEPS.length === 4, "expected 4 modify steps");
});

test("parseFreeText extracts simple weight phrasings", () => {
  const out = T.parseFreeText(
    "Safety (40%)\nSystem Plan: 20 pts\nFederal Match - weight 5\nNot a criterion line"
  );
  assert(out.criteria.length >= 3, `expected >= 3 criteria, got ${out.criteria.length}`);
  const labels = out.criteria.map(c => c.label.toLowerCase());
  assert(labels.some(l => l.includes("safety")), "missing safety");
  assert(labels.some(l => l.includes("system")), "missing system plan");
});

test("parseJsonExtract pulls criteria from a config", () => {
  const cfg = {
    metadata: { name: "Test", state: "TX" },
    criteria: [
      { label: "Safety", weight: 5, acrp_category: "safety_security" },
      { label: "Federal", max_points: 20, acrp_category: "revenue_cost" }
    ]
  };
  const ext = T.parseJsonExtract(cfg);
  assert(ext.name === "Test" && ext.state === "TX", "metadata not extracted");
  assert(ext.criteria.length === 2, "criteria count");
  assert(ext.criteria[0].weight === 5, "weight not extracted");
});

test("guessAcrpCategory hits common patterns", () => {
  assert(T.guessAcrpCategory("Runway Safety") === "safety_security", "safety");
  assert(T.guessAcrpCategory("State System Plan Alignment") === "system_plan_alignment", "sasp");
  assert(T.guessAcrpCategory("Asset Preservation") === "asset_preservation", "preservation");
  assert(T.guessAcrpCategory("Federal Funding Match") === "revenue_cost", "revenue");
  assert(T.guessAcrpCategory("Random Other Criterion") === null, "should be null");
});

test("computeGapAnalysis flags missing common criteria", () => {
  const ext = {
    source_format: "test",
    criteria: [{ label: "Safety", weight: 40 }]   // only safety; expect lots of missing
  };
  const gap = T.computeGapAnalysis(ext);
  assert(gap.present.length >= 1, "should detect safety");
  assert(gap.missing.length >= 3, `expected >= 3 missing, got ${gap.missing.length}`);
  assert(gap.recommendations.length === gap.missing.length, "recs match missing");
});

test("Wizard-built draft validates and scores via the engine", () => {
  // Mimic a fully-stepped-through build draft
  const draft = {
    schema_version: "1.0.0",
    metadata: {
      name: "Test State PRM", state: "TestState", agency: "TS DOT",
      model_version: "draft", last_updated: "2026-05-06", decisions_log: []
    },
    weighting_model: "additive_100pt",
    criteria: [
      {
        id: "safety_security", label: "Safety & Security",
        acrp_category: "safety_security", scoring_style: "select_one",
        max_points: 40, project_field: "purpose",
        subcategories: [
          { id: "safety", label: "Safety", score: 40 },
          { id: "security", label: "Security", score: 30 },
          { id: "maintenance", label: "Maintenance", score: 20 }
        ]
      },
      {
        id: "revenue_cost", label: "Federal Funding Match",
        acrp_category: "revenue_cost", scoring_style: "select_one",
        max_points: 30, project_field: "federal_funding_type",
        subcategories: [
          { id: "discretionary", label: "Discretionary", score: 30 },
          { id: "entitlement", label: "Entitlement", score: 15 },
          { id: "no_federal", label: "No Federal", score: 0 }
        ]
      }
    ],
    governance: { decision_authority: "Test Aero Commission", decision_cadence: "annual" }
  };
  const m = new engine.PriorityModel(draft);
  const r = m.rank(global.PM_SAMPLE_PROJECTS);
  assert(r.scored.length > 0, "engine should score projects from a wizard draft");
  // Top should be safety + discretionary (P001 Jackson Hole)
  const top = r.ranked()[0];
  assert(top.project_id === "P001" || top.final_score >= 60,
         `expected P001 or score >=60, got ${top.project_id} ${top.final_score}`);
});

let passed = 0; const failed = [];
for (const t of tests) {
  try { t.fn(); console.log("  ✓ " + t.n); passed++; }
  catch (e) { console.log("  ✗ " + t.n + ": " + e.message); failed.push(t.n); }
}
console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${passed}/${tests.length} passed`);
if (failed.length) console.log("FAILED: " + failed.join(", "));
console.log("=".repeat(60));
process.exit(failed.length ? 1 : 0);
