/*
 * wizard.js — APH m49 AI Co-Design Wizard
 * ========================================
 *
 * Two entry paths:
 *   • Build New — guided P0–P15 sequence producing a draft config from scratch
 *   • Modify Existing — upload Excel/Word/JSON/paste-text, get gap analysis vs ACRP
 *
 * Lives alongside the configurator (priority_tool.html). Reads the embedded
 * reference configs (window.PM_REFERENCE_CONFIGS) and ACRP taxonomy
 * (window.PM_ACRP_TAXONOMY) for state-precedent hints.
 *
 * On completion, writes the result into the configurator's active model and
 * closes — the user sees their freshly authored config in the editor.
 *
 * © 2026 John Marcus Cocanougher.
 */

(function () {
  "use strict";

  // ── State machine ───────────────────────────────────────────────
  let mode = null;         // "build" | "modify"
  let stepIdx = 0;
  let draft = null;        // the config being built
  let uploadedExtract = null;
  let gapAnalysis = null;

  const BUILD_STEPS = [
    "P0_entry", "P1_identity", "P2_goals", "P3_statute",
    "P4_criteria", "P5_subcriteria", "P6_weighting", "P7_weights",
    "P8_scoring_tiers", "P9_revenue_bump", "P10_setasides",
    "P11_governance", "P12_tradeoff", "P13_review_cycle",
    "P14_sensitivity", "P15_generate"
  ];
  const MODIFY_STEPS = [
    "PM1_upload", "PM2_confirm", "PM3_gap_analysis", "PM4_apply"
  ];

  function steps() { return mode === "modify" ? MODIFY_STEPS : BUILD_STEPS; }

  // ── Public entry points ─────────────────────────────────────────
  window.openWizardBuild = function () { open("build"); };
  window.openWizardModify = function () { open("modify"); };

  function open(m) {
    mode = m;
    stepIdx = 0;
    draft = blankDraft();
    uploadedExtract = null;
    gapAnalysis = null;
    document.getElementById("wizardOverlay").style.display = "flex";
    render();
  }

  function close() {
    document.getElementById("wizardOverlay").style.display = "none";
  }

  function blankDraft() {
    return {
      schema_version: "1.0.0",
      metadata: {
        name: "", state: "", agency: "",
        model_version: "draft",
        last_updated: new Date().toISOString().slice(0, 10),
        decisions_log: []
      },
      weighting_model: "additive_100pt",
      criteria: [],
      set_asides: [],
      adjustments: {},
      governance: { decision_authority: "", decision_cadence: "annual" }
    };
  }

  function logDecision(decision, rationale, source) {
    draft.metadata.decisions_log.push({
      date: new Date().toISOString().slice(0, 10),
      author: "wizard",
      decision, rationale, source
    });
  }

  // ── Render dispatcher ───────────────────────────────────────────
  function render() {
    const body = document.getElementById("wizardBody");
    const stepLabel = document.getElementById("wizardStepLabel");
    const ss = steps();
    stepLabel.textContent = `Step ${stepIdx + 1} of ${ss.length} — ${ss[stepIdx]}`;
    body.innerHTML = renderStep(ss[stepIdx]);
    bindStepHandlers(ss[stepIdx]);
    document.getElementById("wizardPrev").disabled = stepIdx === 0;
    document.getElementById("wizardNext").textContent =
      stepIdx === ss.length - 1 ? "Finish" : "Next →";
  }

  function next() {
    if (!validateStep()) return;
    if (stepIdx >= steps().length - 1) {
      finishWizard();
      return;
    }
    stepIdx++;
    render();
  }

  function prev() {
    if (stepIdx > 0) { stepIdx--; render(); }
  }

  // ── Validation per step ─────────────────────────────────────────
  function validateStep() {
    const s = steps()[stepIdx];
    if (s === "P1_identity") {
      const name = (document.getElementById("wf_name") || {}).value;
      const state = (document.getElementById("wf_state") || {}).value;
      if (!name || !state) { alert("Please enter a model name and state."); return false; }
      draft.metadata.name = name;
      draft.metadata.state = state;
      draft.metadata.agency = (document.getElementById("wf_agency") || {}).value || "";
    }
    return true;
  }

  // ── Renderers per step ──────────────────────────────────────────
  function renderStep(stepId) {
    if (stepId === "P0_entry") return renderEntry();
    if (stepId === "P1_identity") return renderIdentity();
    if (stepId === "P2_goals") return renderGoals();
    if (stepId === "P3_statute") return renderStatute();
    if (stepId === "P4_criteria") return renderCriteriaPick();
    if (stepId === "P5_subcriteria") return renderSubcriteria();
    if (stepId === "P6_weighting") return renderWeightingModel();
    if (stepId === "P7_weights") return renderWeights();
    if (stepId === "P8_scoring_tiers") return renderScoringTiers();
    if (stepId === "P9_revenue_bump") return renderRevenueBump();
    if (stepId === "P10_setasides") return renderSetAsides();
    if (stepId === "P11_governance") return renderGovernance();
    if (stepId === "P12_tradeoff") return renderTradeoff();
    if (stepId === "P13_review_cycle") return renderReviewCycle();
    if (stepId === "P14_sensitivity") return renderSensitivity();
    if (stepId === "P15_generate") return renderGenerate();

    if (stepId === "PM1_upload") return renderUpload();
    if (stepId === "PM2_confirm") return renderConfirmExtract();
    if (stepId === "PM3_gap_analysis") return renderGapAnalysis();
    if (stepId === "PM4_apply") return renderApply();
    return "<p>Unknown step.</p>";
  }

  // ── BUILD path ──────────────────────────────────────────────────
  function renderEntry() {
    return `
      <h2>Welcome — Build New Priority Model</h2>
      <p>This wizard will walk you through ~15 short steps to produce a defensible first-draft funding-prioritization model, grounded in <em>ACRP Synthesis 123</em>. You'll end up with:</p>
      <ul style="margin: 8px 0 12px 20px; line-height:1.8">
        <li>A complete <code>priority_model.json</code> config</li>
        <li>An auto-generated draft policy document (sprint 5)</li>
        <li>An Excel companion workbook (sprint 5)</li>
        <li>A live-ranking preview of your sample project list</li>
      </ul>
      <p>You can pause and resume; everything saves to your active profile. At any time you can also drop into the Configurator's tabbed editor for finer control. Click <strong>Next</strong> when ready.</p>
    `;
  }

  function renderIdentity() {
    return `
      <h2>Step 1 — Model Identity</h2>
      <p>Who is adopting this model and what is it called?</p>
      <div class="field"><label>Model name</label>
        <input type="text" id="wf_name" value="${esc(draft.metadata.name)}" placeholder="e.g., Texas Aviation Priority Rating Model 2026"></div>
      <div class="field row">
        <div><label>State</label>
          <input type="text" id="wf_state" value="${esc(draft.metadata.state)}" placeholder="e.g., Texas"></div>
        <div><label>Agency</label>
          <input type="text" id="wf_agency" value="${esc(draft.metadata.agency)}" placeholder="e.g., TxDOT Aviation Division"></div>
      </div>
      <p class="wf-hint">📊 ACRP found 33 of 50 state aviation agencies have a formal prioritization process. About 19% of those have it codified in statute (Louisiana DOTD is an example).</p>
    `;
  }

  function renderGoals() {
    const goals = draft._goals || ["", "", ""];
    return `
      <h2>Step 2 — Strategic Goals</h2>
      <p>What 3–5 strategic goals should this priority model reinforce? These become the criteria your weights serve.</p>
      ${[0,1,2,3,4].map(i => `
        <div class="field">
          <label>Goal ${i+1}${i<3?" (required)":" (optional)"}</label>
          <input type="text" class="wf-goal" data-idx="${i}" value="${esc(goals[i] || "")}" placeholder="e.g., Preserve existing pavement assets">
        </div>`).join("")}
      <p class="wf-hint">📊 MnDOT's pillars: <em>Open Decision-Making, Transportation Safety, System Stewardship, Healthy Communities</em>. Wyoming's seven categories serve their commission's mission.</p>
    `;
  }

  function renderStatute() {
    const sr = draft.governance.statute_required || false;
    return `
      <h2>Step 3 — Statute &amp; Governance</h2>
      <div class="field">
        <label>Is your prioritization process required by statute?</label>
        <select id="wf_statute_required">
          <option value="false" ${!sr?"selected":""}>No — commission policy only</option>
          <option value="true"  ${sr?"selected":""}>Yes — codified in state statute or admin code</option>
        </select>
      </div>
      <div class="field">
        <label>Statute citation (optional, for reference)</label>
        <input type="text" id="wf_statute_citation" value="${esc(draft.governance.statute_citation || "")}" placeholder="e.g., LA Adm Code Title 70, Part IX, Subpart A, Ch 3">
      </div>
      <div class="field">
        <label>Final approval authority</label>
        <input type="text" id="wf_decision_authority" value="${esc(draft.governance.decision_authority || "")}" placeholder="e.g., Texas Aeronautics Commission">
      </div>
      <p class="wf-hint">📊 ACRP Q20: 65% of states' processes are <strong>not</strong> required by statute, just commission policy. About 19% have a statutory process.</p>
    `;
  }

  function renderCriteriaPick() {
    const tax = window.PM_ACRP_TAXONOMY || [];
    const selected = new Set((draft._selected_criteria || []));
    return `
      <h2>Step 4 — Pick Criteria from ACRP Menu</h2>
      <p>Select the evaluation criteria you want in your model. Each is grounded in ACRP Synthesis 123 and shows which states use it.</p>
      <div class="wf-criteria-grid">
        ${tax.map(c => `
          <label class="wf-criteria-card ${selected.has(c.id) ? "selected" : ""}">
            <div class="wf-criteria-head">
              <input type="checkbox" class="wf-crit-pick" data-id="${c.id}" ${selected.has(c.id) ? "checked" : ""}>
              <strong>${esc(c.label)}</strong>
              <span class="wf-pill">${c.acrp_page}</span>
            </div>
            <div class="wf-criteria-desc">${esc(c.description)}</div>
            <div class="wf-criteria-states">
              <strong>States using:</strong>
              ${c.states_using.slice(0,4).map(s => `<span class="wf-state-chip">${esc(s.state)} <em>${esc(s.weight)}</em></span>`).join("")}
              ${c.states_using.length > 4 ? `<span class="wf-state-chip">+${c.states_using.length - 4} more</span>` : ""}
            </div>
          </label>
        `).join("")}
      </div>
      <p class="wf-hint">💡 Most state models use 5–8 criteria. Wyoming has 7. MnDOT has 7. ALDOT has 3 (with granular subcategories). Pick a balanced set.</p>
    `;
  }

  function renderSubcriteria() {
    const sel = draft._selected_criteria || [];
    if (!sel.length) {
      return `<h2>Step 5 — Subcriteria</h2><p>No criteria selected in step 4. Go back and pick at least one.</p>`;
    }
    const tax = window.PM_ACRP_BY_ID || {};
    return `
      <h2>Step 5 — Define Subcriteria</h2>
      <p>For each criterion, accept the suggested subcriteria or edit them. The wizard pre-populates from common state patterns.</p>
      ${sel.map(id => {
        const c = tax[id] || { label: id, common_subcategories: [] };
        const subs = (draft._subcriteria || {})[id] || c.common_subcategories || [];
        return `
          <div class="wf-card">
            <h3>${esc(c.label)}</h3>
            <p style="font-size:.78rem; color:var(--gray-600)">${esc(c.description || "")}</p>
            <textarea class="wf-subs" data-crit="${id}" rows="3" placeholder="One subcategory per line">${esc(subs.join("\n"))}</textarea>
          </div>
        `;
      }).join("")}
    `;
  }

  function renderWeightingModel() {
    const wm = draft.weighting_model || "additive_100pt";
    return `
      <h2>Step 6 — Weighting Model</h2>
      <p>How should criterion scores combine into a final project score?</p>
      <div class="wf-radio-grid">
        ${[
          { id: "multiplicative", label: "Multiplicative (Wyoming pattern)",
            desc: "Each criterion has a weight (1–5). Final score = sum of (weight × subcategory score). Total range up to ~105 pts." },
          { id: "additive_100pt", label: "Additive 100-point (MnDOT, ALDOT, Louisiana pattern)",
            desc: "Each criterion has a max-points cap. Final score sums to ~100. Supports negative scores for non-compliance." },
          { id: "formula", label: "Custom Formula (Illinois pattern)",
            desc: "Define an arbitrary expression over criterion scores. Power-user mode; e.g., '(4*A+2*C+0.7*P+0.7*T)/4.2 + X'." },
          { id: "dual_objective_subjective", label: "Dual Objective+Subjective (North Dakota pattern)",
            desc: "Objective scoring + subjective override layer for commissioner discretion." }
        ].map(o => `
          <label class="wf-radio-card ${wm===o.id?"selected":""}">
            <input type="radio" name="wf_weighting" value="${o.id}" ${wm===o.id?"checked":""}>
            <div>
              <strong>${esc(o.label)}</strong>
              <div style="font-size:.78rem; color:var(--gray-600); margin-top:4px">${esc(o.desc)}</div>
            </div>
          </label>
        `).join("")}
      </div>
    `;
  }

  function renderWeights() {
    materializeCriteria();
    const wm = draft.weighting_model;
    if (wm === "formula") {
      return `
        <h2>Step 7 — Custom Formula</h2>
        <p>Define an expression referencing your criterion ids. The safe expression evaluator supports <code>+ - * / ** ()</code>.</p>
        <div class="field">
          <label>Global Formula</label>
          <input type="text" id="wf_global_formula" value="${esc(draft.global_formula || "")}" placeholder="(4*safety_security + 2*revenue_cost + 0.7*system_plan_alignment) / 4.2">
        </div>
        <p class="wf-hint">Available criterion ids: ${draft.criteria.map(c=>c.id).join(", ")}</p>
      `;
    }
    return `
      <h2>Step 7 — Set Weights</h2>
      <p>Adjust the weight or max-points for each criterion. Use the state precedents below as anchors.</p>
      <table class="wf-weights-table">
        <thead><tr><th>Criterion</th><th>State precedents</th>
          <th class="num">${wm === "multiplicative" ? "Weight (1–5)" : "Max points"}</th></tr></thead>
        <tbody>
          ${draft.criteria.map((c, i) => {
            const tax = (window.PM_ACRP_BY_ID || {})[c.acrp_category] || {};
            const states = (tax.states_using || []).slice(0, 3)
              .map(s => `<span class="wf-state-chip">${esc(s.state)} ${esc(s.weight)}</span>`).join("");
            const cur = wm === "multiplicative" ? (c.weight ?? 1) : (c.max_points ?? 10);
            return `<tr>
              <td><strong>${esc(c.label)}</strong></td>
              <td>${states || "—"}</td>
              <td class="num"><input type="number" step="0.5" value="${cur}" data-idx="${i}" class="wf-weight-input" style="width:70px"></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function renderScoringTiers() {
    return `
      <h2>Step 8 — Scoring Tiers</h2>
      <p>The wizard pre-populated reasonable subcategory scores in step 5. You can fine-tune them after wizard completion in the Configurator's <strong>Criteria</strong> tab — that's where every subcategory's score is editable inline.</p>
      <p>Common patterns:</p>
      <ul style="margin: 8px 0 12px 20px; line-height:1.8">
        <li><strong>Tiered with negatives</strong> (MnDOT): +10 / +5 / −10 to reward compliance and penalize neglect.</li>
        <li><strong>Project-type lookup</strong> (ALDOT): granular table with 40+ entries.</li>
        <li><strong>Pick-one</strong> (Wyoming): 5 mutually-exclusive purposes with descending point values.</li>
      </ul>
      <p class="wf-hint">📊 Skip ahead — we'll generate sensible defaults from the ACRP precedents and you can tune the scores in the Configurator.</p>
    `;
  }

  function renderRevenueBump() {
    const a = draft.adjustments.revenue_producing_bump || {};
    return `
      <h2>Step 9 — Revenue-Producing Project Bump</h2>
      <p>About 1/3 of states bump priority on revenue-producing projects (hangars, fuel facilities, terminals) because they don't compete well for FAA funds.</p>
      <div class="field">
        <label><input type="checkbox" id="wf_rev_enabled" ${a.enabled?"checked":""}> Enable revenue-producing project bump</label>
      </div>
      <div class="field">
        <label>Bonus amount (added to score)</label>
        <input type="number" id="wf_rev_amount" step="1" value="${a.bonus_amount ?? 10}">
      </div>
      <div class="field">
        <label>Project-type tags eligible (comma-separated, matched in project_type field)</label>
        <input type="text" id="wf_rev_tags" value="${esc((a.applies_to_project_types||["hangar","fuel","terminal"]).join(", "))}">
      </div>
      <p class="wf-hint">📊 ALDOT applies +10 pts when sponsor demonstrates economic-development need. Wyoming explicitly excludes revenue-producing.</p>
    `;
  }

  function renderSetAsides() {
    const list = draft.set_asides || [];
    return `
      <h2>Step 10 — Set-asides (optional)</h2>
      <p>Reserve a portion of state funds for specific categories before ranking.</p>
      <div id="wf_setasides">
        ${list.length ? list.map((s, i) => `
          <div class="wf-card">
            <div class="field row">
              <div><label>Label</label>
                <input type="text" data-idx="${i}" data-key="label" value="${esc(s.label||"")}" class="wf-sa-input"></div>
              <div><label>%</label>
                <input type="number" step="0.1" data-idx="${i}" data-key="allocation_pct" value="${s.allocation_pct||0}" class="wf-sa-input"></div>
            </div>
            <div class="field"><label>Eligibility filter</label>
              <input type="text" data-idx="${i}" data-key="eligibility_filter" value="${esc(s.eligibility_filter||"")}" class="wf-sa-input"></div>
          </div>`).join("") : '<p style="color:var(--gray-600)">None defined yet.</p>'}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window._wfAddSA()">+ Add Set-aside</button>
      <p class="wf-hint">📊 Washington: 25% non-NPIAS + 10% transformational. Louisiana: 21.622% ACE Program for air carriers.</p>
    `;
  }

  function renderGovernance() {
    return `
      <h2>Step 11 — Decision Process</h2>
      <p>Who scores, who recommends, who approves, and how often?</p>
      <div class="field">
        <label>Scoring authority (typically the state aviation division)</label>
        <input type="text" id="wf_scoring_authority" value="${esc(draft.governance.scoring_authority || "")}">
      </div>
      <div class="field">
        <label>Decision cadence</label>
        <select id="wf_cadence">
          <option value="annual">Annual</option><option value="quarterly">Quarterly</option>
          <option value="monthly">Monthly</option><option value="rolling">Rolling</option>
          <option value="biennial">Biennial</option>
        </select>
      </div>
      <div class="field">
        <label>Approval process (plain-language description)</label>
        <textarea id="wf_approval_process" rows="3" placeholder="e.g., Sponsors submit pre-applications. Division scores. Commission votes annually in October.">${esc(draft.governance.approval_process || "")}</textarea>
      </div>
      <p class="wf-hint">📊 ACRP Q18: most states use a board/commission for final approval. Cycles range from 2 days to 12 months.</p>
    `;
  }

  function renderTradeoff() {
    const tl = draft.adjustments.tradeoff_layer || {};
    return `
      <h2>Step 12 — Tradeoff Analysis</h2>
      <p>Should the model support post-scoring sequencing? (North Dakota uses this.)</p>
      <div class="field"><label><input type="checkbox" id="wf_tl_enabled" ${tl.enabled?"checked":""}> Enable tradeoff layer</label></div>
      <div class="field"><label><input type="checkbox" id="wf_tl_urgency" ${tl.urgency_sort?"checked":""}> Sort by urgency within score tiers</label></div>
      <div class="field"><label><input type="checkbox" id="wf_tl_finance" ${tl.financial_impact_sort?"checked":""}> Sort by financial impact</label></div>
      <div class="field"><label><input type="checkbox" id="wf_tl_override" ${tl.discretion_override_allowed?"checked":""}> Allow commissioner override with documented justification</label></div>
    `;
  }

  function renderReviewCycle() {
    return `
      <h2>Step 13 — Model Update Cadence</h2>
      <p>How often should the model itself be reviewed and re-approved?</p>
      <div class="field">
        <label>Review cycle (years)</label>
        <input type="number" id="wf_review_cycle" min="1" max="10" value="${draft.governance.model_review_cycle_years || 3}">
      </div>
      <p class="wf-hint">📊 Wyoming task-force review every ~3 years. MnDOT every ~5 years. Louisiana revises annually with statute updates.</p>
    `;
  }

  function renderSensitivity() {
    finalizeWeights();
    let result;
    try {
      const m = new window.PriorityEngine.PriorityModel(draft);
      result = m.rank(window.PM_SAMPLE_PROJECTS || []);
    } catch (e) {
      return `<h2>Step 14 — Sensitivity Preview</h2>
        <p style="color:var(--danger)">Engine error: ${esc(e.message)} — go back and fix your model.</p>`;
    }
    const top = result.ranked().slice(0, 5);
    const bot = result.ranked().slice(-3);
    return `
      <h2>Step 14 — Sensitivity Check</h2>
      <p>Here's how your draft model ranks the 25-project sample. Top and bottom of the ranking should pass a sniff test for what your state would actually fund.</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px">
        <div class="wf-card">
          <h3>Top 5</h3>
          <table><tbody>${top.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.project_id)}</td><td>${esc(p.project_label.slice(0,40))}</td><td class="num"><strong>${p.final_score.toFixed(1)}</strong></td></tr>`).join("")}</tbody></table>
        </div>
        <div class="wf-card">
          <h3>Bottom 3</h3>
          <table><tbody>${bot.map((p,i)=>`<tr><td>—</td><td>${esc(p.project_id)}</td><td>${esc(p.project_label.slice(0,40))}</td><td class="num"><strong>${p.final_score.toFixed(1)}</strong></td></tr>`).join("")}</tbody></table>
        </div>
      </div>
      <p class="wf-hint" style="margin-top:14px">If the bottom is dominated by projects you'd actually want to fund, your weights need tuning. The Configurator's <strong>Live Ranking Preview</strong> updates instantly as you adjust weights — that's where this iteration usually happens.</p>
    `;
  }

  function renderGenerate() {
    return `
      <h2>Step 15 — Generate</h2>
      <p>Your draft is ready. When you click <strong>Finish</strong>:</p>
      <ul style="margin: 8px 0 12px 20px; line-height:1.8">
        <li>The draft saves as a new profile in the Configurator</li>
        <li>The Configurator opens to your active model — fine-tune any weight or scoring tier inline</li>
        <li>Export as JSON, Excel companion (sprint 5), or policy manual draft (sprint 5)</li>
      </ul>
      <div class="wf-card" style="margin-top:14px">
        <h3>Draft summary</h3>
        <table><tbody>
          <tr><td>Model name</td><td><strong>${esc(draft.metadata.name || "(unnamed)")}</strong></td></tr>
          <tr><td>State</td><td>${esc(draft.metadata.state || "—")}</td></tr>
          <tr><td>Weighting model</td><td><code>${esc(draft.weighting_model)}</code></td></tr>
          <tr><td># Criteria</td><td>${draft.criteria.length}</td></tr>
          <tr><td>Adjustments</td><td>${Object.keys(draft.adjustments).filter(k => draft.adjustments[k] && draft.adjustments[k].enabled).join(", ") || "none"}</td></tr>
          <tr><td>Governance</td><td>${esc(draft.governance.decision_authority || "—")} (${esc(draft.governance.decision_cadence)})</td></tr>
        </tbody></table>
      </div>
    `;
  }

  // ── MODIFY path ─────────────────────────────────────────────────
  function renderUpload() {
    return `
      <h2>Step 1 — Upload Your Existing Model</h2>
      <p>Upload your current model, or paste its description below. v1 supports JSON, Excel (.xlsx), Word (.docx), and plain-text formats.</p>
      <div class="field">
        <label>Upload file</label>
        <input type="file" id="wf_upload" accept=".json,.xlsx,.docx,.txt">
      </div>
      <div class="field">
        <label>… or paste your current model description</label>
        <textarea id="wf_paste" rows="8" placeholder="e.g., 'Our model has 5 criteria: Safety (40%), System Plan (20%), Sponsor Compliance (20%), Federal Match (10%), Economic Development (10%). We use a 100-point scale...'"></textarea>
      </div>
      <p class="wf-hint">PDF and OCR support comes in v2. For scanned documents, paste the relevant criteria/weights as text.</p>
    `;
  }

  function renderConfirmExtract() {
    if (!uploadedExtract) {
      return `<h2>Step 2 — Confirm Extraction</h2><p style="color:var(--danger)">Nothing extracted yet. Go back and upload or paste.</p>`;
    }
    const e = uploadedExtract;
    return `
      <h2>Step 2 — Confirm Extracted Model</h2>
      <p>Here's what the wizard parsed. Confirm or correct before we run the gap analysis.</p>
      <div class="wf-card">
        <h3>Identity</h3>
        <table><tbody>
          <tr><td>Source format</td><td><code>${esc(e.source_format)}</code></td></tr>
          <tr><td>Detected name</td><td>${esc(e.name || "(not found)")}</td></tr>
          <tr><td>Detected state</td><td>${esc(e.state || "(not found)")}</td></tr>
        </tbody></table>
      </div>
      <div class="wf-card">
        <h3>Detected criteria (${e.criteria.length})</h3>
        ${e.criteria.length ? `
          <table><thead><tr><th>Label</th><th class="num">Weight / Pts</th><th>Likely ACRP category</th></tr></thead>
          <tbody>${e.criteria.map(c => `
            <tr><td>${esc(c.label)}</td><td class="num">${c.weight ?? c.max_points ?? "—"}</td><td>${esc(c.acrp_category || "?")}</td></tr>
          `).join("")}</tbody></table>
        ` : `<p style="color:var(--gray-600)">No criteria detected. The wizard works best with structured Excel/JSON; for free-text, edit manually after import.</p>`}
      </div>
    `;
  }

  function renderGapAnalysis() {
    if (!gapAnalysis) gapAnalysis = computeGapAnalysis(uploadedExtract);
    return `
      <h2>Step 3 — Gap Analysis vs ACRP</h2>
      <p>Comparing your uploaded model to ACRP Synthesis 123 best practices.</p>
      <div class="wf-card">
        <h3>✓ Present (${gapAnalysis.present.length})</h3>
        ${gapAnalysis.present.length ? gapAnalysis.present.map(g =>
          `<div class="wf-gap-row good">${esc(g.label)} <span class="wf-pill">${esc(g.acrp_id)}</span></div>`).join("") : "—"}
      </div>
      <div class="wf-card">
        <h3>✗ Missing — common in peer states (${gapAnalysis.missing.length})</h3>
        ${gapAnalysis.missing.length ? gapAnalysis.missing.map(g =>
          `<div class="wf-gap-row bad">
            ${esc(g.label)}
            <div style="font-size:.76rem; color:var(--gray-600); margin-top:2px">
              ${esc(g.peer_summary)}
            </div>
          </div>`).join("") : "—"}
      </div>
      <div class="wf-card">
        <h3>⚠ Weight outliers (${gapAnalysis.outliers.length})</h3>
        ${gapAnalysis.outliers.length ? gapAnalysis.outliers.map(g =>
          `<div class="wf-gap-row warn">${esc(g.label)} — your weight ${g.your_weight}, peer median ${g.peer_median}</div>`
        ).join("") : "—"}
      </div>
    `;
  }

  function renderApply() {
    return `
      <h2>Step 4 — Apply Recommendations</h2>
      <p>Choose which recommendations to apply. Anything you skip can be added later in the Configurator.</p>
      ${(gapAnalysis ? gapAnalysis.recommendations : []).map((r, i) => `
        <label class="wf-rec-row">
          <input type="checkbox" data-idx="${i}" class="wf-rec-pick" checked>
          <div>
            <strong>${esc(r.action)}</strong>
            <div style="font-size:.78rem; color:var(--gray-600)">${esc(r.rationale)}</div>
          </div>
        </label>
      `).join("") || "<p>No recommendations.</p>"}
    `;
  }

  // ── Step handlers / mutations ───────────────────────────────────
  function bindStepHandlers(stepId) {
    if (stepId === "P2_goals") {
      document.querySelectorAll(".wf-goal").forEach(el => {
        el.addEventListener("input", () => {
          draft._goals = draft._goals || [];
          draft._goals[Number(el.dataset.idx)] = el.value;
        });
      });
    } else if (stepId === "P3_statute") {
      document.getElementById("wf_statute_required").addEventListener("change", e => {
        draft.governance.statute_required = e.target.value === "true";
      });
      document.getElementById("wf_statute_citation").addEventListener("input", e => {
        draft.governance.statute_citation = e.target.value;
      });
      document.getElementById("wf_decision_authority").addEventListener("input", e => {
        draft.governance.decision_authority = e.target.value;
      });
    } else if (stepId === "P4_criteria") {
      document.querySelectorAll(".wf-crit-pick").forEach(cb => {
        cb.addEventListener("change", () => {
          const checked = Array.from(document.querySelectorAll(".wf-crit-pick:checked")).map(c => c.dataset.id);
          draft._selected_criteria = checked;
          cb.closest(".wf-criteria-card").classList.toggle("selected", cb.checked);
        });
      });
    } else if (stepId === "P5_subcriteria") {
      document.querySelectorAll(".wf-subs").forEach(t => {
        t.addEventListener("input", () => {
          draft._subcriteria = draft._subcriteria || {};
          draft._subcriteria[t.dataset.crit] = t.value.split("\n").map(s=>s.trim()).filter(Boolean);
        });
      });
    } else if (stepId === "P6_weighting") {
      document.querySelectorAll('input[name="wf_weighting"]').forEach(r => {
        r.addEventListener("change", e => { draft.weighting_model = e.target.value; });
      });
    } else if (stepId === "P7_weights") {
      const wm = draft.weighting_model;
      if (wm === "formula") {
        document.getElementById("wf_global_formula").addEventListener("input", e => {
          draft.global_formula = e.target.value;
        });
      } else {
        document.querySelectorAll(".wf-weight-input").forEach(inp => {
          inp.addEventListener("input", () => {
            const i = Number(inp.dataset.idx);
            const v = Number(inp.value);
            if (wm === "multiplicative") draft.criteria[i].weight = v;
            else draft.criteria[i].max_points = v;
          });
        });
      }
    } else if (stepId === "P9_revenue_bump") {
      const bind = () => {
        draft.adjustments.revenue_producing_bump = {
          enabled: document.getElementById("wf_rev_enabled").checked,
          bonus_amount: Number(document.getElementById("wf_rev_amount").value) || 0,
          applies_to_project_types: document.getElementById("wf_rev_tags").value.split(",").map(s=>s.trim()).filter(Boolean)
        };
      };
      ["wf_rev_enabled","wf_rev_amount","wf_rev_tags"].forEach(id =>
        document.getElementById(id).addEventListener("input", bind));
    } else if (stepId === "P10_setasides") {
      window._wfAddSA = () => {
        draft.set_asides = draft.set_asides || [];
        draft.set_asides.push({ id: `set_aside_${draft.set_asides.length+1}`, label: "", allocation_pct: 0, eligibility_filter: "" });
        render();
      };
      document.querySelectorAll(".wf-sa-input").forEach(inp => {
        inp.addEventListener("input", () => {
          const i = Number(inp.dataset.idx); const k = inp.dataset.key;
          let v = inp.value; if (k === "allocation_pct") v = Number(v);
          draft.set_asides[i][k] = v;
        });
      });
    } else if (stepId === "P11_governance") {
      document.getElementById("wf_scoring_authority").addEventListener("input", e =>
        draft.governance.scoring_authority = e.target.value);
      document.getElementById("wf_cadence").value = draft.governance.decision_cadence || "annual";
      document.getElementById("wf_cadence").addEventListener("change", e =>
        draft.governance.decision_cadence = e.target.value);
      document.getElementById("wf_approval_process").addEventListener("input", e =>
        draft.governance.approval_process = e.target.value);
    } else if (stepId === "P12_tradeoff") {
      const bind = () => {
        draft.adjustments.tradeoff_layer = {
          enabled: document.getElementById("wf_tl_enabled").checked,
          urgency_sort: document.getElementById("wf_tl_urgency").checked,
          financial_impact_sort: document.getElementById("wf_tl_finance").checked,
          discretion_override_allowed: document.getElementById("wf_tl_override").checked
        };
      };
      ["wf_tl_enabled","wf_tl_urgency","wf_tl_finance","wf_tl_override"].forEach(id =>
        document.getElementById(id).addEventListener("change", bind));
    } else if (stepId === "P13_review_cycle") {
      document.getElementById("wf_review_cycle").addEventListener("input", e =>
        draft.governance.model_review_cycle_years = Number(e.target.value) || 3);
    } else if (stepId === "PM1_upload") {
      document.getElementById("wf_upload").addEventListener("change", e => {
        const f = e.target.files[0]; if (!f) return;
        parseUpload(f).then(extract => { uploadedExtract = extract; });
      });
      document.getElementById("wf_paste").addEventListener("input", e => {
        uploadedExtract = parseFreeText(e.target.value);
      });
    }
  }

  // Materialize selected criteria + subcriteria into draft.criteria array
  function materializeCriteria() {
    const sel = draft._selected_criteria || [];
    const tax = window.PM_ACRP_BY_ID || {};
    if (draft.criteria.length === sel.length && draft.criteria.every(c => sel.includes(c.acrp_category))) return;
    draft.criteria = sel.map(id => {
      const c = tax[id] || {};
      const subs = (draft._subcriteria || {})[id] || c.common_subcategories || [];
      return {
        id: id,
        label: c.label || id,
        description: c.description,
        acrp_category: id,
        scoring_style: "select_one",
        weight: 3,
        max_points: 10,
        project_field: id,
        subcategories: subs.map((s, i) => ({
          id: s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || `sub_${i+1}`,
          label: s,
          score: Math.max(0, subs.length - i)
        }))
      };
    });
  }

  // Sanitize for engine consumption — drop wizard-only keys
  function finalizeWeights() {
    materializeCriteria();
    delete draft._selected_criteria;
    delete draft._subcriteria;
    delete draft._goals;
  }

  function finishWizard() {
    finalizeWeights();
    if (mode === "modify" && gapAnalysis) {
      applyGapRecommendations();
    }
    logDecision(
      `Initial draft completed via wizard (${mode} mode)`,
      `User stepped through ${steps().length} wizard steps and produced this config.`,
      "APH m49 wizard.js"
    );
    if (typeof window.installWizardDraft === "function") {
      window.installWizardDraft(draft);
    }
    close();
  }

  // ── Modify-existing parsing ──────────────────────────────────────
  async function parseUpload(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "json") {
      const text = await file.text();
      try { return parseJsonExtract(JSON.parse(text)); }
      catch (e) { alert("JSON parse failed: " + e.message); return null; }
    }
    if (ext === "xlsx" && window.XLSX) {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf);
      return parseXlsxExtract(wb);
    }
    if (ext === "docx" && window.mammoth) {
      const buf = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return parseFreeText(result.value);
    }
    if (ext === "txt") {
      return parseFreeText(await file.text());
    }
    alert(`Unsupported file type .${ext} (or library not loaded). Try JSON / Excel / Word / paste-text.`);
    return null;
  }

  function parseJsonExtract(json) {
    return {
      source_format: "json",
      name: json?.metadata?.name,
      state: json?.metadata?.state,
      criteria: (json.criteria || []).map(c => ({
        label: c.label,
        weight: c.weight,
        max_points: c.max_points,
        acrp_category: c.acrp_category
      }))
    };
  }

  function parseXlsxExtract(wb) {
    const out = { source_format: "xlsx", criteria: [] };
    const firstSheet = wb.SheetNames[0];
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[firstSheet]);
    rows.forEach(r => {
      const label = r.Criterion || r.criterion || r.Label || r.label;
      const weight = r.Weight || r.weight;
      const max = r.MaxPoints || r.max_points || r.Points;
      if (label) out.criteria.push({ label, weight, max_points: max });
    });
    return out;
  }

  function parseFreeText(text) {
    const out = { source_format: "text", criteria: [] };
    if (!text) return out;
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
      // Patterns: "Label (40%)" or "Label: 40 pts" or "Label - weight 5"
      const m = line.match(/^(.+?)\s*[\(\:\-–]\s*(?:weight\s+)?(\d+(?:\.\d+)?)\s*(%|pts?|points)?\s*\)?/i);
      if (m) {
        out.criteria.push({ label: m[1].trim(), weight: Number(m[2]), max_points: Number(m[2]) });
      }
    });
    return out;
  }

  function computeGapAnalysis(extract) {
    if (!extract) return { present: [], missing: [], outliers: [], recommendations: [] };
    const tax = window.PM_ACRP_TAXONOMY || [];
    const presentIds = new Set();
    extract.criteria.forEach(c => {
      const guess = guessAcrpCategory(c.label);
      if (guess) presentIds.add(guess);
    });
    const present = tax.filter(t => presentIds.has(t.id))
      .map(t => ({ label: t.label, acrp_id: t.id }));
    const commonIds = new Set(["safety_security","system_plan_alignment","asset_preservation",
                                "demand_accommodation","regulatory_mandate","revenue_cost"]);
    const missing = tax.filter(t => commonIds.has(t.id) && !presentIds.has(t.id))
      .map(t => ({
        label: t.label, acrp_id: t.id,
        peer_summary: t.states_using.slice(0,3).map(s=>`${s.state} (${s.weight})`).join("; ")
      }));
    const recommendations = missing.map(m => ({
      action: `Add criterion: ${m.label}`,
      rationale: `Common in peer state models. ${m.peer_summary}.`,
      acrp_id: m.acrp_id
    }));
    return { present, missing, outliers: [], recommendations };
  }

  function guessAcrpCategory(label) {
    if (!label) return null;
    const l = label.toLowerCase();
    if (/safety|security|rsa|rpz|obstruction/.test(l)) return "safety_security";
    if (/system\s*plan|sasp|alignment/.test(l)) return "system_plan_alignment";
    if (/preserv|maintenance|rehab|asset/.test(l)) return "asset_preservation";
    if (/usage|classification|based aircraft|operations/.test(l)) return "demand_accommodation";
    if (/license|comply|regulat|mandate/.test(l)) return "regulatory_mandate";
    if (/revenue|cost|federal|funding|match/.test(l)) return "revenue_cost";
    if (/timing|urgency|operational/.test(l)) return "operational_effectiveness";
    if (/economic|development/.test(l)) return "economic_development";
    if (/environment|wetland|nepa/.test(l)) return "environment";
    if (/risk|land\s*use|zoning/.test(l)) return "risk";
    return null;
  }

  function applyGapRecommendations() {
    if (!gapAnalysis) return;
    const accepts = Array.from(document.querySelectorAll(".wf-rec-pick"))
      .filter(cb => cb.checked).map(cb => Number(cb.dataset.idx));
    accepts.forEach(i => {
      const r = gapAnalysis.recommendations[i];
      if (!r || !r.acrp_id) return;
      const tax = (window.PM_ACRP_BY_ID || {})[r.acrp_id] || {};
      draft.criteria.push({
        id: r.acrp_id, label: tax.label || r.action,
        description: tax.description, acrp_category: r.acrp_id,
        scoring_style: "select_one", max_points: 10,
        project_field: r.acrp_id, subcategories: []
      });
      logDecision(`Added '${tax.label}' criterion (gap fill)`, r.rationale, "ACRP Synthesis 123");
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  // Bind nav buttons (idempotent)
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("wizardPrev").onclick = prev;
    document.getElementById("wizardNext").onclick = next;
    document.getElementById("wizardCancel").onclick = () => {
      if (confirm("Discard wizard progress?")) close();
    };
  });
})();
