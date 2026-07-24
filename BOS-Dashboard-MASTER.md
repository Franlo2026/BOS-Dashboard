# BOS Dashboard — Master Project Reference
*Consolidated from all project chats + repo `CLAUDE.md` · compiled 24 July 2026*

This is the single reference for the BOS Dashboard project — merging the
narrative history/feature log from every past chat with the technical
architecture reference (`CLAUDE.md`) that previously lived only in the repo.
Use this as the starting point for planning new work. **Copy this file over
`CLAUDE.md` in the repo root** so both Claude.ai and Claude Code read from the
same source going forward.

---

## 1. What BOS Is

**BOS** ("Bootlegger Operating System") is the single landing page / login for
all Bootlegger Coffee Company internal dashboards — one login, role-based
access, one Postgres database, one Railway deployment. It absorbed several
previously-separate tools over time (Ops Task Tracker, Opening Timelines, Cafe
Overview — formerly its own Supabase project) into this one app, and continues
to grow (Scheduler, Support Schedule, GRIND visit reporting, New Café
submission, Trade View).

- **Live URL:** `bos-dashboard-production.up.railway.app` (port 8080)
- **Repo:** `Franlo2026/BOS-Dashboard` (GitHub, private — contains live
  GAAP/KeyTech figures and full store/contact list)
- **Railway service:** `BOS-Dashboard`; database: Postgres (separate service,
  same project); private networking via `bos-dashboard.railway.internal`
- **Runtime:** Node.js ≥18, Express
- **Deploy pipeline:** GitHub `main` → Railway auto-deploy, ~60–90s, zero
  downtime
- **Owner/operator:** Franlo Geldenhuys (regional lead, non-technical, relies
  on Claude for all implementation — copy-paste PowerShell/Git and file
  deploys)
- **Co-administrator:** Tarryn Palmer (manages Gauteng FSM team; shares
  exclusive Scheduler franchisee-meeting access with Franlo)

---

## 2. People & Org Structure

| Group | Members |
|---|---|
| **Leadership** | Franlo Geldenhuys (WC/EC/Namibia), Tarryn Palmer (Gauteng + inland) |
| **FSMs** | Charlene van Heerden, Liam Smith, Tristan Smith (moved FSM → WC Support), Nicolene Prinsloo, Sipho Mabaso, Washington Dhliwayo, Tshepo Goqo, Raabia Isaacs (32 stores, added as full FSM) |
| **WC Support Team** | Tristan Smith, Aphiwe Mqakayi *(Addright Chigama explicitly removed from all rosters)* |
| **Gauteng Support Team** | Tshepo Goqo, Sihle/Siphesihle Gwadela, Mini Mohale, Johannes Moloto |
| **Other support referenced in scheduling logic** | Raabia Isaacs, Charlene, Liam, Nicolene, Sipho, Washington Dhliwayo |

`OT_PEOPLE_LIST` (used in New Cafés support-allocation chip picker) = all FSMs
+ support team + Franlo + Tarryn, alphabetically combined.

**Roster history notes:**
- Brent Fredericks → renamed to Tristan Smith (kept his 29-store portfolio)
- Washington Nkosi was a duplicate of Washington Dhliwayo → removed
- Tshepo Goqo and Raabia Isaacs added as *new* FSMs, not replacements
- Addright Chigama fully removed as of the July 22 session

---

## 3. Infrastructure

| | |
|---|---|
| GitHub repo | `Franlo2026/BOS-Dashboard` (private) |
| Railway service | `BOS-Dashboard` |
| Railway database | Postgres (separate service, same project) |
| Public URL | `bos-dashboard-production.up.railway.app` (port 8080) |
| Private networking | `bos-dashboard.railway.internal` |
| Runtime | Node.js ≥18, Express |
| Photo/file storage | Railway Volume, mounted at `/data` (NOT the database) |
| Data connector | Silo Data Platform (BigQuery warehouse) for live turnover/COS/budget |
| Auth | JWT-based sessions |

