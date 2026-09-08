'use strict';

/**
 * stepTemplates.js — New Café & Franchisee Journey
 * ------------------------------------------------------------------
 * The single source of truth for the opening workflow: 8 FSM stages,
 * each with an ordered list of step templates. When a café is created,
 * server.js walks these templates and materialises one `step_instances`
 * row per step, computing a fixed `planned_date` from the café's anchor
 * dates + each step's offset.
 *
 * Structure derived from `Bootlegger_FSM_New_Store_Opening_Guide_v1.0.docx`
 * (SharePoint: Openings/2026 Opening Docs/New Store Opening Folder V.2/).
 *
 * ------------------------------------------------------------------
 * SCHEDULING MODEL (the core structural fix — see DEPLOY.md / handoff)
 * ------------------------------------------------------------------
 * Every step carries an `anchor` + `offsetDays`. The planned date is:
 *
 *     plannedDate = cafe[anchor + '_date'] + offsetDays
 *
 * `plannedDate` is computed once and FIXED. `actualDate` is set only when
 * someone confirms the step. The timeline always sorts/displays by
 * `plannedDate`, so a late confirmation never reshuffles the visual order.
 * Overdue = today > plannedDate AND actualDate is null.
 *
 * anchors:
 *   'created'  → café record created / franchisee sign-up (day 0 of journey)
 *   'handover' → site handover date
 *   'open'     → trading open date
 *
 * offsetDays is signed: negative = before the anchor, positive = after.
 *
 * NOTE ON CONTENT COMPLETENESS
 * ----------------------------
 * Stage 01 is fully populated. Stages 00 and 02–07 are single-line
 * placeholder stubs to be expanded once each stage's source docs are
 * pulled from SharePoint (same pattern as Stage 01). Stage 08 is wired
 * reference-only (no checklist). Step wording for Stage 01 should be
 * validated against the live source docs on first content review.
 */

// Responsible-party tags (who owns the step).
const R = {
  FSM: 'FSM',
  FRANCHISEE: 'Franchisee',
  ACCOUNTANT: 'Accountant',
  HR: 'HR Provider',
  REGIONAL_FM: 'Regional FM',
  HQ: 'HQ',
};

// ---------------------------------------------------------------------------
// STAGE 00 — Welcome & Orientation  (STUB — expand from source docs)
// ---------------------------------------------------------------------------
const STAGE_00_STEPS = [
  {
    key: 'welcome-pack-issued',
    title: 'Issue Franchisee Welcome Pack & Toolkit Navigator',
    description:
      'Send the Franchisee Welcome Pack and Franchise Toolkit Navigator to the new franchisee and walk them through how the opening journey works.',
    responsible: R.FSM,
    sourceDoc: 'Franchisee Welcome Pack / Franchise Toolkit Navigator',
    anchor: 'created',
    offsetDays: 0,
  },
  // TODO: expand Stage 00 once Welcome Pack / Toolkit Navigator are pulled.
];

// ---------------------------------------------------------------------------
// STAGE 01 — Recruitment & Opening Admin  (FULLY POPULATED)
// ---------------------------------------------------------------------------

