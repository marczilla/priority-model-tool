/*
 * priority_engine.js — APH State Funding Priority Model Scoring Engine (JS Port)
 * ================================================================================
 *
 * Browser-side scoring engine. API-equivalent to priority_engine.py so the
 * configurator UI can update rankings live as the user changes weights without
 * a server round-trip.
 *
 * Engine equivalence test (sprint 6) compares Python and JS outputs against
 * the same configs and projects.
 *
 * Reference: ACRP Synthesis 123. Reference state encodings in schema/reference_configs/.
 *
 * © 2026 John Marcus Cocanougher. All rights reserved.
 *
 * Exposes:
 *   PriorityModel — load + score
 *   loadProjectsFromCSV — CSV string → array of objects
 *   safeEval — arithmetic expression evaluator (no JS eval)
 *
 * Both UMD (browser globals) and ES module exports are supported.
 */

(function (root, factory) {
  if (typeof exports === "object" && typeof module === "object") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.PriorityEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCHEMA_VERSION = "1.0.0";

  // ── Safe expression evaluator ─────────────────────────────────────
  // Recursive-descent parser for arithmetic with named variables.
  // Supports + - * / // % ** parentheses unary -/+

  function tokenize(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
      const c = expr[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
        tokens.push({ type: "num", value: parseFloat(expr.slice(i, j)) });
        i = j;
      } else if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
        tokens.push({ type: "ident", value: expr.slice(i, j) });
        i = j;
      } else if ("+-*/%()".includes(c)) {
        // Detect ** and //
        if ((c === "*" && expr[i + 1] === "*") || (c === "/" && expr[i + 1] === "/")) {
          tokens.push({ type: "op", value: c + expr[i + 1] });
          i += 2;
        } else {
          tokens.push({ type: "op", value: c });
          i++;
        }
      } else {
        throw new Error("Unexpected character in formula: " + c);
      }
    }
    return tokens;
  }

  function safeEval(expr, vars) {
    const tokens = tokenize(expr);
    let pos = 0;
    function peek() { return tokens[pos]; }
    function eat() { return tokens[pos++]; }

    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = eat().value;
        const right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parseFactor();
      while (peek() && peek().type === "op" &&
             (peek().value === "*" || peek().value === "/" ||
              peek().value === "//" || peek().value === "%")) {
        const op = eat().value;
        const right = parseFactor();
        if (op === "*") left = left * right;
        else if (op === "/") left = left / right;
        else if (op === "//") left = Math.floor(left / right);
        else if (op === "%") left = left % right;
      }
      return left;
    }

    function parseFactor() {
      let base = parseUnary();
      if (peek() && peek().type === "op" && peek().value === "**") {
        eat();
        const exp = parseFactor();
        return Math.pow(base, exp);
      }
      return base;
    }

    function parseUnary() {
      if (peek() && peek().type === "op" && (peek().value === "-" || peek().value === "+")) {
        const op = eat().value;
        const v = parseUnary();
        return op === "-" ? -v : v;
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const t = eat();
      if (!t) throw new Error("Unexpected end of formula");
      if (t.type === "num") return t.value;
      if (t.type === "ident") {
        if (!(t.value in vars)) throw new Error("Unknown variable: " + t.value);
        return vars[t.value];
      }
      if (t.type === "op" && t.value === "(") {
        const v = parseExpr();
        const close = eat();
        if (!close || close.value !== ")") throw new Error("Missing closing paren");
        return v;
      }
      throw new Error("Unexpected token: " + JSON.stringify(t));
    }

    const result = parseExpr();
    if (pos !== tokens.length) throw new Error("Trailing input in formula");
    return result;
  }

  // ── Coercion ─────────────────────────────────────────────────────
  function coerce(v) {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (s.toLowerCase() === "true" || s.toLowerCase() === "yes") return true;
    if (s.toLowerCase() === "false" || s.toLowerCase() === "no") return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
  }

  // ── Field-match operators ───────────────────────────────────────
  const COMPARATORS = {
    eq:     (a, b) => a == b,
    ne:     (a, b) => a != b,
    in:     (a, b) => Array.isArray(b) && b.includes(a),
    not_in: (a, b) => Array.isArray(b) && !b.includes(a),
    gte:    (a, b) => Number(a) >= Number(b),
    lte:    (a, b) => Number(a) <= Number(b),
    gt:     (a, b) => Number(a) > Number(b),
    lt:     (a, b) => Number(a) < Number(b),
    matches: (a, b) => new RegExp(b).test(String(a)),
  };

  function evaluateFieldMatch(fm, project) {
    const cmp = COMPARATORS[fm.operator];
    if (!cmp) throw new Error("Unknown operator: " + fm.operator);
    const actual = coerce(project[fm.field]);
    try { return cmp(actual, fm.value); } catch { return false; }
  }

  // ── Main engine class ───────────────────────────────────────────
  class PriorityModel {
    constructor(config) {
      if (config.schema_version !== SCHEMA_VERSION) {
        throw new Error(
          `Schema version mismatch: expected ${SCHEMA_VERSION}, got ${config.schema_version}`
        );
      }
      this.config = config;
      this.metadata = config.metadata;
      this.weightingModel = config.weighting_model;
      this.criteria = config.criteria;
      this.eligibilityGate = config.eligibility_gate || { enabled: false };
      this.setAsides = config.set_asides || [];
      this.adjustments = config.adjustments || {};
      this.governance = config.governance;
    }

    static fromConfig(config) { return new PriorityModel(config); }

    // ── Eligibility gate ──────────────────────────────────────────
    checkEligibility(project) {
      if (!this.eligibilityGate.enabled) return { passed: true, failures: [] };
      const failures = [];
      for (const f of this.eligibilityGate.filters || []) {
        if (f.field_check && !evaluateFieldMatch(f.field_check, project)) {
          if ((f.on_fail || "exclude") === "exclude") {
            failures.push(`${f.label}: ${f.rule}`);
          }
        }
      }
      return { passed: failures.length === 0, failures };
    }

    subcategoryMatches(criterion, sub, project) {
      if (sub.field_match) return evaluateFieldMatch(sub.field_match, project);
      const fieldName = criterion.project_field || criterion.id;
      const projVal = project[fieldName];
      if (projVal === null || projVal === undefined || projVal === "") return false;
      return String(projVal).trim() === sub.id;
    }

    scoreCriterion(criterion, project) {
      const cid = criterion.id;
      const clabel = criterion.label;
      const bucket = criterion.bucket || null;
      const style = criterion.scoring_style;
      const maxPts = criterion.max_points;
      const weight = criterion.weight !== undefined ? criterion.weight : 1;
      const subs = criterion.subcategories || [];

      let matchedIds = [];
      let rawScore = 0;
      let explanation = "";

      if (style === "formula") {
        const expr = criterion.formula || "0";
        const varsMap = {};
        subs.forEach(s => {
          if (this.subcategoryMatches(criterion, s, project)) varsMap[s.id] = s.score;
        });
        try {
          rawScore = safeEval(expr, varsMap);
          explanation = `formula '${expr}' = ${rawScore}`;
        } catch (e) {
          rawScore = 0;
          explanation = `formula error: ${e.message}`;
        }
      } else if (style === "select_one") {
        const candidates = subs.filter(s => this.subcategoryMatches(criterion, s, project));
        if (candidates.length) {
          const best = candidates.reduce((a, b) => a.score >= b.score ? a : b);
          matchedIds = [best.id];
          rawScore = best.score;
          explanation = `matched ${best.id} (score ${best.score})`;
        } else {
          explanation = "no subcategory matched";
        }
      } else if (style === "tiered_score") {
        const hit = subs.find(s => this.subcategoryMatches(criterion, s, project));
        if (hit) {
          matchedIds = [hit.id];
          rawScore = hit.score;
          explanation = `matched tier ${hit.id} (score ${hit.score})`;
        } else {
          explanation = "no tier matched";
        }
      } else if (style === "select_many") {
        const matched = subs.filter(s => this.subcategoryMatches(criterion, s, project));
        matchedIds = matched.map(s => s.id);
        rawScore = matched.reduce((sum, s) => sum + s.score, 0);
        explanation = matched.length
          ? `summed ${matched.length} matches: ${matchedIds.join(", ")}`
          : "no subcategories matched";
      } else if (style === "accumulating") {
        const matched = subs.filter(s => this.subcategoryMatches(criterion, s, project));
        matchedIds = matched.map(s => s.id);
        rawScore = matched.reduce((sum, s) => sum + s.score, 0);
        if (maxPts !== undefined && rawScore > maxPts) rawScore = maxPts;
        explanation = matched.length
          ? `accumulated ${matched.length} matches (cap ${maxPts}): ${matchedIds.join(", ")}`
          : "no subcategories matched";
      } else if (style === "flat_lookup") {
        const hit = subs.find(s => this.subcategoryMatches(criterion, s, project));
        if (hit) {
          matchedIds = [hit.id];
          rawScore = hit.score;
          explanation = `lookup hit ${hit.id} (score ${hit.score})`;
        } else {
          explanation = "no lookup match for project_type";
        }
      } else {
        throw new Error("Unknown scoring_style: " + style);
      }

      let weighted = rawScore;
      if (this.weightingModel === "multiplicative") {
        weighted = rawScore * weight;
      } else if (this.weightingModel === "additive_100pt" && maxPts !== undefined) {
        if (weighted < 0) weighted = Math.max(weighted, -Math.abs(maxPts));
        else weighted = Math.min(weighted, maxPts);
      }

      return {
        criterion_id: cid,
        criterion_label: clabel,
        bucket,
        matched_subcategory_ids: matchedIds,
        raw_score: rawScore,
        weighted_score: weighted,
        explanation,
      };
    }

    applyAdjustments(base, project) {
      const applied = {};
      const notes = [];
      let score = base;

      const rev = this.adjustments.revenue_producing_bump || {};
      if (rev.enabled) {
        const tags = rev.applies_to_project_types || [];
        const ptype = String(project.project_type || "");
        if (tags.some(t => ptype.includes(t))) {
          const bonus = rev.bonus_amount || 0;
          score += bonus;
          applied.revenue_producing_bump = bonus;
          notes.push(`revenue_producing_bump +${bonus}`);
        }
      }

      const lfp = this.adjustments.low_federal_priority_bonus || {};
      if (lfp.enabled) {
        const nprs = coerce(project.nprs_score);
        if (typeof nprs === "number" && nprs <= (lfp.nprs_threshold || 0)) {
          const bonus = lfp.bonus_amount || 0;
          score += bonus;
          applied.low_federal_priority_bonus = bonus;
          notes.push(`low_federal_priority_bonus +${bonus}`);
        }
      }

      return { score, applied, notes };
    }

    assignSetAside(project) {
      for (const sa of this.setAsides) {
        if (sa.field_filter && evaluateFieldMatch(sa.field_filter, project)) return sa.id;
      }
      return null;
    }

    scoreProject(project) {
      const audit = [];
      const elig = this.checkEligibility(project);
      if (!elig.passed) audit.push("FAILED eligibility gate: " + elig.failures.join("; "));

      const contributions = this.criteria.map(c => {
        const contrib = this.scoreCriterion(c, project);
        audit.push(
          `  ${contrib.criterion_id}: raw=${contrib.raw_score} ` +
          `weighted=${contrib.weighted_score} (${contrib.explanation})`
        );
        return contrib;
      });

      let baseScore;
      if (this.weightingModel === "formula") {
        const expr = this.config.global_formula || "0";
        const vars = {};
        contributions.forEach(c => { vars[c.criterion_id] = c.raw_score; });
        try { baseScore = safeEval(expr, vars); audit.push(`global formula '${expr}' = ${baseScore}`); }
        catch (e) { baseScore = 0; audit.push(`global formula error: ${e.message}`); }
      } else {
        baseScore = contributions.reduce((s, c) => s + c.weighted_score, 0);
      }

      const adj = this.applyAdjustments(baseScore, project);
      audit.push(...adj.notes);

      const sa = elig.passed ? this.assignSetAside(project) : null;
      if (sa) audit.push(`set-aside assignment: ${sa}`);

      return {
        project_id: String(project.project_id ?? "?"),
        project_label: String(project.description || project.airport_name || project.project_id || "?"),
        eligibility_passed: elig.passed,
        eligibility_failures: elig.failures,
        base_score: baseScore,
        contributions,
        adjustments_applied: adj.applied,
        set_aside_assignment: sa,
        final_score: elig.passed ? adj.score : 0,
        audit_trail: audit,
      };
    }

    rank(projects) {
      const scored = [], excluded = [];
      for (const p of projects) {
        const s = this.scoreProject(p);
        (s.eligibility_passed ? scored : excluded).push(s);
      }
      return {
        model_name: this.metadata.name,
        model_state: this.metadata.state,
        weighting_model: this.weightingModel,
        scored,
        excluded,
        ranked: (descending = true) =>
          [...scored].sort((a, b) => descending ? b.final_score - a.final_score : a.final_score - b.final_score),
      };
    }
  }

  // ── CSV loader (minimal) ────────────────────────────────────────
  function loadProjectsFromCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(l => l.length);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      const obj = {};
      headers.forEach((h, idx) => obj[h] = coerce((cells[idx] || "").trim()));
      rows.push(obj);
    }
    return rows;
  }

  return {
    PriorityModel,
    loadProjectsFromCSV,
    safeEval,
    SCHEMA_VERSION,
  };
});