### Project structure
```
bos-dashboard/
├── src/
│   └── server.js               Express API + auth + Postgres
├── public/
│   ├── index.html               Main SPA — login + all in-page tabs
│   ├── cafe-overview.html       Cafe Overview — own page, shares BOS session
│   ├── scheduler.html           Team Scheduler — own page, shares BOS session (React/Babel-in-browser)
│   ├── support-schedule.html    Standalone Weekly Schedule / Café Directory / Franchisee Directory tool
│   ├── log-support-visit.html   GRIND Café Support Summary field report
│   ├── new-cafe-submission.html External New Café intake form (New Business Team)
│   └── vendor/                  Locally-vendored React, ReactDOM, Babel standalone, SheetJS
├── migrate-cafe-status.js       One-off Supabase CSV → Postgres importer
├── cafe_status_rows.csv         Bundled Supabase export for the import
├── package.json
├── railway.toml
├── README.md                    Full human-readable doc
└── CLAUDE.md                    This file
```

### Why `public/vendor/*.js` exists
`scheduler.html` and the New Cafés B.Better tab originally loaded React,
ReactDOM, Babel, and SheetJS from CDNs (`unpkg.com`). The Babel CDN dependency
caused repeatable load failures, so all four were vendored locally into
`public/vendor/` to remove the CDN dependency entirely.

### Known env var issue
> ⚠️ **`JWT_SECRET` (found 2026-07-10):** was set to the literal text of a
> PowerShell one-liner instead of its evaluated output — i.e. the signing
> secret was a fixed, guessable string, not a random one. Fix by letting
> PowerShell evaluate the `$(...)` part first:
> ```powershell
> railway variables --set "JWT_SECRET=$([Convert]::ToBase64String((1..32|%{Get-Random -Max 256})))"
> ```
> Then redeploy so the app picks up the new value. **This invalidates all
> existing sessions** — everyone has to log in again (expected). Worth
> spot-checking any other secret-style env vars for the same mistake.

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Long random string (`openssl rand -base64 32`) |
| `ADMIN_USERNAME` | Only used on first boot (empty `users` table) |
| `ADMIN_PASSWORD` | Temporary — change immediately after first login |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Auto-set by Railway's Postgres service — don't set manually |
| `PORT` | Auto-set by Railway — don't set manually |
| `UPLOAD_DIR` | Defaults to `/data/uploads` |

---

## 4. File Map

| File | Purpose |
|---|---|
| `public/index.html` | Main BOS Dashboard SPA — tabs: Team OKRs (formerly "Dashboard"), New Cafés/Opening Timelines, Task Tracker, Visit Reports, LTL Audit, Trade View, Admin |
| `public/cafe-overview.html` | Per-café profile pages — turnover, Flow/KeyTech scores, Google ratings, CSPI, franchisee/GM info, PDF/Excel export, report-builder view |
| `public/log-support-visit.html` | GRIND Café Support Summary — field visit report FSMs fill out in-café |
| `public/new-cafe-submission.html` | External New Café intake form for the New Business Team (CSV upload) |
| `public/scheduler.html` | Team Scheduler — React/Babel-in-browser, Master Route Grid + legacy admin schedule + Franchisee Visits + Overdue + All Sites |
| `public/support-schedule.html` | Standalone Task-Tracker-styled tool: Weekly Schedule / Café Directory / Franchisee Directory tabs |
| `public/vendor/*.js` | Locally-bundled React, ReactDOM, Babel standalone, SheetJS |
| `src/server.js` | Express API — auth, Postgres queries, photo storage, generic key/value storage endpoint, file upload endpoint |
| `migrate-cafe-status.js` | One-off Supabase → Postgres importer for `cafe_status` (safe to re-run — upserts on `store_key`) |
| `CLAUDE.md` | This file — architecture + session history, kept in repo root |

### Which file to edit for what

| Change | File |
|---|---|
| Store list, GAAP/KeyTech/Beeline figures, in-page tabs, Task Tracker, Trade View | `public/index.html` |
| Café checklist items, scoring logic, store master list, CSPI | `public/cafe-overview.html` |
| Route/visit planner, franchisee list/logic | `public/scheduler.html` |
| Weekly support schedule, café/franchisee directories | `public/support-schedule.html` |
| GRIND field visit report, PDF export | `public/log-support-visit.html` |
| Login logic, roles, API behaviour, DB schema | `src/server.js` |
| New npm package | `package.json` (run `npm install` locally first) |
| Railway build/start settings | `railway.toml` |

---

## 5. Access Model — one login, three roles