// 01a — FSM lead actions (8)
const STAGE_01_FSM_ACTIONS = [
  {
    key: 'fsm-anchors-confirmed',
    title: 'Confirm café anchor dates (created / handover / open) loaded',
    description:
      'Verify the created, handover and target open dates are captured so every planned milestone date computes correctly.',
    responsible: R.FSM,
    sourceDoc: 'Store Information Sheet',
    anchor: 'created',
    offsetDays: 0,
  },
  {
    key: 'fsm-kickoff-call',
    title: 'Schedule & hold Stage 01 kick-off call with franchisee',
    description:
      'Introduce the opening journey, confirm the FSM as single point of contact, and set expectations for Stage 01 admin.',
    responsible: R.FSM,
    sourceDoc: 'FSM New Store Opening Guide',
    anchor: 'created',
    offsetDays: 2,
  },
  {
    key: 'fsm-issue-store-info-sheet',
    title: 'Issue Store Information Sheet for completion',
    description:
      'Send the Store Information Sheet to the franchisee to capture entity, site, contact and banking details.',
    responsible: R.FSM,
    sourceDoc: 'Store Information Sheet',
    anchor: 'created',
    offsetDays: 3,
  },
  {
    key: 'fsm-issue-business-essentials',
    title: 'Issue Business Essentials Checklist to franchisee & accountant',
    description:
      'Hand over the Business Essentials Checklist and confirm the franchisee has appointed an accountant and HR provider.',
    responsible: R.FSM,
    sourceDoc: 'Business Essentials Checklist',
    anchor: 'created',
    offsetDays: 3,
  },
  {
    key: 'fsm-confirm-recruitment-plan',
    title: 'Confirm recruitment plan & staffing structure',
    description:
      'Agree the store staffing structure and number of roles with the franchisee using the Staff Recruitment Guide.',
    responsible: R.FSM,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'created',
    offsetDays: 7,
  },
  {
    key: 'fsm-weekly-checkin',
    title: 'Weekly Stage 01 progress check-in with franchisee',
    description:
      'Recurring weekly review of Business Essentials + recruitment progress until Stage 01 is closed out.',
    responsible: R.FSM,
    sourceDoc: 'FSM New Store Opening Guide',
    anchor: 'created',
    offsetDays: 14,
  },
  {
    key: 'fsm-escalate-blockers',
    title: 'Escalate any Stage 01 blockers to Regional FM',
    description:
      'Flag outstanding legal/financial/HR items that put the opening date at risk to the Regional FM.',
    responsible: R.FSM,
    sourceDoc: 'FSM New Store Opening Guide',
    anchor: 'handover',
    offsetDays: -7,
  },
  {
    key: 'fsm-stage01-signoff',
    title: 'Stage 01 sign-off & gate to Stage 02 / 03',
    description:
      'Confirm all Business Essentials and recruitment items are complete (or approved exceptions logged) and unlock the next stages.',
    responsible: R.FSM,
    sourceDoc: 'FSM New Store Opening Guide',
    anchor: 'handover',
    offsetDays: -3,
  },
];

// 01b — Recruitment process (5-step)
const STAGE_01_RECRUITMENT = [
  {
    key: 'recruit-define-structure',
    title: 'Define staffing structure & role requirements',
    description:
      'Set out the required roles (baristas, FOH, BOH, shift leads, manager) and headcount per the Staff Recruitment Guide.',
    responsible: R.FRANCHISEE,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'created',
    offsetDays: 7,
  },
  {
    key: 'recruit-advertise-source',
    title: 'Advertise roles & source candidates',
    description:
      'Post vacancies and build a candidate pipeline for each open role.',
    responsible: R.FRANCHISEE,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'created',
    offsetDays: 14,
  },
  {
    key: 'recruit-screen-interview',
    title: 'Screen & interview candidates',
    description:
      'Shortlist, interview and reference-check candidates against role requirements.',
    responsible: R.FRANCHISEE,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'created',
    offsetDays: 21,
  },
  {
    key: 'recruit-offers-contracts',
    title: 'Issue offers & employment contracts',
    description:
      'Make offers and issue compliant employment contracts via the HR provider.',
    responsible: R.HR,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'handover',
    offsetDays: -14,
  },
  {
    key: 'recruit-confirm-roster',
    title: 'Confirm final team roster & start dates',
    description:
      'Lock the opening team roster and confirm start dates aligned to off-site and on-site training.',
    responsible: R.FRANCHISEE,
    sourceDoc: 'Staff Recruitment Guide',
    anchor: 'handover',
    offsetDays: -7,
  },
];

/**
 * 01c — Business Essentials Checklist (~49 items).
 * Grouped by category for readability; each item is tagged with its
 * responsible party and flows in via a helper below. Offsets are relative
 * to the 'created' anchor (Stage 01 admin runs from sign-up → handover).
 *
 * These items reconstruct the Business Essentials Checklist structure for a
 * South African QSR/coffee franchise opening. Validate wording/order against
 * the live source doc on first content review.
 */
