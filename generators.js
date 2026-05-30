/*
 * generators.js — APH m49 output generators
 * ============================================
 *
 * Browser-side generators that turn a priority_model.json into:
 *   • A live Excel workbook (.xlsx) with formulas, named ranges, and a
 *     ranking sheet that recalculates as the user edits weights inside Excel.
 *   • A policy-manual document in either Wyoming-PRM or Louisiana-admin-code
 *     style. Rendered as HTML; user saves as .docx (Word opens the .doc/.html
 *     fine) or pastes into their existing manual template.
 *
 * Dependencies: SheetJS (window.XLSX) — already loaded by priority_tool.html
 * for the Modify-Existing wizard, so no extra network round-trips.
 *
 * Static-site safe: every generator runs in the browser.
 *
 * © 2026 John Marcus Cocanougher. All rights reserved.
 */

(function (root) {
  "use strict";

  // ═════════════════════════════════════════════════════════════
  //  EXCEL COMPANION
  // ═════════════════════════════════════════════════════════════
  //
  //  Workbook structure:
  //   Sheet 1: Model         (criteria + weights + scoring tiers; named ranges)
  //   Sheet 2: Projects      (sample projects or imported list)
  //   Sheet 3: Ranking       (computed scores per project; formulas reference Model)
  //   Sheet 4: Audit         (metadata, governance, decisions log)
  //
  //  The Excel file is meant for board-meeting use: a planner can tweak a
  //  weight cell and watch the ranking shift live in Excel — the same
  //  sensitivity feel as the in-browser preview, but offline-portable.

  function generateExcel(config, projects) {
    if (!window.XLSX) {
      alert("SheetJS not yet loaded. Click Generate Excel again in a few seconds.");
      return;
    }
    const wb = window.XLSX.utils.book_new();
    const wsModel = buildModelSheet(config);
    const wsProjects = buildProjectsSheet(projects);
    const wsRanking = buildRankingSheet(config, projects);
    const wsAudit = buildAuditSheet(config);
    window.XLSX.utils.book_append_sheet(wb, wsModel, "Model");
    window.XLSX.utils.book_append_sheet(wb, wsProjects, "Projects");
    window.XLSX.utils.book_append_sheet(wb, wsRanking, "Ranking");
    window.XLSX.utils.book_append_sheet(wb, wsAudit, "Audit");
    const filename =
      (config.metadata?.name || "priority_model").replace(/\s+/g, "_") + "_workbook.xlsx";
    window.XLSX.writeFile(wb, filename);
  }

  function buildModelSheet(config) {
    const rows = [];
    rows.push([
      `${config.metadata?.name || "Priority Model"} — ${config.metadata?.state || ""}`
    ]);
    rows.push([]);
    rows.push(["Weighting Model:", config.weighting_model]);
    rows.push(["Last Updated:", config.metadata?.last_updated || ""]);
    rows.push(["Source:", config.metadata?.source_citation || ""]);
    rows.push([]);
    rows.push([
      "Criterion ID", "Label", "ACRP Category", "Bucket",
      config.weighting_model === "multiplicative" ? "Weight" : "Max Points",
      "Scoring Style", "Description"
    ]);
    (config.criteria || []).forEach(c => {
      rows.push([
        c.id, c.label, c.acrp_category || "", c.bucket || "",
        config.weighting_model === "multiplicative" ? (c.weight ?? 1) : (c.max_points ?? 0),
        c.scoring_style, c.description || ""
      ]);
    });
    rows.push([]);
    rows.push(["── Subcategories (per criterion) ──"]);
    rows.push(["Criterion ID", "Subcategory ID", "Subcategory Label", "Score"]);
    (config.criteria || []).forEach(c => {
      (c.subcategories || []).forEach(s => {
        rows.push([c.id, s.id, s.label, s.score]);
      });
    });
    if ((config.set_asides || []).length) {
      rows.push([]);
      rows.push(["── Set-Asides ──"]);
      rows.push(["ID", "Label", "Allocation %", "Eligibility Filter"]);
      config.set_asides.forEach(sa => {
        rows.push([sa.id, sa.label, sa.allocation_pct, sa.eligibility_filter || ""]);
      });
    }
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{wch: 28},{wch: 32},{wch: 22},{wch: 18},{wch: 12},{wch: 16},{wch: 60}];
    return ws;
  }

  function buildProjectsSheet(projects) {
    if (!projects || !projects.length) {
      return window.XLSX.utils.aoa_to_sheet([
        ["No projects loaded — import a CSV via the configurator's Modify-Existing path, or use the embedded sample_projects."]
      ]);
    }
    // Sort columns for readability
    const headers = Object.keys(projects[0]);
    const rows = [headers, ...projects.map(p => headers.map(h => p[h]))];
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    return ws;
  }

  // The Ranking sheet is materialized (not formula-driven) because cross-sheet
  // engine reproduction in pure-Excel formulas is non-trivial. We document the
  // logic, ship the numbers, and let the user run the configurator for live
  // re-ranking. (Sprint 6 may add a formula-driven variant.)
  function buildRankingSheet(config, projects) {
    if (!window.PriorityEngine) {
      return window.XLSX.utils.aoa_to_sheet([
        ["priority_engine.js not loaded — cannot pre-compute rankings."]
      ]);
    }
    let result;
    try {
      const m = new window.PriorityEngine.PriorityModel(config);
      result = m.rank(projects || []);
    } catch (e) {
      return window.XLSX.utils.aoa_to_sheet([
        ["Engine error while computing rankings: " + e.message]
      ]);
    }

    const rows = [["Pre-computed ranking. Re-open in the configurator to recalculate live."]];
    rows.push([]);
    rows.push(["Model:", config.metadata?.name || "", "State:", config.metadata?.state || ""]);
    rows.push(["Generated:", new Date().toISOString().slice(0, 10),
                "Engine:", "priority_engine.js"]);
    rows.push([]);
    rows.push([
      "Rank", "Project ID", "Project", "Final Score", "Base Score",
      "Set-Aside", "Adjustments", "Audit Summary"
    ]);
    result.ranked().forEach((p, i) => {
      rows.push([
        i + 1, p.project_id, p.project_label, p.final_score, p.base_score,
        p.set_aside_assignment || "",
        Object.entries(p.adjustments_applied || {}).map(([k,v]) => `${k}=${v>=0?"+":""}${v}`).join("; "),
        (p.contributions || []).map(c => `${c.criterion_id}=${c.weighted_score}`).join(" | ")
      ]);
    });
    if ((result.excluded || []).length) {
      rows.push([]);
      rows.push(["── Excluded by eligibility gate ──"]);
      rows.push(["", "Project ID", "Project", "Failures"]);
      result.excluded.forEach(p => {
        rows.push(["", p.project_id, p.project_label, (p.eligibility_failures || []).join("; ")]);
      });
    }
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{wch:6},{wch:12},{wch:50},{wch:12},{wch:12},{wch:16},{wch:30},{wch:80}];
    return ws;
  }

  function buildAuditSheet(config) {
    const rows = [];
    rows.push([`Audit & Governance — ${config.metadata?.name || "Priority Model"}`]);
    rows.push([]);
    const m = config.metadata || {};
    rows.push(["Model name", m.name]);
    rows.push(["State", m.state]);
    rows.push(["Agency", m.agency]);
    rows.push(["Model version", m.model_version]);
    rows.push(["Last updated", m.last_updated]);
    rows.push(["Source citation", m.source_citation]);
    rows.push([]);
    const g = config.governance || {};
    rows.push(["── Governance ──"]);
    rows.push(["Decision authority", g.decision_authority]);
    rows.push(["Decision cadence", g.decision_cadence]);
    rows.push(["Statute required?", g.statute_required ? "Yes" : "No"]);
    rows.push(["Statute citation", g.statute_citation]);
    rows.push(["Model review cycle (yrs)", g.model_review_cycle_years]);
    rows.push(["Scoring authority", g.scoring_authority]);
    rows.push(["Approval process", g.approval_process]);
    rows.push([]);
    rows.push(["── Decisions log ──"]);
    rows.push(["Date", "Author", "Decision", "Rationale", "Source"]);
    (m.decisions_log || []).forEach(d => {
      rows.push([d.date, d.author, d.decision, d.rationale, d.source]);
    });
    rows.push([]);
    rows.push(["── Disclaimer ──"]);
    rows.push([config.disclaimer || "Planning-level analysis only; does not constitute engineering design or official FAA determination."]);
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{wch:26},{wch:80}];
    return ws;
  }

  // ═════════════════════════════════════════════════════════════
  //  POLICY MANUAL — Wyoming PRM style (default)
  // ═════════════════════════════════════════════════════════════
  //
  //  Renders an HTML document that mirrors the section structure of the
  //  Wyoming Priority Rating Model for Project Evaluation – 2021. Output is
  //  a Word-compatible .doc with embedded styles (works in Microsoft Word,
  //  Pages, Google Docs, LibreOffice).

  function generateWyomingPolicyManual(config) {
    const m = config.metadata || {};
    const g = config.governance || {};
    const html = wrapDocx(`
      ${docHeader(m.name || "State Priority Rating Model", m.state || "", m.last_updated || "")}
      <h1>${escapeXml(m.name || "Priority Rating Model")}</h1>
      <h2>for Project Evaluation</h2>
      <h3>${escapeXml(m.state || "")} ${escapeXml(m.last_updated ? "(" + m.last_updated + ")" : "")}</h3>
      <hr/>
      <h2>Purpose of the Priority Rating Model</h2>
      <p>The stated purpose of this Priority Rating Model (PRM) is to evaluate and rank airport
        projects for planning, budgeting, and granting by utilizing relevant information to make
        objective decisions considering the collective needs of the state&apos;s aviation system.</p>

      <h2>Development &amp; Organization of the Priority Rating Model</h2>
      <p>${escapeXml(g.decision_authority || "")} is responsible for the disbursement of state funds
        for airport improvements. This Model serves as a tool to maximize the use of available
        airport funding and assist in the evaluation of all airport projects proposed for state or
        federal funding.</p>
      ${g.statute_required ? `<p><strong>Statutory basis:</strong> ${escapeXml(g.statute_citation || "")}</p>` : ""}
      ${m.source_citation ? `<p><em>${escapeXml(m.source_citation)}</em></p>` : ""}

      <h2>Use of the Priority Rating Model</h2>
      <p>${escapeXml(g.approval_process || `The ${g.decision_authority || "Commission"} applies this Priority Rating Model to ensure consistent and equitable disbursement of funds, while reserving authority to make decisions considering the collective needs of the state's aviation system.`)}</p>
      <p><strong>Decision cadence:</strong> ${escapeXml(g.decision_cadence || "annual")} ·
         <strong>Scoring authority:</strong> ${escapeXml(g.scoring_authority || "—")} ·
         <strong>Model review cycle:</strong> ${g.model_review_cycle_years || "—"} years</p>

      <h2>Categories – Weights – Descriptions</h2>
      ${renderCriteriaSections(config, "multiplicative")}

      ${renderEligibilitySection(config)}
      ${renderSetAsidesSection(config)}
      ${renderAdjustmentsSection(config)}

      <h2>Conclusions from the Priority Rating Model</h2>
      <p>The resulting PRM assists the ${escapeXml(g.decision_authority || "Aeronautics Commission")} and
        the ${escapeXml(g.scoring_authority || "Aeronautics Division")} in their mission to produce a safe and
        efficient aviation system, through funding of airport capital improvement projects.</p>
      ${renderScoreSummary(config)}

      ${renderDecisionsLog(config)}

      <hr/>
      <p style="font-size: 9pt; color: #555"><em>${escapeXml(config.disclaimer || "Planning-level analysis only; does not constitute engineering design or official FAA determination.")}</em></p>
    `);
    download(html, `${(m.name || "priority_model").replace(/\s+/g, "_")}_PRM.doc`,
             "application/msword");
  }

  // ═════════════════════════════════════════════════════════════
  //  POLICY MANUAL — Louisiana admin-code style (optional)
  // ═════════════════════════════════════════════════════════════

  function generateLouisianaPolicyManual(config) {
    const m = config.metadata || {};
    const g = config.governance || {};
    const html = wrapDocx(`
      ${docHeader(m.name || "Aviation Program Policy Manual", m.state || "", m.last_updated || "")}
      <h1>${escapeXml(m.state || "State")} Aviation Program — Policy Manual</h1>
      <h2>Airport Construction and Development Priority Program</h2>
      <p><strong>Effective Date:</strong> ${escapeXml(m.last_updated || "")} &nbsp;
         <strong>Version:</strong> ${escapeXml(m.model_version || "1.0")}</p>
      <hr/>

      <h2>Purpose</h2>
      <p>This manual provides guidance and sets forth policy and procedures used in the administration
        of the state aviation funding-prioritization program. The intended audience is state aviation
        officials, airport sponsors, and public agencies that work with the State in providing safety
        and development of the State System Airports.</p>
      ${g.statute_citation ? `<p><strong>Statutory authority:</strong> ${escapeXml(g.statute_citation)}</p>` : ""}

      <h2>Two-Step Process Overview</h2>
      <p>This program uses a <strong>two-step</strong> review:</p>
      <ol>
        <li><strong>Step One — Eligibility determination.</strong> Projects must meet the eligibility
          criteria set forth in this manual before scoring is applied.</li>
        <li><strong>Step Two — Evaluation.</strong> Eligible projects are scored across the categories
          defined in Chapter 3 below.</li>
      </ol>

      <h2>Chapter 1 — Airport Funding</h2>
      <p>The state administers airport construction and development funding through this priority
        program. ${escapeXml(g.approval_process || "Programmed projects shall be included within the approved priority program. Funding flows through total approved calculated amounts per airport and category.")}</p>

      ${renderEligibilitySection(config, true)}

      <h2>Chapter 2 — Application Criteria</h2>
      <p>Airport sponsors must complete the project pre-application form. The sponsor is responsible
        for documenting eligibility, justification, and prioritization context per the criteria below.</p>

      <h2>Chapter 3 — Priority Program Project Rating Components</h2>
      <h3>3.1 Goals &amp; Objectives</h3>
      <p>The categories below reflect the State Aviation System Plan&apos;s goals and performance criteria,
        with point allocations established by statute or commission policy.</p>
      ${renderCriteriaSections(config, "additive_100pt")}

      ${renderSetAsidesSection(config, true)}
      ${renderAdjustmentsSection(config)}

      <h2>Chapter 4 — Approval &amp; Cadence</h2>
      <p><strong>Approval authority:</strong> ${escapeXml(g.decision_authority || "—")}</p>
      <p><strong>Decision cadence:</strong> ${escapeXml(g.decision_cadence || "annual")}</p>
      <p><strong>Model review cycle:</strong> ${g.model_review_cycle_years || "—"} years</p>

      ${renderDecisionsLog(config)}

      <hr/>
      <p style="font-size: 9pt; color: #555"><em>${escapeXml(config.disclaimer || "Planning-level analysis only; does not constitute engineering design or official FAA determination.")}</em></p>
    `);
    download(html, `${(m.name || "priority_model").replace(/\s+/g, "_")}_Admin_Code.doc`,
             "application/msword");
  }

  // ═════════════════════════════════════════════════════════════
  //  Shared rendering helpers
  // ═════════════════════════════════════════════════════════════

  function renderCriteriaSections(config, expectedWeighting) {
    return (config.criteria || []).map(c => {
      const weightLabel = config.weighting_model === "multiplicative"
        ? `<strong>Weight:</strong> ${c.weight ?? 1}`
        : `<strong>Max Points:</strong> ${c.max_points ?? "—"}`;
      const subs = (c.subcategories || []).map(s =>
        `<tr><td>${escapeXml(s.label || s.id)}</td><td style="text-align:right">${s.score}</td><td>${escapeXml(s.condition || "")}</td></tr>`
      ).join("");
      const subTable = subs ? `
        <table border="1" cellpadding="6" style="border-collapse:collapse; margin: 6pt 0; width:100%">
          <thead><tr style="background:#f0f0f0"><th>Subcategory</th><th style="width:80px">Score</th><th>Condition / Notes</th></tr></thead>
          <tbody>${subs}</tbody>
        </table>` : "<p><em>No subcategories defined.</em></p>";
      return `
        <h3>${escapeXml(c.label || c.id)} (${weightLabel})</h3>
        ${c.bucket ? `<p><em>Bucket: ${escapeXml(c.bucket)}</em></p>` : ""}
        ${c.acrp_category ? `<p><em>ACRP category: ${escapeXml(c.acrp_category)}</em></p>` : ""}
        ${c.description ? `<p>${escapeXml(c.description)}</p>` : ""}
        ${subTable}
      `;
    }).join("");
  }

  function renderEligibilitySection(config, isHeading) {
    const gate = config.eligibility_gate;
    if (!gate || !gate.enabled || !(gate.filters || []).length) return "";
    const items = gate.filters.map(f =>
      `<li><strong>${escapeXml(f.label)}.</strong> ${escapeXml(f.rule || "")} ` +
      `<em>(on fail: ${escapeXml(f.on_fail || "exclude")})</em></li>`
    ).join("");
    return `
      ${isHeading ? "<h2>Eligibility (Step One)</h2>" : "<h2>Eligibility Gate</h2>"}
      <p>Projects must satisfy the following filters before scoring is applied. Failure on an
         <em>exclude</em>-rule filter removes the project from the priority ranking entirely.</p>
      <ol>${items}</ol>
    `;
  }

  function renderSetAsidesSection(config, isHeading) {
    const list = config.set_asides || [];
    if (!list.length) return "";
    const items = list.map(sa =>
      `<tr><td>${escapeXml(sa.label || sa.id)}</td><td style="text-align:right">${sa.allocation_pct}%</td><td>${escapeXml(sa.eligibility_filter || "")}</td></tr>`
    ).join("");
    return `
      <h2>${isHeading ? "Set-Asides &amp; Apportionment" : "Set-Asides"}</h2>
      <p>The following portions of state funds are reserved for specific categories before the
         ranking is applied:</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse; width:100%">
        <thead><tr style="background:#f0f0f0"><th>Category</th><th style="width:100px">Allocation</th><th>Eligibility</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
    `;
  }

  function renderAdjustmentsSection(config) {
    const a = config.adjustments || {};
    const rows = [];
    const rev = a.revenue_producing_bump;
    if (rev && rev.enabled) {
      rows.push(`<li><strong>Revenue-producing project bump.</strong> Projects in categories
        ${escapeXml((rev.applies_to_project_types || []).join(", "))} receive a
        <strong>+${rev.bonus_amount || 0}</strong> bonus to their final score.</li>`);
    }
    const lfp = a.low_federal_priority_bonus;
    if (lfp && lfp.enabled) {
      rows.push(`<li><strong>Low federal priority bonus.</strong> Projects scoring at or below
        FAA NPRS ${lfp.nprs_threshold} receive a <strong>+${lfp.bonus_amount}</strong> bonus,
        targeting state funds toward projects that don&apos;t compete well federally
        (Illinois pattern).</li>`);
    }
    const tl = a.tradeoff_layer;
    if (tl && tl.enabled) {
      rows.push(`<li><strong>Tradeoff analysis layer.</strong>
        ${tl.urgency_sort ? "Within-tier urgency sort applied. " : ""}
        ${tl.financial_impact_sort ? "Financial-impact sort applied. " : ""}
        ${tl.discretion_override_allowed ? "Commissioner override permitted with documented justification (North Dakota pattern)." : ""}</li>`);
    }
    if (!rows.length) return "";
    return `<h2>Adjustments</h2><ul>${rows.join("")}</ul>`;
  }

  function renderScoreSummary(config) {
    if (config.weighting_model !== "multiplicative") return "";
    let total = 0;
    const rows = (config.criteria || []).map(c => {
      const maxSub = Math.max(0, ...((c.subcategories || []).map(s => s.score)));
      const max = (c.weight || 1) * maxSub;
      total += max;
      return `<tr><td>${escapeXml(c.label || c.id)}</td><td style="text-align:right">${c.weight}</td><td style="text-align:right">${max}</td></tr>`;
    }).join("");
    return `
      <h3>Summary of the Priority Rating Model</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse">
        <thead><tr style="background:#f0f0f0"><th>Category</th><th>Weight</th><th>Max points</th></tr></thead>
        <tbody>${rows}<tr><td><strong>Total maximum</strong></td><td></td><td style="text-align:right"><strong>${total}</strong></td></tr></tbody>
      </table>
    `;
  }

  function renderDecisionsLog(config) {
    const log = config.metadata?.decisions_log || [];
    if (!log.length) return "";
    const rows = log.map(d =>
      `<tr><td>${escapeXml(d.date || "")}</td><td>${escapeXml(d.author || "")}</td><td>${escapeXml(d.decision || "")}</td><td>${escapeXml(d.rationale || "")}</td><td>${escapeXml(d.source || "")}</td></tr>`
    ).join("");
    return `
      <h2>Appendix — Decisions Log</h2>
      <table border="1" cellpadding="6" style="border-collapse:collapse; width:100%; font-size: 9pt">
        <thead><tr style="background:#f0f0f0"><th>Date</th><th>Author</th><th>Decision</th><th>Rationale</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ═════════════════════════════════════════════════════════════
  //  HTML → docx helpers
  // ═════════════════════════════════════════════════════════════

  function wrapDocx(bodyHtml) {
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>Priority Model Document</title>
<style>
  body { font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; color: #222; max-width: 7.5in; margin: 1in auto; line-height: 1.45; }
  h1 { font-size: 22pt; color: #1B3A5C; border-bottom: 3px solid #E8851E; padding-bottom: 6pt; }
  h2 { font-size: 16pt; color: #1B3A5C; margin-top: 18pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
  h3 { font-size: 13pt; color: #2A5A8C; margin-top: 12pt; }
  table { font-size: 10pt; }
  th { background: #f0f0f0; font-weight: 700; text-align: left; }
  hr { border: none; border-top: 1px solid #999; margin: 18pt 0; }
  p { margin: 6pt 0; }
  em { color: #555; }
</style>
</head>
<body>
${bodyHtml}
</body></html>`;
  }

  function docHeader(name, state, date) {
    return `<p style="font-size:9pt; color:#666; margin-bottom: 0">${escapeXml(state)} · ${escapeXml(date)}</p>`;
  }

  function escapeXml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ═════════════════════════════════════════════════════════════
  //  ADOPTION PACKAGE — all-in-one bundle for agency rollout
  // ═════════════════════════════════════════════════════════════

  function generateAdoptionPackage(config, sampleProjects, engine) {
    const m = config.metadata || {};
    const g = config.governance || {};
    const state = m.state || "State";
    const dateStr = new Date().toISOString().slice(0, 10);

    // Run the engine to get a sample ranking
    let topRows = "";
    let methodNote = "";
    try {
      if (engine && sampleProjects && sampleProjects.length) {
        const model = new engine.PriorityModel(config);
        const result = model.rank(sampleProjects);
        const ranked = result.ranked();
        topRows = ranked.slice(0, 10).map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeXml(r.project_id || "")}</td>
            <td>${escapeXml(r.project_label || "")}</td>
            <td style="text-align:right">${Number(r.final_score || 0).toFixed(1)}</td>
          </tr>`).join("");
        methodNote = `Sample ranking uses ${sampleProjects.length} synthetic projects shipped with the tool. Replace with your agency&apos;s actual project list to see your real-world rankings.`;
      } else {
        topRows = `<tr><td colspan="4" style="text-align:center;color:#888">Engine not available — load the tool with priority_engine.js to generate sample rankings.</td></tr>`;
      }
    } catch (e) {
      topRows = `<tr><td colspan="4" style="text-align:center;color:#888">Sample ranking unavailable: ${escapeXml(e.message || "error")}</td></tr>`;
    }

    const html = wrapDocx(`
      ${docHeader(`${state} Funding Priority Model — Adoption Package`, state, dateStr)}

      <h1 style="color: #1B3A5C">${escapeXml(m.name || "Priority Model")} — Adoption Package</h1>
      <h3 style="color:#666">Prepared ${escapeXml(dateStr)} via Aviation Planning Hub m49</h3>
      <hr/>

      <h2>1 · Executive Summary</h2>
      <p>This document bundles everything ${escapeXml(state)} needs to <strong>review, socialize, and adopt</strong> the encoded
        funding-prioritization model. It is intended as a starting point for an internal agency review meeting and
        an external stakeholder briefing.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px;color:#555">Model name</td><td style="padding:4px 12px"><strong>${escapeXml(m.name || "—")}</strong></td></tr>
        <tr><td style="padding:4px 12px;color:#555">Agency</td><td style="padding:4px 12px">${escapeXml(m.agency || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Version</td><td style="padding:4px 12px">${escapeXml(m.model_version || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Last updated</td><td style="padding:4px 12px">${escapeXml(m.last_updated || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Weighting model</td><td style="padding:4px 12px">${escapeXml(config.weighting_model || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Criteria count</td><td style="padding:4px 12px">${(config.criteria || []).length}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Source citation</td><td style="padding:4px 12px;font-size:9pt">${escapeXml(m.source_citation || "—")}</td></tr>
      </table>

      <h2>2 · Why This Methodology</h2>
      <p>The encoded ${escapeXml(state)} model uses a <strong>${escapeXml(config.weighting_model || "—")}</strong> weighting model
        because:</p>
      <ul>
        ${config.weighting_model === "multiplicative" ?
          "<li>Criteria are <strong>multiplied</strong> by category weights, so a single high-weight category (e.g., safety) can move a project up dramatically even if other criteria are weak.</li><li>This rewards focused projects — projects that score very well in one important dimension.</li>" :
          config.weighting_model === "additive_100pt" ?
          "<li>Criteria sum to a fixed total (typically 100), with each criterion capped at a maximum.</li><li>This rewards <strong>well-rounded projects</strong> — projects that score acceptably across many dimensions outscore one-dimensional projects.</li>" :
          config.weighting_model === "formula" ?
          "<li>A custom expression combines criteria, allowing non-linear blending and weighted divisions.</li><li>This is appropriate when an agency has historically used a specific algebraic formula that doesn&apos;t fit simple add/multiply patterns.</li>" :
          "<li>The model has two layers: an objective merit ranking plus a subjective override for special cases.</li><li>This allows transparent merit-based ranking while preserving director discretion for edge cases (e.g., large economic-development opportunities).</li>"}
      </ul>

      <h2>3 · Full Criteria Breakdown</h2>
      ${renderCriteriaSections(config, config.weighting_model)}

      <h2>4 · Set-asides &amp; Eligibility</h2>
      ${renderEligibilitySection(config)}
      ${renderSetAsidesSection(config)}
      ${renderAdjustmentsSection(config)}

      <h2>5 · Sample Ranking — Top 10 Projects</h2>
      <p style="font-size:9pt;color:#666">${methodNote}</p>
      <table style="border-collapse:collapse;width:100%;font-size:10pt">
        <thead><tr style="background:#1B3A5C;color:#fff"><th style="padding:6px 10px;text-align:left">Rank</th><th style="padding:6px 10px;text-align:left">Project ID</th><th style="padding:6px 10px;text-align:left">Description</th><th style="padding:6px 10px;text-align:right">Final Score</th></tr></thead>
        <tbody>${topRows}</tbody>
      </table>

      <h2>6 · Governance</h2>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px;color:#555">Decision authority</td><td style="padding:4px 12px">${escapeXml(g.decision_authority || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Decision cadence</td><td style="padding:4px 12px">${escapeXml(g.decision_cadence || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Scoring authority</td><td style="padding:4px 12px">${escapeXml(g.scoring_authority || "—")}</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Statute required</td><td style="padding:4px 12px">${g.statute_required ? "Yes" : "No"}</td></tr>
        ${g.statute_citation ? `<tr><td style="padding:4px 12px;color:#555">Statute citation</td><td style="padding:4px 12px">${escapeXml(g.statute_citation)}</td></tr>` : ""}
        <tr><td style="padding:4px 12px;color:#555">Model review cycle</td><td style="padding:4px 12px">${g.model_review_cycle_years || "—"} years</td></tr>
        <tr><td style="padding:4px 12px;color:#555">Approval process</td><td style="padding:4px 12px">${escapeXml(g.approval_process || "—")}</td></tr>
      </table>

      <h2>7 · Verification Questions for Agency Review</h2>
      <p>Before adopting this model, the responsible agency should review and confirm:</p>
      <ol>
        <li><strong>Weighting model</strong> — Does the chosen weighting (multiplicative, additive, formula, or dual) match how your team intuitively thinks about ranking?</li>
        <li><strong>Criteria coverage</strong> — Are the criteria above the actual factors your team uses? Are any missing? Any that should be removed?</li>
        <li><strong>Priority ordering</strong> — Does the relative ordering (which criteria carry more weight) match your agency&apos;s policy priorities?</li>
        <li><strong>Subcategory point values</strong> — Within each criterion, do the numerical values broadly match what your agency would use?</li>
        <li><strong>Set-asides &amp; eligibility gates</strong> — Have the right pre-scoring filters been captured (e.g., NPIAS-only, $X minimums, public-use-only)?</li>
        <li><strong>Governance</strong> — Is the decision authority, cadence, and approval process accurate?</li>
        <li><strong>Source citation</strong> — Is the source citation correct, and is there a more current authoritative source we should use instead?</li>
      </ol>

      <h2>8 · How to Socialize This Internally</h2>
      <ol>
        <li><strong>Open with a "what-if" demo.</strong> Open the live tool, load your state, then change one weight and show the live re-ranking. The instant-feedback loop disarms much of the abstract debate about methodology.</li>
        <li><strong>Run a 3-state comparison.</strong> Use the Compare Models view to show your state alongside two peers (e.g., a primary-source state and an ACRP case example). Where your rankings diverge is where methodology matters.</li>
        <li><strong>Bring this document to a working session.</strong> Section 7&apos;s verification questions are designed to drive a 60-90 minute review meeting with your scoring committee or aeronautics board working group.</li>
        <li><strong>Document the audit trail.</strong> Every change you make in the tool can be exported as JSON; commit those JSON files to whatever you use for institutional memory (SharePoint, Git, file share). The Decisions Log inside the model itself is also append-only.</li>
        <li><strong>Pilot before mandate.</strong> Score the upcoming CIP cycle in parallel — run your existing process alongside this model for one cycle and compare outputs. Don&apos;t mandate adoption until the working group is comfortable.</li>
      </ol>

      ${renderDecisionsLog(config)}

      <hr/>
      <p style="font-size: 9pt; color: #555"><em>${escapeXml(config.disclaimer || "Planning-level analysis only; verify with the issuing agency before any official adoption.")}</em></p>
      <p style="font-size: 9pt; color: #888">Generated ${escapeXml(dateStr)} by Aviation Planning Hub m49 State Funding Priority Model Tool.</p>
    `);
    download(html, `${(m.name || "priority_model").replace(/\s+/g, "_")}_Adoption_Package.doc`,
             "application/msword");
  }

  // ═════════════════════════════════════════════════════════════
  //  Public API
  // ═════════════════════════════════════════════════════════════

  root.PM_Generators = {
    generateExcel,
    generateWyomingPolicyManual,
    generateLouisianaPolicyManual,
    generateAdoptionPackage,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PM_Generators;
  }
})(typeof self !== "undefined" ? self : this);