| Role | View all tabs/pages | Log visits / close actions / log audits / edit Cafe Overview | Manage users |
|---|:---:|:---:|:---:|
| Admin | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ |
| Viewer | ✅ | ❌ (blocked client + server-side) | ❌ |

Applies uniformly across every in-page tab and both standalone pages.
Task creation in the Task Tracker is open to **any** signed-in role;
completing a task requires editor/admin.

**Franchisee-meeting restriction (Scheduler + Support Schedule):** franchisee
meeting cards/tabs and the Overdue counter/list are only visible to users
whose username or display name contains "tarryn" or "franlo"
(case-insensitive) — data-level filtering, not just a hidden button.

Both standalone pages (`cafe-overview.html`, `scheduler.html`) check for an
existing BOS session client-side (same-origin, same browser storage) rather
than showing their own login; if the session's expired, they redirect to the
main BOS login instead of prompting separately.

---

## 6. Data Model (PostgreSQL)

```sql
users          (id, username, password_hash, role, display_name, active, created_at)
visits         (id, data JSONB, created_at)
actions        (id, data JSONB, created_at)
ltl_audits     (id, data JSONB, created_at)
trainer_visits (id, data JSONB, created_at)
ops_tasks      (id, data JSONB, created_at)   -- Task Tracker; edit_log stored inside JSONB, must be JSON.stringify'd on PATCH
storage        (key, value, updated_at)       -- generic KV; used by Opening Timelines, Scheduler, support allocations, B.Better uploads, etc.
cafe_status    (store_key, store_name, fsm, region, data JSONB, updated_at)  -- Cafe Overview
```

Most tables store the record body as JSONB rather than flat columns, to match
what each migrated frontend already expected. `cafe_status` mirrors the old
Supabase table 1:1, imported via `migrate-cafe-status.js cafe_status_rows.csv`
— safe to re-run, matches on `store_key` and updates in place.

### Photo/file handling
- `saveBase64Photo()` decodes a data URL, writes to
  `UPLOAD_DIR = /data/uploads/<subfolder>/`, returns a short `/uploads/...`
  path — **only the path is stored in Postgres, never the image bytes.**
  (Base64-in-Postgres previously filled the DB volume to 500MB and crashed
  it — recovery required a Railway plan upgrade to resize.)
- Generic `/api/upload-file` endpoint for milestone/task attachments.
- Express JSON body limit bumped to 15mb for uploads.
- 30-day automated cleanup job for completed task photos.

### Known backend bugs fixed
- JSONB `edit_log` serialization bug in `ops_tasks` PATCH (needed
  `JSON.stringify(editLog)`)
- Non-Conformances queries must pull from the **full unfiltered dataset**, not
  whatever filter is currently active in the UI

---

## 7. API Endpoints (`src/server.js`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Authenticate, issue JWT |
| GET | `/api/me` | Current session/user info |
| POST | `/api/change-password` | Self-service password change |
| GET | `/api/admin/users` | List users (admin) |
| POST | `/api/admin/users` | Create user (admin) |
| PATCH | `/api/admin/users/:id` | Edit/disable user, change role (admin) |
| GET | `/api/state` | Bulk app state fetch |
| POST | `/api/visits` | Log a support visit (also feeds Visit Frequency KPI) |
| DELETE | `/api/visits/:id` | Delete a visit |
| PATCH | `/api/actions/:id` | Update an action item |
| POST | `/api/ltl` | Log an LTL audit |
| POST | `/api/trainer-visits` | Log a trainer visit |
| GET | `/api/ops-tasks` | List ops tasks |
| POST | `/api/ops-tasks` | Create ops task |
| PATCH | `/api/ops-tasks/:id` | Update ops task |
| PATCH | `/api/ops-tasks/:id/complete` | Mark ops task complete |
| GET/POST | `/api/storage/:key` | Generic KV get/set (Opening Timelines, Scheduler, support allocations, B.Better uploads) |
| GET/POST | `/api/cafe-status` | Cafe Overview data read/write |
| GET | `/api/reference-data` | Shared lookup/reference data |
| POST | `/api/upload-file` | Generic file attachment upload (milestones, tasks) |
| GET | `/api/admin/photo-stats` | Photo storage stats (admin) |
| POST | `/api/admin/cleanup-photos` | Purge unused photos (admin) |
| GET | `/api/health` | Health check |