const BUSINESS_ESSENTIALS = [
  // --- Legal entity & registration ---
  { key: 'be-cipc-registration', title: 'Company / CC registered with CIPC', responsible: R.ACCOUNTANT, offsetDays: 3 },
  { key: 'be-company-docs', title: 'Company registration documents (CoR) filed', responsible: R.ACCOUNTANT, offsetDays: 4 },
  { key: 'be-directors-ids', title: 'Directors / members ID documents on file', responsible: R.FRANCHISEE, offsetDays: 4 },
  { key: 'be-shareholder-agreement', title: 'Shareholder / members agreement in place', responsible: R.FRANCHISEE, offsetDays: 7 },
  { key: 'be-franchise-agreement-signed', title: 'Franchise agreement signed & countersigned', responsible: R.FRANCHISEE, offsetDays: 5 },
  { key: 'be-lease-signed', title: 'Premises lease agreement signed', responsible: R.FRANCHISEE, offsetDays: 7 },

  // --- Tax & statutory ---
  { key: 'be-income-tax-number', title: 'Company income tax number registered (SARS)', responsible: R.ACCOUNTANT, offsetDays: 7 },
  { key: 'be-vat-registration', title: 'VAT registration completed (SARS)', responsible: R.ACCOUNTANT, offsetDays: 10 },
  { key: 'be-paye-registration', title: 'PAYE / UIF / SDL registered (SARS)', responsible: R.ACCOUNTANT, offsetDays: 10 },
  { key: 'be-uif-dol', title: 'UIF registered with Department of Labour', responsible: R.HR, offsetDays: 12 },
  { key: 'be-coida', title: 'COIDA / Workmen’s Compensation registered', responsible: R.HR, offsetDays: 14 },
  { key: 'be-tax-clearance', title: 'Tax clearance / compliance status confirmed', responsible: R.ACCOUNTANT, offsetDays: 14 },

  // --- Banking & finance ---
  { key: 'be-business-bank-account', title: 'Business bank account opened', responsible: R.FRANCHISEE, offsetDays: 7 },
  { key: 'be-merchant-account', title: 'Card / merchant acquiring account set up', responsible: R.FRANCHISEE, offsetDays: 12 },
  { key: 'be-debit-order-mandates', title: 'Debit-order mandates set up (royalties, marketing levy)', responsible: R.ACCOUNTANT, offsetDays: 14 },
  { key: 'be-accounting-software', title: 'Accounting / bookkeeping software configured', responsible: R.ACCOUNTANT, offsetDays: 14 },
  { key: 'be-opening-float', title: 'Opening cash float arranged', responsible: R.FRANCHISEE, offsetDays: -3, anchor: 'open' },
  { key: 'be-cash-management', title: 'Cash management & banking procedure agreed', responsible: R.FRANCHISEE, offsetDays: -5, anchor: 'open' },

  // --- Insurance ---
  { key: 'be-public-liability', title: 'Public liability insurance in place', responsible: R.FRANCHISEE, offsetDays: 14 },
  { key: 'be-assets-insurance', title: 'Assets / contents insurance in place', responsible: R.FRANCHISEE, offsetDays: 14 },
  { key: 'be-business-interruption', title: 'Business interruption cover in place', responsible: R.FRANCHISEE, offsetDays: 16 },
  { key: 'be-employee-cover', title: 'Employee / group cover arranged (where applicable)', responsible: R.HR, offsetDays: 18 },

  // --- Licences & permits ---
  { key: 'be-business-licence', title: 'Business / trading licence obtained (local municipality)', responsible: R.FRANCHISEE, offsetDays: 18 },
  { key: 'be-coa', title: 'Certificate of Acceptability (food premises) obtained', responsible: R.FRANCHISEE, offsetDays: 20 },
  { key: 'be-health-inspection', title: 'Environmental Health inspection passed', responsible: R.FRANCHISEE, offsetDays: -10, anchor: 'open' },
  { key: 'be-fire-clearance', title: 'Fire clearance certificate obtained', responsible: R.FRANCHISEE, offsetDays: -10, anchor: 'open' },
  { key: 'be-signage-approval', title: 'Signage approval obtained (landlord + municipality)', responsible: R.FRANCHISEE, offsetDays: 18 },
  { key: 'be-music-licence', title: 'Music / SAMRO licence arranged', responsible: R.FRANCHISEE, offsetDays: 20 },

  // --- HR & payroll ---
  { key: 'be-hr-provider-appointed', title: 'HR / payroll provider appointed', responsible: R.FRANCHISEE, offsetDays: 5 },
  { key: 'be-payroll-setup', title: 'Payroll system set up & pay dates confirmed', responsible: R.HR, offsetDays: 16 },
  { key: 'be-employment-contracts-template', title: 'Compliant employment contract template in place', responsible: R.HR, offsetDays: 12 },
  { key: 'be-staff-policies', title: 'Staff policies & code of conduct issued', responsible: R.HR, offsetDays: 18 },
  { key: 'be-bcea-compliance', title: 'BCEA / sectoral determination compliance confirmed', responsible: R.HR, offsetDays: 18 },
  { key: 'be-staff-files', title: 'Staff files & onboarding documents prepared', responsible: R.HR, offsetDays: -14, anchor: 'open' },

  // --- Suppliers & operational accounts ---
  { key: 'be-supplier-accounts', title: 'Approved supplier accounts opened', responsible: R.FRANCHISEE, offsetDays: 18 },
  { key: 'be-coffee-supply', title: 'Coffee & core stock supply account confirmed', responsible: R.FRANCHISEE, offsetDays: 18 },
  { key: 'be-utilities-connected', title: 'Utilities (electricity / water) accounts active', responsible: R.FRANCHISEE, offsetDays: 20 },
  { key: 'be-waste-removal', title: 'Waste removal / refuse contract in place', responsible: R.FRANCHISEE, offsetDays: 20 },
  { key: 'be-pest-control', title: 'Pest control contract in place', responsible: R.FRANCHISEE, offsetDays: 22 },
  { key: 'be-internet-connectivity', title: 'Internet / connectivity installed & tested', responsible: R.FRANCHISEE, offsetDays: -14, anchor: 'open' },
  { key: 'be-telephone', title: 'Store telephone / contact number active', responsible: R.FRANCHISEE, offsetDays: -14, anchor: 'open' },

  // --- POS, systems & compliance ---
  { key: 'be-pos-account', title: 'POS system account requested & configured', responsible: R.FSM, offsetDays: -21, anchor: 'open' },
  { key: 'be-loyalty-setup', title: 'Loyalty / app integration set up', responsible: R.FSM, offsetDays: -14, anchor: 'open' },
  { key: 'be-menu-pricing-loaded', title: 'Menu & pricing loaded to POS', responsible: R.FSM, offsetDays: -10, anchor: 'open' },
  { key: 'be-uber-mrd-accounts', title: 'UberEats / Mr D delivery accounts registered', responsible: R.FRANCHISEE, offsetDays: -14, anchor: 'open' },
  { key: 'be-google-listing', title: 'Google Business listing created / claimed', responsible: R.FSM, offsetDays: -14, anchor: 'open' },
  { key: 'be-popia', title: 'POPIA compliance basics in place', responsible: R.FRANCHISEE, offsetDays: 22 },
  { key: 'be-first-aid', title: 'First-aid kit & OHS basics on site', responsible: R.FRANCHISEE, offsetDays: -10, anchor: 'open' },
  { key: 'be-emergency-contacts', title: 'Emergency contacts & escalation list posted', responsible: R.FRANCHISEE, offsetDays: -7, anchor: 'open' },
];

