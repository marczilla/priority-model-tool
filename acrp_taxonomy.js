/*
 * acrp_taxonomy.js — ACRP Synthesis 123 14-criterion catalog with state precedents.
 *
 * Powers the wizard's "states using this criterion" hints. Each entry is a
 * top-level evaluation criterion identified in ACRP Synthesis 123 (extended
 * with system_plan_alignment, which appears in every state model we examined).
 *
 * Each entry annotates: the canonical label, ACRP page reference, and which
 * states use the criterion (Wyoming, MnDOT, ALDOT, Louisiana, plus the six
 * ACRP case examples — Idaho, Illinois, Virginia, Washington, North Dakota).
 *
 * © 2026 John Marcus Cocanougher.
 */

(function (root) {
  "use strict";

  const ACRP_TAXONOMY = [
    {
      id: "safety_security",
      label: "Safety & Security",
      description: "Addresses safety or security deficiencies and/or enhancements.",
      acrp_page: "p. 43",
      common_subcategories: ["Safety", "Security", "Standards Compliance"],
      states_using: [
        { state: "Wyoming",   weight: "5/5", note: "Highest individual category weight; max 20 pts" },
        { state: "MnDOT",     weight: "10 pts", note: "Tracked as MnSASP performance metric (Part 77 obstructions)" },
        { state: "ALDOT",     weight: "40 pts", note: "Top-scored project type; RSA, OFA, RPZ all 40 pts" },
        { state: "Louisiana", weight: "Cat I", note: "Safety-critical airside is highest-tier in Project Type category" },
        { state: "Idaho",     weight: "10/10", note: "Project Purpose Factor: Safety highest at 10" },
        { state: "Virginia",  weight: "0–55",  note: "Project Merit Score, safety highest" }
      ]
    },
    {
      id: "system_plan_alignment",
      label: "State System Plan Alignment",
      description: "Project advances the state aviation system plan's documented goals and metrics.",
      acrp_page: "p. 44",
      common_subcategories: ["State system goal met", "Local goal met", "Commission/board priority met"],
      states_using: [
        { state: "Wyoming",   weight: "4/5", note: "Systems Impact category counts WySASP state + local goals" },
        { state: "MnDOT",     weight: "60 pts", note: "Entire 'System Plan Alignment' bucket (5 criteria) tied to MnSASP" },
        { state: "ALDOT",     weight: "−20 pts", note: "Project NOT supported by state system plan = −20 penalty" },
        { state: "Louisiana", weight: "Mixed", note: "Table 3.2 ties scoring to LASP goals/objectives" },
        { state: "North Dakota", weight: "Mixed", note: "Among 11 prioritization factors" }
      ]
    },
    {
      id: "asset_preservation",
      label: "Asset Preservation",
      description: "Preserves existing assets and maintains existing facilities; 'maintain before build'.",
      acrp_page: "p. 44",
      common_subcategories: ["Pavement preservation", "Rehabilitation", "Maintenance"],
      states_using: [
        { state: "Wyoming",   weight: "3/5", note: "Project Component category prioritizes airside primary" },
        { state: "MnDOT",     weight: "20 pts", note: "Work Type criterion; preservation > expansion explicitly" },
        { state: "ALDOT",     weight: "39 pts", note: "Primary runway rehab/overlay scores 39 of max 40" },
        { state: "Louisiana", weight: "28 pts", note: "Preservation tier in Project Type category" }
      ]
    },
    {
      id: "demand_accommodation",
      label: "Demand Accommodation / Airport Usage",
      description: "Accommodates forecast demand or recognizes airports serving more users.",
      acrp_page: "p. 44",
      common_subcategories: ["System plan classification", "Based aircraft", "Operations volume"],
      states_using: [
        { state: "Wyoming",   weight: "3/5", note: "Airport Usage category uses WySASP classification" },
        { state: "MnDOT",     weight: "20 pts", note: "Airport Component criterion (primary runway = 20 pts)" },
        { state: "ALDOT",     weight: "30 pts", note: "Airport Usage category (based aircraft tiers + econ-dev bonus)" },
        { state: "Louisiana", weight: "25 pts", note: "Facility Usage by LASP classification" }
      ]
    },
    {
      id: "regulatory_mandate",
      label: "Regulatory Mandate / Compliance",
      description: "Required by regulatory mandate, compliance directive, or sponsor obligation.",
      acrp_page: "p. 44",
      common_subcategories: ["Licensing compliance", "Commission policies", "Statute compliance"],
      states_using: [
        { state: "Wyoming",   weight: "Implicit", note: "Eligibility check before scoring; statute 10-3-402 governs" },
        { state: "MnDOT",     weight: "20 pts", note: "Licensing Compliance criterion (Minn Rules 8800.1600)" },
        { state: "ALDOT",     weight: "30 pts", note: "Sponsor Responsibility category" },
        { state: "Louisiana", weight: "25 pts", note: "Sponsor Compliance category + statute requires the whole process" }
      ]
    },
    {
      id: "revenue_cost",
      label: "Revenue / Cost / Federal Funding Match",
      description: "Generates revenue, reduces costs, or reflects federal funding match priority.",
      acrp_page: "p. 44",
      common_subcategories: ["Discretionary federal", "Entitlement", "State match", "Revenue-producing"],
      states_using: [
        { state: "Wyoming",   weight: "5/5", note: "Type of Federal Funding — discretionary scores 4×5=20" },
        { state: "Louisiana", weight: "ACE Program", note: "21.622% set-aside for air carrier airports" },
        { state: "Washington", weight: "Set-asides", note: "25% non-NPIAS, 10% transformational" },
        { state: "Illinois",  weight: "Custom", note: "Reconfigured FAA NPRS to target low-federal-priority projects" }
      ]
    },
    {
      id: "operational_effectiveness",
      label: "Operational Effectiveness / Project Timing",
      description: "Maximizes operational effectiveness; project urgency relative to funding cycle.",
      acrp_page: "p. 44",
      common_subcategories: ["Urgent", "Time-sensitive", "Group maintenance", "Low urgency"],
      states_using: [
        { state: "Wyoming",   weight: "4/5", note: "Project Timing category; urgent = 5×4 = 20 pts max" },
        { state: "North Dakota", weight: "Subjective layer", note: "Tradeoff analysis sequences by urgency" }
      ]
    },
    {
      id: "economic_development",
      label: "Economic Development",
      description: "Promotes economic development or supports community/industry growth.",
      acrp_page: "p. 44",
      common_subcategories: ["Local economic-development demonstrated", "Commercial-service retention"],
      states_using: [
        { state: "ALDOT",     weight: "+10 pts", note: "Economic-development bonus when sponsor demonstrates need" },
        { state: "Virginia",  weight: "0–10",   note: "Economic development potential within Situational Considerations" },
        { state: "Louisiana", weight: "Cat IV", note: "Special considerations may include multimodal commerce benefit" }
      ]
    },
    {
      id: "risk",
      label: "Risk / Land Use Protection",
      description: "Assesses risk factors (environmental, financial, schedule, operational, land use).",
      acrp_page: "p. 44",
      common_subcategories: ["RPZ ownership", "Approach zone zoning", "Disclosure ordinance"],
      states_using: [
        { state: "Wyoming",   weight: "1/5", note: "Status of Airport Protection (accumulating up to 9 pts)" },
        { state: "MnDOT",     weight: "10 pts", note: "Zoning criterion within System Plan Alignment" }
      ]
    },
    {
      id: "agency_goals",
      label: "Agency Strategic Goals",
      description: "Contributes to goals or objectives of the agency or a specific program.",
      acrp_page: "p. 44",
      common_subcategories: ["Aligns with strategic plan", "Advances commission priority"],
      states_using: [
        { state: "Wyoming",   weight: "Implicit", note: "Systems Impact captures Commission priorities" },
        { state: "MnDOT",     weight: "Implicit", note: "Pillars: Open Decision-Making, Safety, Stewardship, Healthy Communities" }
      ]
    },
    {
      id: "environment",
      label: "Environment",
      description: "Protects the environment; minimizes air, water, and noise pollution.",
      acrp_page: "p. 44",
      common_subcategories: ["NEPA / EA / EIS", "Wetland mitigation", "Noise compatibility (Part 150)"],
      states_using: [
        { state: "ALDOT",     weight: "30 pts", note: "Environmental Mitigation = 30 pts in Other Infrastructure" },
        { state: "Wyoming",   weight: "Planning purpose", note: "Project Purpose 'Planning' covers environmental documentation" }
      ]
    },
    {
      id: "community_impact",
      label: "Community Impact",
      description: "Reduces community impact or improves community relations.",
      acrp_page: "p. 44",
      common_subcategories: ["Public input incorporated", "Noise compatibility", "Land use compatibility"],
      states_using: [
        { state: "MnDOT",     weight: "Healthy Communities pillar", note: "Zoning criterion ensures land-use compatibility" }
      ]
    },
    {
      id: "level_of_service",
      label: "Level of Service",
      description: "Improves the level of service / customer service.",
      acrp_page: "p. 44",
      common_subcategories: ["Capacity expansion", "Lighting / NAVAID upgrades", "Approach upgrade"],
      states_using: [
        { state: "Virginia",  weight: "Within Merit", note: "Project Merit Score includes LOS dimensions" }
      ]
    },
    {
      id: "sustainability",
      label: "Sustainability",
      description: "Encourages sustainability; reduces energy consumption.",
      acrp_page: "p. 44",
      common_subcategories: ["Solar / LED", "EV infrastructure", "Sustainable materials"],
      states_using: [
        { state: "Washington", weight: "10% set-aside", note: "Transformational grants — solar, LED, EV infrastructure" }
      ]
    },
    {
      id: "benefit_cost",
      label: "Benefit-Cost / ROI",
      description: "Analyzes relationships between cost and benefits; ROI required.",
      acrp_page: "p. 44",
      common_subcategories: ["NPV calculation", "Operating-cost impact", "BCA threshold"],
      states_using: [
        { state: "Illinois",  weight: "Required", note: "ROI analysis required as part of project applications" },
        { state: "Virginia",  weight: "Required", note: "Among 11 ACRP selection criteria — ROI required" }
      ]
    }
  ];

  // Quick lookup
  const ACRP_BY_ID = {};
  ACRP_TAXONOMY.forEach(c => { ACRP_BY_ID[c.id] = c; });

  // Expose
  root.PM_ACRP_TAXONOMY = ACRP_TAXONOMY;
  root.PM_ACRP_BY_ID = ACRP_BY_ID;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ACRP_TAXONOMY, ACRP_BY_ID };
  }
})(typeof self !== "undefined" ? self : this);