*(~24 endpoints total — this list reflects the last full audit; treat as the
baseline and confirm against `server.js` before assuming completeness, since
new endpoints get added inline with features.)*

---

## 8. Feature Inventory (by module)

### 8.1 Team OKRs tab (formerly "Dashboard")
Existing KPI strip: Trade Health, Flow Score, B-Better Completion, Visit
Frequency, Tasks Closed, Cafés Opening (with a `THRESH` object defining
thresholds). Some KRs from `OKR.xlsx` map cleanly to existing cards; others
(CSPI, Google ratings, Mystery Diner) live only in `cafe-overview.html`; some
(SPI YoY, Marketing SLA, new-café CPA on-time rate) have no tracking
infrastructure yet. **OKRs will keep being adjusted as Franlo develops the
tab further — no fixed target structure to build toward; treat each OKR
change as its own incremental request rather than waiting for a final spec.**

### 8.2 New Cafés / Opening Timelines
- Café records live in a database-backed `extraStores` table (migrated off a
  hardcoded `OT_RAW_STORES` array so opening dates are editable from the
  dashboard, not via code deploy).
- Pending-submission queue + approval workflow for external submissions via
  `new-cafe-submission.html` (CSV upload, robust to UTF-8 BOM/semicolons/typos).
- **Support Team allocation:** chip-picker UI (toggle style), persisted to
  `/api/storage/support-allocations-v1`, pulls from `OT_PEOPLE_LIST`.
- **CPA Timeline:** rebuilt from `CPA_Timeline_V1.xlsx` into a ~38-milestone
  chronological sequence including open-ended, recurring Franchisee Meetings
  (every 2 weeks from café creation → opening). Each milestone has an editable
  Title, Description (seeded defaults), Manual Date Override, Comment, and
  file attachment.
- **Sub-dash tabs per café:** CPA Timeline / Training & Recruitment / B.Better
  Academy / Franchisee & Store Details.
- **Training Calendar:** Week 1 = Opening Date − 5 weeks, with per-trainee
  start-date overrides; recruitment tracking treats blank Name rows as
  vacancies (no separate Required Positions table).
- **B.Better Academy tab:** completion tracker from the Beeline Groups Report
  `.xlsx` (Average Completion % col B, Onboarding % col D); legacy FSM-based
  tracker removed.
- Collapsible `<details>/<summary>` dropdowns for "Next 12 Openings" and "CPA
  Milestones Due (30 Days)" (closed by default).
- Regional Support Team Overview pulling opening dates + allocations from
  BOS's own storage keys.
- Franchisee & Store Details section per café (representative, FSM, PM,
  landlord contacts) — seeded non-destructively from the Master Store Info
  workbook (fills empty fields only; never overwrites existing data or
  opening/handover dates due to source conflicts).

### 8.3 Task Tracker
- Three tabs: Open Tasks / Completed Tasks / **Non-Conformances** (promoted
  from a collapsible banner to a full tab, same FSM/Pillar/Status/Search
  filtering).
- Broken "In Progress" status filter removed → replaced with "Closed."
- Collapsible Overdue banner.
- Per-field edit history with audit logs.
- Notes/updates threads extended to all `ops_tasks` (not just visit-created
  ones); due-date changes auto-logged to the thread.
- Non-conformance items carry a red ⚠ badge across all tabs.
- Photo upload → Railway Volume (not DB).
- Add Task form: mobile-friendly autocomplete replacing a broken `<datalist>`;
  `capture="environment"` removed.

### 8.4 GRIND Café Support Visit Report (`log-support-visit.html`)
- Restructured around the G-R-I-N-D acronym; FOH/Bar/BOH sections removed and
  folded into an expanded **GRIND Reset** section (Overall Hygiene &
  Cleanliness, Checklists/SOPs, Coffee Check, Order Times Check, Team
  Question).
- "Log as Non-Conformance" action added alongside "Log on Task Tracker" in the
  next-step dropdown (both require owner + due date).
- Select-to-reveal interaction pattern for GRIND Reset/Admin/Portion Check
  rows (controls only appear once a question is toggled).