// ---------------------------------------------------------------------------
// STAGES 02–07 — (STUBS — expand from source docs, same pattern as Stage 01)
// ---------------------------------------------------------------------------
const STAGE_02_STEPS = [
  {
    key: 'offsite-training-signoff',
    title: 'Complete Off-Site Training & Sign-Off',
    description:
      'Franchisee completes Pre-Opening Franchisee Business Training and off-site sign-off forms are captured.',
    responsible: R.FRANCHISEE,
    sourceDoc: 'Off-Site Training Sign-Off Forms / Pre-Opening Franchisee Business Training',
    anchor: 'open',
    offsetDays: -35,
  },
  // TODO: expand Stage 02 once Off-Site Training docs are pulled.
];

const STAGE_03_STEPS = [
  {
    key: 'opening-order-placed',
    title: 'Place Opening Order per Opening Order Guide',
    description:
      'Compile and place the opening stock order using the Opening Order Guide quantities.',
    responsible: R.FSM,
    sourceDoc: 'Opening Order Guide',
    anchor: 'open',
    offsetDays: -14,
  },
  // TODO: expand Stage 03 once Opening Order Guide is pulled.
];

const STAGE_04_STEPS = [
  {
    key: 'site-handover-snag',
    title: 'Site Handover & Snag List completed',
    description:
      'Complete site handover, walk the snag list and confirm technology setup per the guides.',
    responsible: R.FSM,
    sourceDoc: 'Site Handover & Snag List / Technology Setup Guide',
    anchor: 'handover',
    offsetDays: 0,
  },
  // TODO: expand Stage 04 once Site Handover / Technology Setup docs are pulled.
];

