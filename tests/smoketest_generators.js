/*
 * smoketest_generators.js — Sprint 5 acceptance tests
 *
 * The Excel generator depends on SheetJS (browser CDN). Node-side we install
 * the xlsx npm package so the test can run headlessly. The docx generator
 * produces pure HTML/CSS — testable as a string.
 *
 * Run:
 *   cd APH/tools/priority_model_tool
 *   node tests/smoketest_generators.js
 */

const fs = require("fs");
const path = require("path");

const TOOL_DIR = path.resolve(__dirname, "..");

global.self = global;
global.window = global;
global.alert = () => {};
global.document = {
  createElement: () => ({ href: "", download: "", click: () => {}, style: {} }),
};
global.URL = { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} };
global.Blob = function (parts) { this.parts = parts; };

// SheetJS — try to require xlsx package (install on first run if missing)
let XLSX;
try {
  XLSX = require("xlsx");
} catch (e) {
  console.log("Installing xlsx for tests...");
  require("child_process").execSync("npm install xlsx --no-save --silent", { cwd: __dirname, stdio: "ignore" });
  XLSX = require("xlsx");
}
global.XLSX = XLSX;
// Stub XLSX.writeFile to capture into a buffer (Node-friendly)
const captured = { lastFile: null };
XLSX.writeFile = (wb, name) => {
  captured.lastFile = { name, buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
};

const engine = require(path.join(TOOL_DIR, "priority_engine.js"));
global.PriorityEngine = engine;

const gens = require(path.join(TOOL_DIR, "generators.js"));

// Embedded data from priority_tool.html
const html = fs.readFileSync(path.join(TOOL_DIR, "priority_tool.html"), "utf8");
const cfgMatch = html.match(/window\.PM_REFERENCE_CONFIGS\s*=\s*(\{[\s\S]*?\});\s*\n/);
const samMatch = html.match(/window\.PM_SAMPLE_PROJECTS\s*=\s*(\[[\s\S]*?\]);\s*\n/);
const REFS = JSON.parse(cfgMatch[1]);
const PROJECTS = JSON.parse(samMatch[1]);
global.PM_SAMPLE_PROJECTS = PROJECTS;

// ── Tests ──────────────────────────────────────────────────────────
const tests = [];
function test(n, fn) { tests.push({ n, fn }); }
function assert(c, m) { if (!c) throw new Error(m); }

test("Excel generator produces a workbook with all four expected sheets", () => {
  captured.lastFile = null;
  gens.generateExcel(REFS.wyoming, PROJECTS);
  assert(captured.lastFile, "no workbook captured");
  const wb = XLSX.read(captured.lastFile.buffer);
  const sheets = wb.SheetNames;
  ["Model", "Projects", "Ranking", "Audit"].forEach(s =>
    assert(sheets.includes(s), `missing sheet ${s} (got ${sheets.join(",")})`));
});

test("Excel Model sheet contains all criteria from the source config", () => {
  captured.lastFile = null;
  gens.generateExcel(REFS.wyoming, PROJECTS);
  const wb = XLSX.read(captured.lastFile.buffer);
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Model"], { header: 1 });
  // Wyoming has 7 criteria — each should appear by id somewhere in the sheet
  const allRows = data.map(r => r.join("|")).join("\n");
  REFS.wyoming.criteria.forEach(c => {
    assert(allRows.includes(c.id), `Model sheet missing criterion ${c.id}`);
  });
});

test("Excel Ranking sheet pre-computes Wyoming top-1 = P001", () => {
  captured.lastFile = null;
  gens.generateExcel(REFS.wyoming, PROJECTS);
  const wb = XLSX.read(captured.lastFile.buffer);
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Ranking"], { header: 1 });
  // Find the rank-1 row (header row contains 'Rank')
  const headerIdx = data.findIndex(r => r[0] === "Rank");
  assert(headerIdx !== -1, "no header row found");
  const firstRanked = data[headerIdx + 1];
  assert(firstRanked && firstRanked[1] === "P001",
         `expected rank-1 P001, got ${firstRanked && firstRanked[1]}`);
});

test("Wyoming PRM HTML contains every criterion label and a Decisions Log section", () => {
  // capture via stub
  let savedHtml = "";
  global.Blob = function (parts) { savedHtml = parts.join(""); };
  gens.generateWyomingPolicyManual(REFS.wyoming);
  REFS.wyoming.criteria.forEach(c => {
    assert(savedHtml.includes(c.label), `PRM missing criterion label '${c.label}'`);
  });
  assert(savedHtml.includes("Purpose of the Priority Rating Model"), "PRM missing purpose section");
  assert(savedHtml.includes("Decisions Log") || savedHtml.includes("decisions_log") ||
         (REFS.wyoming.metadata.decisions_log || []).length === 0,
         "PRM missing decisions log");
});

test("Louisiana Admin Code HTML contains the two-step structure", () => {
  let savedHtml = "";
  global.Blob = function (parts) { savedHtml = parts.join(""); };
  gens.generateLouisianaPolicyManual(REFS.louisiana);
  assert(savedHtml.includes("Two-Step Process Overview"), "missing two-step section");
  assert(savedHtml.includes("Step One"), "missing step one");
  assert(savedHtml.includes("Step Two"), "missing step two");
  assert(savedHtml.includes("Eligibility"), "missing eligibility section");
});

test("Generators produce something for every reference config", () => {
  global.Blob = function (parts) {};
  Object.values(REFS).forEach(cfg => {
    captured.lastFile = null;
    gens.generateExcel(cfg, PROJECTS);
    assert(captured.lastFile, `excel failed for ${cfg.metadata.name}`);
    gens.generateWyomingPolicyManual(cfg);    // no throw = pass
    gens.generateLouisianaPolicyManual(cfg);  // no throw = pass
  });
});

test("Adjustments section appears in policy doc when adjustments are enabled", () => {
  const cfg = JSON.parse(JSON.stringify(REFS.wyoming));
  cfg.adjustments = {
    revenue_producing_bump: { enabled: true, bonus_amount: 10, applies_to_project_types: ["hangar","fuel"] },
    low_federal_priority_bonus: { enabled: true, nprs_threshold: 30, bonus_amount: 15 }
  };
  let savedHtml = "";
  global.Blob = function (parts) { savedHtml = parts.join(""); };
  gens.generateWyomingPolicyManual(cfg);
  assert(savedHtml.includes("Revenue-producing project bump"), "missing rev bump");
  assert(savedHtml.includes("Low federal priority bonus"), "missing low-fed bonus");
  assert(savedHtml.includes("Illinois pattern"), "missing Illinois pattern reference");
});

// ── Runner ────────────────────────────────────────────────────────
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