- Portion checks: Bar and Kitchen as fixed labels, option to add more.
- QC Tasting: New Beverages and New Dishes capped at one entry each.
- PDF export: N/A items excluded entirely; Summary section highlighted,
  showing only Task Tracker/Non-Conformance items with task details inline;
  "Coffee Co." removed from headers.
- Multi-photo support; submits directly into BOS's `visits`/`actions` tables
  and logs a Visit Frequency KPI entry via `/api/visits`.
- Franlo and Tarryn added to the FSM/Support dropdown (they manage regions,
  not store portfolios in `fsmStores`).

### 8.5 Team Scheduler (`scheduler.html`)
- **Master Route Grid** is the default landing view: zone-aware rotation,
  per-person filtering, sticky headers, frozen date/day header row.
- **Zone/cadence logic:** `classifyStore()` splits cafés into local /
  outlying / Namibia; `CADENCE` object defines visit periods per
  classification and per role (FSM local/outlying, support, manager
  local/outlying).
- **Batchable zones:** `BATCHABLE_ZONES` computed once globally from
  `ALL_SITES` (any outlying zone with 2+ cafés) — lets an FSM's outlying trip
  and the support team's visit to the *same* zone land on the same week, via
  a deterministic per-zone phase anchor (not derived from any one person's
  own list ordering).
- `supportRoutePlan()` splits the full café list across the support team
  (`allStores.filter((_, i) => i % personCount === personIndex)`), so each
  store gets exactly one assigned person, zone-aware.
- `managerRoutePlan()` — same local/outlying split logic for Franlo/Tarryn's
  own quarterly café rotations, with `fillGaps: true`.
- Saturday/Sunday Support Day columns added; gap-filling so no weekday sits
  empty.
- WC/EC/Gauteng/KZN zone data corrected: 47 new Gauteng `ALL_SITES` entries,
  27 renamed WC/EC entries fixing a silent cadence bug, 2 missing cafés
  added. **Historical scope note (superseded):** an earlier `CLAUDE.md` noted
  the Scheduler was Western Cape–focused (94 of 108 sites) with no Gauteng/
  KZN/Free State/North West/Mpumalanga/Limpopo coverage — this has since been
  extended (Gauteng and KZN zone data now verified and corrected as of the
  July 23 session).
- Franchisee meeting reschedule/confirm controls matching café visit
  controls; franchisee meeting access restricted to users named "tarryn" or
  "franlo." FSM and Support Team rows merged into one unified list per
  region.
- Opening-support coverage badges pulled from BOS Dashboard.
- Full re-theme to match the GRIND visit report's brand palette.
- Overdue-shuffle algorithm corrected to spread events across the *full*
  remaining quarter instead of piling onto a single week.

### 8.6 Support Schedule (`support-schedule.html`) — separate tool
Built from scratch, Task-Tracker-styled: Weekly Schedule / Café Directory /
Franchisee Directory tabs. FSM 1/2/3 labelling with assignable real names,
Franlo/Tarryn quarterly rotations, franchisee quarterly check-ins, reschedule
date-picker, inline café-detail expansion, KPI strip with at-risk
highlighting, dashboard visit-frequency integration.

### 8.7 Trade View / Turnover (`index.html` + `cafe-overview.html`)
- Live data via **Silo Data Platform** MCP (BigQuery), replacing manual
  PDF/CSV imports. Manual refresh on request (no auto-refresh key set up —
  deliberate choice over a BigQuery service account key on Railway).
- Warehouse tables: `gaap_curated.turnover_daily` (branch, live through prior
  day), `gaap_curated.cos_daily` (store — different column name),
  `reference.budget_input` (branch_name — a *third* naming variant).
- Alias mapping layers: `ALIAS` (Silo↔BOS store names) and `BUDGET_TO_SILO`
  (budget branch names). **"FNB Windhoek" = Windhoek CBD XS** — resolved,
  add this mapping to the `ALIAS` dict.
- Standard query pattern: `SUM(turnover_exclusive) ... WHERE date BETWEEN
  'YYYY-MM-DD' AND 'YYYY-MM-DD' GROUP BY branch`. Paced budget computed
  client-side: `budget_month × (days_elapsed / days_in_month)`.
- `TURNOVER_DATA`, `FC_DATA`, `BRAND_AVGS`, `BUDGET_DATA` all embedded in one
  `<script id="trade-data" type="application/json">` tag in `index.html` —
  patch via regex replace on that tag, not a `const` variable replace (that's
  the pattern for `cafe-overview.html` instead).