const STAGE_05_STEPS = [
  {
    key: 'seven-day-onsite-readiness',
    title: '7-Day On-Site Training & Readiness completed',
    description:
      'Run the 7-Day On-Site Training template (Day 1–7 checklist) targeting ~95–100% completion per day.',
    responsible: R.FSM,
    sourceDoc: '7-Day On-Site Training Template',
    anchor: 'open',
    offsetDays: -7,
  },
  // TODO: expand Stage 05 into per-day (Day 1–7) checklist once template is pulled.
];

const STAGE_06_STEPS = [
  {
    key: 'opening-day-runsheet',
    title: 'Opening Day Run-Sheet executed',
    description:
      'Work the Opening Day Run-Sheet end-to-end on trading open day.',
    responsible: R.FSM,
    sourceDoc: 'Opening Day Run-Sheet',
    anchor: 'open',
    offsetDays: 0,
  },
  // TODO: expand Stage 06 once Opening Day Run-Sheet is pulled.
];

const STAGE_07_STEPS = [
  {
    key: 'ten-day-trading-tracker',
    title: '10-Day Trading Tracker & Roster in use',
    description:
      'Maintain the 10-Day Trading Tracker and 10-Day Roster through the first trading fortnight.',
    responsible: R.FSM,
    sourceDoc: '10-Day Trading Tracker / 10-Day Roster',
    anchor: 'open',
    offsetDays: 1,
  },
  {
    key: 'review-30day',
    title: '30-Day Review (30/60/90 framework)',
    description:
      'Complete the 30-day post-opening review per the 30/60/90-Day Review Framework.',
    responsible: R.REGIONAL_FM,
    sourceDoc: '30/60/90-Day Review Framework / Post-Opening FSM Framework',
    anchor: 'open',
    offsetDays: 30,
  },
  {
    key: 'project-signoff-4wk',
    title: 'Project sign-off & 4-week post-opening report',
    description:
      'Final project sign-off with the post-opening report & analysis (turnover, COS, labour, escalations).',
    responsible: R.REGIONAL_FM,
    sourceDoc: 'Post-Opening FSM Framework',
    anchor: 'open',
    offsetDays: 28,
  },
  // TODO: expand Stage 07 (Stock Take Guide, WhatsApp Reporting Templates, 60/90-day reviews).
];

// ---------------------------------------------------------------------------
// STAGE 08 — Reference & Standards  (reference-only, no checklist)
// ---------------------------------------------------------------------------
const STAGE_08_REFS = [
  {
    key: 'ref-brand-standards',
    title: 'Brand Standards Guide',
    description: 'Reference-only. Brand standards for the store to operate against.',
    responsible: R.HQ,
    sourceDoc: 'Brand Standards Guide',
    anchor: 'open',
    offsetDays: 0,
    isReference: true,
  },
  {
    key: 'ref-cos-benchmark',
    title: 'COS Benchmark Reference',
    description:
      'Reference-only. Cost-of-sales benchmarks. Escalation thresholds: COS above 34–35%, cash variance over R200/day, labour above 30% → mandatory escalation to Regional FM.',
    responsible: R.HQ,
    sourceDoc: 'COS Benchmark Reference',
    anchor: 'open',
    offsetDays: 0,
    isReference: true,
  },
];

