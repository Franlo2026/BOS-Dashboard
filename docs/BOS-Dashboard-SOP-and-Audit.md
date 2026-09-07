# BOS Dashboard — SOP Manual & Data Audit

**Bootlegger Operating System (BOS) — Franchise Operations Dashboard**

This document has two parts:

- **Part A — SOP / User Manual:** how to log in, how to get around, and what every
  tab and section does (including *where each screen's data comes from*). Written
  for a brand-new user.
- **Part B — Audit: Risk & Data-Quality Register + Recommendations:** where data is
  stuck, stale, duplicated or mislabelled, and the better ways to pull it.

| | |
|---|---|
| **Live app** | https://bos-dashboard-production.up.railway.app |
| **Stack** | Node.js + Express, PostgreSQL, JWT auth, hosted on Railway (GitHub → auto-deploy) |
| **Repo** | github.com/Franlo2026/BOS-Dashboard |
| **Audit date** | September 2026 |

---

# PART A — SOP / USER MANUAL

## A1. Logging in & roles

1. Open the live app and sign in with your username + password (Sign In screen).
2. Your **role** decides what you can do (set by an Admin):
   - **viewer** — read-only ("mirror" access). Can see everything, change nothing.
   - **editor** — can log visits, add/edit/close tasks, upload data, etc.
   - **admin** — everything editors can do **plus** the Admin tab (user management + data uploads).
3. Sessions last **12 hours**, then you re-login.

> Tabs you don't have rights for are hidden automatically (e.g. **Admin** shows only for admins; **+ Log Café Visit** only for editors).

## A2. Getting around — the app map

BOS is a single-page app with a **Home hub** and a **tab bar** across the top. Some
tabs open **separate pages** (they navigate away and back). Here is the full map:

| Tab (label) | Opens | What it is | Who |
|---|---|---|---|
| **⌂ Home** | in-app hub | Launcher tiles to every tool, grouped Quick Access / More Tools / Admin | all |
| **Dashboard** | in-app | Executive KPI overview across the "five pillars" | all |
| **+ Log Café Visit** | `log-support-visit.html` | GRIND café support-visit form | editor |
| **Tasks** | in-app | The task tracker (issues + non-conformances) | all (edit=editor) |
| **Visit Reports** | in-app | Registry of submitted visit/trainer reports | all |
| **LTL Audits** | in-app | Looks-Tastes-Like brand-standards audits | all (upload=editor) |
| **B-Better** | in-app | Beeline training completion % per store | all (upload=editor) |
| **Trade** | in-app | Deep per-store turnover / SPI / invoices | all |
| **Flow** | in-app | KeyTech "% met recipe" per store | all (upload=editor) |
| **Weekly Report** | in-app | GRIND weekly report composer (per FSM) | all |
| **Print View** | in-app | One-page printable network scorecard | all |
| **+ Add Task** | in-app | Report an operational issue per café | all |
| **New Cafes** | `new-cafe-ops.html` | New-store opening pipeline (CPA, training) | all (edit=editor) |
| **Regional Report** | in-app | Printable per-manager + national report | all |
| **Cafe Overview** | in-app | Café directory: contacts, site info, hours | all |
| **Cafe Status** | in-app | Per-café operational health (turnover, COS, Google, CSPI, Flow, training, tasks) | all |
| **Team Scheduler** | `scheduler.html` | Support-visit schedule generator | all (edit=editor) |
| **Marketing Tracker** | external app | Single-sign-on jump to the Marketing Tracker | all |
| **Admin** | in-app | User management + data uploads | admin |

**Separate forms/pages reached from the above** (not their own tab): the
Non-Conformance letter generator (`non-conformance-notice.html`), the public New-Café
Submission intake (`new-cafe-submission.html`), and the Email Automation control panel
(`email-admin.html`).

## A3. Where the numbers come from (data-source legend)

Every screen in Part A is tagged with one or more of these source codes. Read this once
and the rest of the manual is self-explanatory.

| Code | Meaning | Freshness |
|---|---|---|
| **[BQ-auto]** | Live daily pull from the Silo Data Platform (BigQuery) → written to the database → shown in the app | **Automatic, daily** |
| **[DB]** | Operational records you create in BOS, stored in PostgreSQL, read via the API | **Live** |
| **[Upload]** | A dataset an admin uploads (CSV/Excel) in the Admin tab; stored in the database as an override | **As often as someone uploads** |
| **[Embedded]** | Baked into the page itself; only changes when the site is redeployed | **Frozen until a code deploy** |
| **[Ref]** | The shared roster/reference (FSMs, area managers, name aliases) read from the server | **Live** |

Which datasets are which:

- **[BQ-auto]:** Turnover (`TURNOVER_DATA`, the MTD / last-month / FYTD figures) and the
  monthly turnover history (`MONTHLY_TRADE_DATA`). Both refresh every day from Silo and can
  also be force-refreshed by a manual upload.
- **[DB]:** Visits, tasks/actions, LTL audits, trainer visits, ops-tasks, café-status checklists.
- **[Upload]:** B-Better %, Flow/KeyTech %, Google ratings, CSPI. *(Two of these have a
  quirk — see Part B — but from the user's point of view they're "upload" data.)*
- **[Embedded]:** Cost-of-Sales / FC% (`FC_DATA`), Budgets (`BUDGET_DATA`), the equipment
  servicing schedule, and the base café directory. **These do not refresh on their own.**
- **[Ref]:** The FSM→store roster, manager→FSM map, and name aliases.

## A4. Tab-by-tab reference

Each entry: **what it's focused on**, **what you do**, **where the data pulls from**, and
**where it links to**.

### Home  ⌂
- **Focus:** A launcher. Greets you by name and shows tiles for every tool.
- **You do:** Click a tile to open a tool.
- **Data:** None (it's navigation). [Ref] only, to know which tiles you're allowed to see.
- **Links:** To every other tab/page; the **Marketing Tracker** tile signs you into that
  separate app.

### Dashboard
- **Focus:** The executive scorecard — a strip of KPI cards across the five pillars
  (Grow / Retain / Improve / Nurture / Deliver), per-FSM scorecards, and a "needs attention"
  list.
- **You do:** Pick **All Teams** or a manager's team; optionally set a date range (only
  affects Visit Frequency & Task Closure); click any KPI card to drill into the stores behind it.
- **Data:** Trade Health [BQ-auto]; Budget [BQ-auto turnover ÷ Embedded budget]; Flow/Recipe
  [Upload — KeyTech]; CSPI, Google, Mystery Diner [Upload]; B-Better [Upload]; Visit
  Frequency / Tasks / LTL [DB]; Servicing [Embedded]; "Cafés Opening" pipeline [DB storage].
- **Links:** KPI cards open in-page drilldowns; the **Cafés Opening** card jumps to New Cafes.

### Tasks  (the task tracker)
- **Focus:** Every open/closed/escalated task and non-conformance, from two sources combined:
  issues raised on visit reports **and** ops-tasks logged via *+ Add Task*.
- **You do:** Filter (FSM, pillar/department, status, region, date, search); triage; edit;
  comment; escalate; extend due dates; complete/reopen; export CSV/PDF. Sub-tabs: **Open /
  Completed / Escalations / Non-Conformances**.
- **Data:** [DB] — visit-derived actions (`/api/state`) **merged** with ops-tasks
  (`/api/ops-tasks`).
- **Links:** "Edit" on a visit-derived task and the email buttons; no tab navigation.

### + Add Task
- **Focus:** The public issue-reporting form — anyone signed in can log an operational issue
  against a café.
- **You do:** Pick department + café (must match a real café or "HQ Internal"), reporter,
  responsible person, escalation timeframe, comments, up to 6 photos, non-conformance flag,
  Submit. Editors can mark tasks complete from the table below.
- **Data:** [DB] `/api/ops-tasks`. Café list + departments + timeframes are [Embedded] config.
- **Links:** Tasks created here appear in the **Tasks** tab.

### Visit Reports
- **Focus:** A registry of every submitted GRIND support summary and trainer visit.
- **You do:** Search/filter (**Open Jobs / Archived**), open a printable PDF, edit, archive/
  restore, or delete.
- **Data:** [DB] `/api/state` (visits + linked actions). Archive state stored as an override.
- **Links:** "Edit" opens the **Log Café Visit** form pre-loaded; "View/PDF" opens a print window.

### LTL Audits
- **Focus:** Looks-Tastes-Like brand-standards audit scores — per-FSM averages, aged
  non-conformances, at-risk stores, full history.
- **You do:** Review; upload a CSV of audits (editor). At-risk threshold is **<85%**.
- **Data:** [DB] `/api/state` LTL audits (also fed by admin ECAS/LTL uploads, which post to the
  same store).
- **Links:** Email buttons on at-risk rows.

### B-Better
- **Focus:** Beeline **learning completion %** per store, ranked by FSM, with a flagged
  "<80%" list. Target ≥80%.
- **You do:** Review; upload a CSV `store,score` (editor).
- **Data:** [Upload] — this tab reads the **`bbetter-overrides`** dataset (see Part B: it is a
  *different* upload path from the "B.Better" card in Admin).

### Trade
- **Focus:** Deep per-store turnover. Brand overview (Current-month MTD / previous full month /
  YTD), a custom month-range comparison, turnover by region, and an expandable per-store table
  (turnover, SPI, invoices vs prior month / YoY / YTD / format average).
- **You do:** Pick a reporting month; filter by format/FSM/region; expand a store; Save PDF.
- **Data:** [BQ-auto] — `TURNOVER_DATA`, `MONTHLY_TRADE_DATA`, `BRAND_AVGS`; budget lines use
  [Embedded] budgets.
- **Links:** None (self-contained; PDF via print).

### Flow
- **Focus:** KeyTech **"% met recipe"** per store, ranked by FSM. Target ≥80%.
- **You do:** Review; upload a CSV `store,score` (editor).
- **Data:** [Upload] — reads the **`keytech-overrides`** dataset (again, a *different* path
  from the "Flow" card in Admin — see Part B).

### Weekly Report
- **Focus:** Auto-drafts a GRIND weekly report (Greet / Read / Inspect / Numbers / Drive) for
  an FSM, pre-filled from their portfolio.
- **You do:** Pick an FSM, edit the five sections, **Copy** the text (intended: Fridays to
  Tarryn/Franlo). Read-only — nothing is saved.
- **Data:** Derived from trade/standards/B-Better [BQ-auto + Upload] plus this-week visits/tasks
  [DB].

### Print View
- **Focus:** A one-page printable network scorecard: five network KPIs + a per-FSM card.
- **You do:** Print / Save as PDF. Read-only.
- **Data:** Derived KPI helpers over the same trade/standards/B-Better/visit/action data.

### New Cafes
- **Focus:** The new-store opening pipeline — CPA milestones, training calendars, B-Better
  onboarding, and add/approve new cafés.
- **You do:** Track openings; confirm CPA milestones; upload the Beeline Groups Report for new
  cafés; add a café & generate its CPA timeline (editor); approve pending submissions. Sub-tabs:
  **Active / Archive / Pending Requests.**
- **Data:** [DB storage] pipeline records (CPA confirmations, training calendars, allocations,
  submissions, store details); first-run defaults are [Embedded] seeds.
- **Links:** The tab shares its data with the standalone `new-cafe-ops.html` page; pending
  requests come from `new-cafe-submission.html`.

### Regional Report
- **Focus:** A printable management report — one section per manager team plus a National
  rollup: turnover by region, budget variance, top at-risk stores, ops KPIs, tasks, and the new-café
  pipeline.
- **You do:** Set a date range (affects only Café Visits & Tasks) and Print.
- **Data:** Turnover/at-risk [BQ-auto monthly]; budget [BQ-auto ÷ Embedded]; KPIs [Upload + DB];
  franchisee meetings [DB storage from the Scheduler].

### Cafe Overview
- **Focus:** The café **directory** — contacts, site info, amenities, trading hours (no KPIs).
- **You do:** Search/filter; expand a café; multi-select and export a PDF; send an update email.
- **Data:** [Embedded] store-master fields (name, region, FSM, mall, address, contacts, hours,
  amenities).
- **Note:** This is the in-app **directory** view. There is *also* a separate standalone page
  called `cafe-overview.html` (see A5) that shows café *metrics* — do not confuse the two.

### Cafe Status
- **Focus:** The per-café **operational health** report, one café at a time: turnover vs LY,
  budget, equipment servicing, cost-of-sales FC%, Google, CSPI, Flow, training, and open tasks.
- **You do:** Filter; pick a month; expand a café; print or email that café's report; mark
  equipment serviced.
- **Data:** Turnover [BQ-auto]; budget [BQ-auto ÷ Embedded]; **FC% / Cost-of-Sales [Embedded]**;
  Google, CSPI, Flow, B-Better [Upload]; servicing [Embedded]; tasks [DB].
- *(This is the screen where the "Sep MTD = R0" issue was fixed — turnover now reads the live
  monthly data.)*

### Team Scheduler  (separate page)
- **Focus:** Generates the rotating support-visit schedule (who visits which café, when) and
  manages new-café opening support.
- **You do:** View monthly schedule; confirm/reschedule visits; manage opening support.
- **Data:** Live roster from [Ref]; schedule state in [DB storage]. Its base café list is
  [Embedded] (see Part B — drift risk).

### Marketing Tracker
- A single-sign-on jump to the separate Marketing Tracker app (no data shown in BOS).

### Admin  (admins only)
- **Focus:** Two things — **User Management** and **Data Uploads**.
- **User Management:** add users, set roles, enable/disable, reset passwords, fix display names.
- **Data Uploads:** upload the six datasets — **Trade/Turnover (Silo), LTL Audits, B.Better
  Training, Flow (Recipe & Cleaning), Social/Google Places, CSPI.** Each card shows a
  "Last updated … by …" stamp.
- **Data:** [DB] users; uploads write the [Upload]/[BQ-auto] datasets.
- **Note:** The Turnover card is now fed automatically every day from Silo/BigQuery; a manual
  upload there is only an override that the next daily refresh replaces.

## A5. Auxiliary pages / forms

| Page | What it's for | Data source |
|---|---|---|
| **log-support-visit.html** | The GRIND café support-visit form FSMs fill in-store (and an "FSM only" status check). Saves the visit to the tracker. | FSM/store lists from [Ref]; saves visits to [DB]; per-day draft autosave to storage. |
| **non-conformance-notice.html** | Generates a formatted franchise breach / non-conformance letter (can auto-draft from raw notes via AI) and optionally logs it as a task. | Clause library [Embedded]; store list from [Ref]; logs to [DB] `/api/ops-tasks`. |
| **new-cafe-ops.html** | Full new-café opening pipeline manager (CPA timeline, training, franchisee details, checklists, submission queue). Same live data as the **New Cafes** tab. | [DB storage] keys shared with the app; [Embedded] first-run seeds. |
| **new-cafe-submission.html** | A **public** (URL-key-gated) CSV intake form for the New Business team to submit a new café for approval. | Client-side CSV parse; posts to `/api/public/cafe-submissions`. |
| **email-admin.html** | Admin panel to turn the four recurring email digests on/off and run safe (redirected) test sends. | Fully server-driven (`/api/email/*`). The cleanest page — no embedded data. |
| **scheduler.html** | See **Team Scheduler** above. | [Ref] + [DB storage]; base café list [Embedded]. |
| **cafe-overview.html** (standalone) | A per-café metrics board + editable in-store support checklist. **Separate from the in-app "Cafe Overview" tab.** | ⚠️ Carries its **own frozen copies** of turnover/Google/Flow/B-Better/CSPI with **no live refresh** — see Part B (highest-priority issue). Checklist saves to [DB] `/api/cafe-status`. |

## A6. Common workflows (quick recipes)

- **Log a café visit:** Home or tab → **+ Log Café Visit** → fill GRIND form → Submit → it
  appears in **Visit Reports**, and any actions appear in **Tasks**.
- **Report an issue:** **+ Add Task** → pick café + department + timeframe → Submit → track it
  in **Tasks**.
- **Refresh turnover now:** Turnover refreshes automatically daily. To force it, an admin
  re-uploads a Silo CSV in **Admin → Data Uploads → Trade/Turnover** *(there is no one-click
  "refresh" button yet — see Part B)*.
- **Weekly report:** **Weekly Report** → pick your FSM → edit the pre-filled draft → Copy → send.
- **Onboard a new café:** submit via `new-cafe-submission.html` → approve in **New Cafes →
  Pending Requests** → the CPA timeline generates from the opening date.
- **Check one café end-to-end:** **Cafe Status** → search the café → expand → read turnover,
  budget, FC%, Google, CSPI, Flow, training, tasks; print or email the report.

---

# PART B — AUDIT: RISK & DATA-QUALITY REGISTER + RECOMMENDATIONS

## B1. Severity-ranked findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **`cafe-overview.html` (standalone) shows frozen metrics** — its own embedded `TURNOVER_DATA`/`GOOGLE`/`FLOW`/`BB`/`CSPI` never refresh from the server | 🔴 High | cafe-overview.html |
| 2 | **Café directory / FSM roster is duplicated 3+ times and already disagrees** (e.g. Kenilworth FSM = "Tristan Smith" on one page, "Raabia Isaacs" on another) | 🔴 High | index / cafe-overview / scheduler / new-cafe-ops |
| 3 | **Cost-of-Sales (FC%) and Budgets are Embedded-only** — never refresh; fields still named `fc_may`, labelled "Latest Month" | 🟠 Medium-High | Cafe Status, Regional Report |
| 4 | **Two parallel upload paths for Flow & B-Better** — the tabs read `keytech-overrides`/`bbetter-overrides`; the Admin cards write `bos-upload-data-flow`/`-bbetter`. They can disagree | 🟠 Medium-High | Flow tab, B-Better tab, Admin |
| 5 | **Frozen month labels/field-names sit on top of live data** — "July/Mar–Jul" budget rows, Regional Report "Jul" headers, `google_jul`/`mysteryDiner_jul`, Flow "May 2026", B-Better "June 2026", `YTD_MONTHS_ELAPSED=4`, hardcoded nav date | 🟠 Medium | Dashboard, Trade, Regional Report, Cafe Status |
| 6 | **Manual-upload datasets could be auto-pulled** — Google ratings, CSPI, Flow, B-Better all depend on someone remembering to upload | 🟠 Medium | Admin uploads |
| 7 | **No in-UI "Run Silo refresh" button** — the endpoint exists but isn't wired to a control | 🟡 Low-Med | Admin |
| 8 | **Dead admin panels in Visit Reports** — the "empty reports" and "duplicate reports" finders are coded but never mounted, so they never appear | 🟡 Low | Visit Reports |
| 9 | **Leftover Supabase URL + anon key** embedded in `cafe-overview.html` (superseded by `/api/cafe-status`) | 🟡 Low (security/cleanup) | cafe-overview.html |
| 10 | **`OT_PEOPLE_LIST` in new-cafe-ops contains placeholders/duplicates** ("FSM 2", "FSM 3", names listed twice) | 🟡 Low | new-cafe-ops.html |
| 11 | **Public submission form gated only by a `?key=` URL param** | 🟡 Low (security) | new-cafe-submission.html |

## B2. Findings in detail

### Theme 1 — Stale / frozen data sources
- **`cafe-overview.html` (standalone metrics board)** is the biggest issue: it holds hardcoded
  `TURNOVER_DATA`, `GOOGLE_DATA`, `FLOW_DATA`, `BB_DATA`, `CSPI_DATA` and **never calls the
  server override path** the main app uses. Its numbers (and its embedded FSM roster) are frozen
  at the last redeploy — it even still shows departed FSMs. Anyone using this page sees
  month-old data presented as current.
- **`FC_DATA` (Cost of Sales / FC%) and `BUDGET_DATA`** are embedded in the main app and only
  change on a code deploy. Field names (`fc_may`, `brand_avg_may`) are baked to a past month even
  though the label reads "Latest Month".
- The **equipment-servicing schedule** and the **base café directory** are also embedded (the
  directory is partly patched live by `dashboard-stores-v1`, but the base is frozen).

### Theme 2 — Duplicated data / drift
- The café list / FSM roster exists as **at least three independent hardcoded copies** —
  `cafe-overview.html` `STORES`, `scheduler.html` `SITES`, `new-cafe-ops.html` seeds — plus the
  **live** source (`/api/reference-data`). They already disagree on FSM assignments today.
- Some pages (scheduler, log-support-visit, non-conformance) correctly rebuild from the live
  roster; others (cafe-overview) do not.

### Theme 3 — Two upload mechanisms for the same metric
- **Flow** and **B-Better** each have *two* data paths: the dedicated tab reads
  `keytech-overrides` / `bbetter-overrides` (older CSV `store,score` upload), while the **Admin →
  Data Uploads** cards write `bos-upload-data-flow` / `bos-upload-data-bbetter` (consumed by Cafe
  Status). Uploading in one place does not update the other — a classic drift trap.

### Theme 4 — Hardcoded labels & field names
- Budget rows hardcode "July" / "YTD (Mar–Jul)"; Regional Report headers read "Jul"; Dashboard
  drilldowns read `google_jul` / `mysteryDiner_jul`; Trade uses `YTD_MONTHS_ELAPSED = 4` and
  "vs Jul 2025 MTD"; Flow says "May 2026", B-Better "June 2026"; the nav bar shows a hardcoded
  "GAAP JUL 2026 · KEYTECH MAY 2026 · BEELINE JUN 2026". The *values* are often live, so the
  **label and the number can disagree** — confusing and error-prone. (The Cafe Status turnover
  block and `MONTHLY_TRADE_MONTHS` are already self-healing after the recent turnover work — good
  models to copy.)

### Theme 5 — Dead code / data hygiene
- Visit Reports' empty/duplicate finders are never mounted (admins can't use them).
- `OT_PEOPLE_LIST` has placeholder "FSM 2"/"FSM 3" and duplicate names.
- `renderCOSSection` is defined twice in cafe-overview.html.