- KPI cards: Turnover MTD/YTD/YoY at network strip level and per-FSM region
  scorecard level, using `MANAGER_OF_FSM` mapping.
- Trade View insights: region-level MTD actual vs paced FY27 budget
  scorecard (Ahead/Watch/Behind), bottom-10 stores furthest from budget,
  YoY leaders/laggards (top/bottom 6 stores by MTD growth vs same month
  prior year).
- Data anomalies still worth a manual sanity check before feeding any KPI:
  Point Mall FC% spike (83% Mar), negative FC% for Irene Link (Jun), wild
  swings for Campbells and Cashan.

### 8.8 Cafe Overview
- Migrated from a standalone Supabase project into BOS's own Postgres
  (`cafe_status` table, imported via `migrate-cafe-status.js`).
- CSPI scoring, Google ratings, Mystery Diner scores, Store Health Report,
  PDF/Excel export, report-builder view (📊 icon, print/PDF one-pager per
  store over a date range).
- No dedicated "Franchisee" field — falls back to showing the GM as closest
  available contact, flagged openly in generated reports.
- Full re-theme from dark to light matching BOS's palette.

### 8.9 LTL Audit
Upload capability; score target ≥85%; non-conformances must close within 7
days (partially wired into the OKR mapping work, §8.1).

---

## 9. Reference Data Sources

- **Bootlegger Master Information workbook** (`Bootlegger_Master_Information_2026`,
  multiple revisions) — zone/address/franchisee/FSM source of truth
- **`OKR.xlsx`** — objectives/key results, evolving; drives the Team OKRs tab
  (see §8.1 — treated as a moving target, not a one-time spec)
- **`CPA_Timeline_V1.xlsx`** — CPA milestone sequence source
- **Beeline Groups Report `.xlsx`** — B.Better completion data
- **Silo Data Platform** (BigQuery) — live turnover/COS/budget

---

## 10. Deployment Playbook (hard-won process rules)

1. **Single source of truth = GitHub `main`.** Always `curl` the live raw
   GitHub URL (or re-clone) before editing any file — never trust an
   in-chat cached copy. Parallel chat sessions editing the same file
   simultaneously is the #1 cause of drift and has happened multiple times.
2. **Validation before delivery, every time:**
   - `node --check` on plain JS
   - Babel transform check on JSX (`scheduler.html`)
   - Standalone Node test harnesses for routing/scheduling logic
   - Playwright visual verification with offline API stubs
3. **Deployment gotchas:**
   - Windows renames downloaded files (adds "(1)" or double extensions) —
     use distinctly named output files (e.g. `bos-index-NEW.html`) and
     explicit PowerShell `Copy-Item` full paths.
   - OneDrive can dehydrate files → false-alarm `git status` deletions →
     fix with `git restore`.
   - **GitHub web upload is the reliable fallback** when PowerShell
     `Copy-Item` fights Franlo — to create a new folder (e.g. `vendor/`),
     type the full path as the filename in "Create new file."
   - Copy-pasting into GitHub's web editor can *append* rather than
     *replace* content, causing duplicate declarations that crash Node on
     startup — the safe method is delete the file first, then
     upload/rename the new one.
   - Once, the Claude.ai chat page itself was saved (`Ctrl+S`) and pushed
     as `index.html`, serving a snapshot of the chat instead of the
     dashboard — if a deploy "does nothing," check `git diff --stat` for a
     suspiciously sized diff before assuming Railway is broken.
   - Railway redeploys take ~60–90s. Always hard-refresh (`Ctrl+F5`) and
     verify with `Ctrl+F` for a distinctive string in the GitHub file
     viewer before concluding a deploy failed. **Franlo prefers testing in
     a normal Chrome window, not incognito** — don't redirect him to
     alternate views.
   - Browser caching specifically: append `?x=1` to the URL, or View
     Source (Ctrl+U) + Ctrl+F for a known new string, to confirm what the
     browser actually received.
4. **Caching vs. code:** if changes don't appear live, it's almost always a
   cache or wrong-file issue, not a code problem.
5. **Bulk find-replace is dangerous** — the `#ebebeb` retheme once made
   text invisible; context-aware per-line fixes are required instead.