// ---------------------------------------------------------------------------
// Assemble Stage 01 (helpers apply defaults to Business Essentials items)
// ---------------------------------------------------------------------------
function businessEssential(item) {
  return {
    key: item.key,
    title: item.title,
    description: item.description || 'Business Essentials Checklist item.',
    responsible: item.responsible,
    sourceDoc: item.sourceDoc || 'Business Essentials Checklist',
    anchor: item.anchor || 'created',
    offsetDays: item.offsetDays,
  };
}

const STAGE_01_STEPS = [
  ...STAGE_01_FSM_ACTIONS,
  ...STAGE_01_RECRUITMENT,
  ...BUSINESS_ESSENTIALS.map(businessEssential),
];

// ---------------------------------------------------------------------------
// STAGES — the exported workflow definition
// ---------------------------------------------------------------------------
const STAGES = [
  {
    id: '00',
    name: 'Welcome & Orientation',
    fsmRole: 'Onboard the franchisee and orient them to the journey.',
    concurrentWith: [],
    steps: STAGE_00_STEPS,
    complete: false, // stub — expand from source docs
  },
  {
    id: '01',
    name: 'Recruitment & Opening Admin',
    fsmRole: 'Drive all legal, financial, HR and recruitment admin to completion.',
    concurrentWith: ['02'],
    steps: STAGE_01_STEPS,
    complete: true,
  },
  {
    id: '02',
    name: 'Off-Site Training',
    fsmRole: 'Ensure franchisee completes pre-opening off-site training.',
    concurrentWith: ['01'],
    steps: STAGE_02_STEPS,
    complete: false,
  },
  {
    id: '03',
    name: 'Ordering & Stock',
    fsmRole: 'Compile and place the opening stock order.',
    concurrentWith: [],
    steps: STAGE_03_STEPS,
    complete: false,
  },
  {
    id: '04',
    name: 'Site & Technology Setup',
    fsmRole: 'Complete site handover, snag list and technology setup.',
    concurrentWith: [],
    steps: STAGE_04_STEPS,
    complete: false,
  },
  {
    id: '05',
    name: '7-Day On-Site Readiness',
    fsmRole: 'Run the 7-day on-site training and readiness checklist.',
    concurrentWith: [],
    steps: STAGE_05_STEPS,
    complete: false,
  },
  {
    id: '06',
    name: 'Opening Day',
    fsmRole: 'Execute the opening day run-sheet.',
    concurrentWith: [],
    steps: STAGE_06_STEPS,
    complete: false,
  },
  {
    id: '07',
    name: 'Post-Opening Operations',
    fsmRole: 'Track first-fortnight trading and run 30/60/90 reviews to project sign-off.',
    concurrentWith: [],
    steps: STAGE_07_STEPS,
    complete: false,
  },
  {
    id: '08',
    name: 'Reference & Standards',
    fsmRole: 'Reference-only standards the store operates against.',
    concurrentWith: [],
    steps: STAGE_08_REFS,
    complete: true,
    referenceOnly: true,
  },
];

// Escalation thresholds (Stage 07 alerting — build into notifications later).
const ESCALATION_THRESHOLDS = {
  cosPctMax: 35, // COS above 34–35%
  cashVarianceRandPerDayMax: 200, // cash variance over R200/day
  labourPctMax: 30, // labour above 30%
};

const TEMPLATE_VERSION = 'v1.0';

// Flatten helper: yields every step with its stage id attached, in order.
function allStepTemplates() {
  const out = [];
  let sort = 0;
  for (const stage of STAGES) {
    for (const step of stage.steps) {
      out.push({ ...step, stageId: stage.id, sortOrder: sort++ });
    }
  }
  return out;
}

module.exports = {
  R,
  STAGES,
  ESCALATION_THRESHOLDS,
  TEMPLATE_VERSION,
  allStepTemplates,
};