### Theme 6 — Security / cleanup
- A live-looking **Supabase anon key + URL** remain embedded in `cafe-overview.html` even though
  it was migrated to `/api/cafe-status`. Remove the dead code and rotate the key.
- The public submission form is gated only by a URL `?key=` — acceptable for low-risk intake but
  worth a stronger token if it ever collects sensitive data.

## B3. Better data-pull methods (recommendations)

**Principle:** the turnover work already proved the right pattern — *pull from source on the
server, write to the database, let every screen read one live copy.* Extend that pattern:

1. **Point `cafe-overview.html` at the live server data** (or retire it in favour of the in-app
   **Cafe Status** tab). Highest impact, removes the worst staleness. *(Quick win: even just
   wiring it to `/api/storage/bos-upload-data-*` like the main app.)*
2. **Single-source the café directory & roster.** Make every page read `/api/reference-data` +
   `dashboard-stores-v1` (as the scheduler already partly does); delete the hardcoded `STORES`/
   `SITES` copies. Removes the FSM-drift class of bugs. *(This is also what the Cortado
   integration would benefit from — a single merged `/api/integration/stores` endpoint.)*
3. **Auto-refresh the remaining metrics from source**, the same way turnover now works:
   - **B-Better** → pull from the **Beeline** workspace (a live connector already exists) instead
     of manual Groups-report uploads.
   - **Google ratings** → pull from the Google Places API on a schedule.
   - **Flow / recipe %** → pull from KeyTech if it has an API/export endpoint.
   - **Cost of Sales (FC%)** → pull from Silo `cos_daily` (same BigQuery source as turnover).
   - **Budgets** → pull from Silo `reference.budget_input`.
   - **CSPI** stays manual (it's a monthly PDF), but store month-stamped so the rolling window
     advances on its own.
4. **Collapse the two Flow/B-Better upload paths into one** (pick `bos-upload-data-*` and make the
   tabs read it) so there's a single source of truth per metric.
5. **Make every month label dynamic** (compute from today's date, like the turnover fix did).
   Replace `fc_may`, `*_jul`, `YTD_MONTHS_ELAPSED=4`, and the hardcoded nav date with computed
   values. Eliminates label-vs-data mismatches for good.
6. **Add a one-click "Refresh from Silo now"** button in Admin (the `/api/admin/run-silo-refresh`
   endpoint already exists — it just needs a button), plus surface each dataset's "last updated"
   and an "auto vs manual" badge so users can see freshness at a glance.
7. **Housekeeping:** mount or delete the Visit Reports cleanup panels; de-duplicate
   `OT_PEOPLE_LIST` and `renderCOSSection`; remove the Supabase credentials from
   `cafe-overview.html` and rotate the key.

## B4. Suggested sequencing

| Priority | Item | Effort |
|---|---|---|
| **Now (quick wins)** | Remove Supabase key (#9); de-dupe `OT_PEOPLE_LIST` (#10); mount/delete dead panels (#8); add the "Run Silo refresh" button (#7) | Small |
| **Next** | Single-source the directory/roster (#2); collapse Flow/B-Better upload paths (#4); make month labels dynamic (#5) | Medium |
| **Then** | Wire/retire `cafe-overview.html` to live data (#1); auto-refresh FC%, Budgets from Silo (#3) | Medium |
| **Larger** | Auto-refresh B-Better (Beeline), Google (Places API), Flow (KeyTech) (#6); month-stamp CSPI | Larger |

---

*Prepared as a full audit + SOP of the BOS Dashboard. Part A is safe to share with new users.
Part B is aimed at whoever maintains BOS. The turnover / monthly-turnover pipeline described as
"live from BigQuery" reflects the September 2026 fixes; the embedded datasets (FC%, budgets,
café-overview metrics) remain the main outstanding staleness targets.*