6. **Data layout assumptions matter** — CSV parsers need to handle vertical
   label/value layouts, not just flat tables with headers.
7. **Photos always go to Railway Volume, never the DB** (base64-in-Postgres
   caused a 500MB volume-full crash previously; recovery required a plan
   upgrade to resize).
8. **Non-destructive seeding:** when importing from master workbooks, fill
   empty fields only — never overwrite existing live data, especially
   opening/handover dates where sources have historically conflicted.
9. **Claude Code caveat:** Railway CLI is not reachable directly from the
   Claude.ai sandbox (not on the network allowlist, no MCP connector).
   Claude Code running locally on Franlo's machine is the closest
   substitute — it can drive `git` and `railway` CLI directly, and reads
   `CLAUDE.md` fresh from the current working directory each session (no
   import step needed).

**Standard push sequence:**
```powershell
Copy-Item "$env:USERPROFILE\Downloads\<file>" "$env:USERPROFILE\Downloads\BOS-Dashboard\public\<file>" -Force
cd "$env:USERPROFILE\Downloads\BOS-Dashboard"
git add .
git commit -m "..."
git push
```

### Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "FATAL: JWT_SECRET..." on boot | Env var missing | Add `JWT_SECRET` in Railway Variables |
| Can't log in with admin/changeme123 | `users` table already has rows (not first boot) | Ask an existing admin, or reset via Railway's Postgres data tab |
| 403 "View-only account" on save | Working as intended | That account is a Viewer — have an admin change their role |
| Cafe Overview shows "Sign In Required" right after BOS login | Timing/localStorage race | Refresh Cafe Overview once — it re-checks session on load |
| Cafe Overview is empty | Old Supabase data not migrated yet | Run `migrate-cafe-status.js` |
| App crashes on deploy | Missing `pg`/`bcryptjs`/`jsonwebtoken` in package.json | Confirm `package.json` matches this repo, redeploy |

---

## 11. Open Items / Ongoing

- **Team OKRs tab** — no fixed target structure; Franlo will keep adjusting
  the objectives/KRs as the tab develops. Build incrementally per request
  rather than waiting on a final OKR spec.
- **Ongoing roster and zone data maintenance** as the FSM/support team
  evolves — re-sync against the Master Information workbook each time
  rather than ad hoc edits.
- **Data quality flags open:** Point Mall/Irene Link/Campbells/Cashan trade
  figures flagged as anomalous — worth a manual sanity check before they
  feed any OKR-linked KPI. (FNB Windhoek alias resolved — see §8.7.)

---

## 12. Session History (chronological index)

| Date | Chat | Focus |
|---|---|---|
| 2026-07-06 | BOS - Dashboard | Initial consolidation of 4 tools; Task Tracker, Trade View, Scheduler integration, GRIND rename, roster fixes, re-theme |
| 2026-07-10 | Railway CLI extraction | Built first `CLAUDE.md`; documented JWT_SECRET issue, DB schema, API endpoints, role model |
| 2026-07-13 (×3) | Adding new café info / Support team allocation (×2) | New Cafés tab rebuild, CPA/Training/B.Better sub-dashes, support allocation chip-picker, `index.html` drift identified as recurring risk |
| 2026-07-14 | Support team OKR alignment | OKR.xlsx mapping analysis; clarifying questions raised (now moot — OKRs treated as evolving, see §11) |
| 2026-07-22 | BOS Cafe Support Visits | GRIND form overhaul, Non-Conformances tab, New Café submission/approval flow, Franchisee & Store Details |
| 2026-07-23 | BOS Scheduler | Major scheduler rebuild — zone batching/phase anchoring, Support Schedule tool built, B.Better XLSX upload, server.js bug fixes |
| 2026-07-23/24 | Building café sub-dashboard | CPA timeline rebuild from spreadsheet, file upload endpoint, deployment debugging (append-vs-replace bug) |
| 2026-07-24 | Turnover and trade adjustments | Silo Data Platform live integration, Trade View insights, turnover KPI cards |

---

*This is now the single reference file — narrative history and technical
architecture combined. Keep it updated (or regenerate via the same
consolidation pass) after major sessions, and keep the repo's `CLAUDE.md` in
sync with it.*
