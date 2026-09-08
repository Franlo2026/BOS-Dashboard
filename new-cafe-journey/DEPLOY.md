# New Café & Franchisee Journey — Deploy & Build Notes

Standalone platform covering the full franchisee opening journey
(sign-up → 4-week post-opening sign-off). **Separate Railway service +
separate GitHub repo** from BOS Dashboard and the Ops Task Tracker
(security separation — franchisees get external access here without any
route into BOS).

> This scaffold currently lives inside the `new-cafe-journey/` subfolder of
> the BOS-Dashboard repo (that's where the working branch is). It is
> self-contained — its own `package.json`, `server.js`, `railway.toml` — so
> it can be lifted into its own repo at deploy time. See "Splitting into its
> own repo" below.

---

## 1. What's in here

```
new-cafe-journey/
├── src/
│   ├── server.js         Express + pg. Café CRUD, step generation,
│   │                     planned/actual date logic, overdue register.
│   └── stepTemplates.js  8 FSM stages + all step templates.
├── public/
│   └── index.html        Café list, add-café form, stage-tabbed detail,
│                         per-step confirmation. Bootlegger brand CI.
├── package.json          express + pg only.
├── railway.toml          Nixpacks build, /api/health healthcheck.
├── .env.example
├── .gitignore
└── DEPLOY.md             (this file)
```

## 2. Local run

```bash
cd new-cafe-journey
npm install
cp .env.example .env          # set DATABASE_URL to a local Postgres
npm start                     # http://localhost:8080
npm run check                 # node --check on both JS files
```

Tables (`cafes`, `step_instances`) are created automatically on first boot
(`initDb()` in `server.js`). No migration step needed.

## 3. Deploy to Railway

1. Create a **new Railway project** (or a new service in an existing project).
2. Add a **Postgres** service in the same project. Railway injects
   `DATABASE_URL` automatically — do **not** set it by hand.
3. Connect this repo/folder as the service source. `railway.toml` handles
   build (Nixpacks) and start (`node src/server.js`).
4. `PORT` is provided by Railway automatically.
5. Deploy. Hit `GET /api/health` → `{ "ok": true }` to confirm boot, then
   open the service URL and add a café. Confirm `step_instances` are
   generated (café detail should show 73 steps across the 9 stages, 71 of
   them actionable).

**First-deploy smoke test:** add a café with a created + open date, open it,
tick a couple of Stage 01 steps, then edit the open date — planned dates for
`open`-anchored steps should shift while your confirmed steps keep their
actual dates. That exercises the whole planned/actual model against real
Postgres.

## 4. Splitting into its own repo (recommended before launch)

The handoff calls for a **separate GitHub repo** for security separation.
To split:

```bash
# from a clean checkout of the working branch
git subtree split --prefix=new-cafe-journey -b new-cafe-journey-only
# create the new private repo on GitHub, then:
git push git@github.com:Franlo2026/new-cafe-journey.git new-cafe-journey-only:main
```

Or simply copy the `new-cafe-journey/` folder into a fresh repo. Either way,
point the new Railway service at that repo.

---

## 5. The scheduling model (the core structural fix)

Every `step_instances` row stores **two separate dates**:

- `planned_date` — computed once from `anchor_date + offset_days`, **fixed**.
- `actual_date` — set only when someone confirms the step.

The timeline always sorts/displays by `planned_date`. Overdue =
`today > planned_date AND actual_date IS NULL`. A late confirmation writes
`actual_date` and never moves `planned_date`, so the visual order never
reshuffles. (This is the bug that motivated the rebuild — verified against a
real Walmer Park export where late-confirmed items jumped out of order.)

Anchors: `created` (sign-up, day 0), `handover` (site handover),
`open` (trading open). `offset_days` is signed (negative = before anchor).

**Open decision (unresolved):** this is a fixed-offset template, not true
dependency-based CPM. A real slip in one stage does **not** push downstream
planned dates. Fine for now / matches current BOS behaviour. If "critical
path" needs to be literal, add per-step dependencies and derive planned
dates topologically instead of from anchors. Decide before the content pass
gets large — it's cheap to change now, expensive later.

---

## 6. Content status — next passes

Source of truth: `Bootlegger_FSM_New_Store_Opening_Guide_v1.0.docx` and the
folder `Openings/2026 Opening Docs/New Store Opening Folder V.2/` (OneDrive,
franlo@bootlegger.co.za). Pull via the Microsoft 365 / SharePoint connector
(`sharepoint_search`, `read_resource`).

| Stage | Name | Status |
|---|---|---|
| 00 | Welcome & Orientation | **Stub** — expand from Welcome Pack / Toolkit Navigator |
| 01 | Recruitment & Opening Admin | **Populated** (62 steps: 8 FSM actions, 5-step recruitment, 49 Business Essentials) |
| 02 | Off-Site Training | **Stub** — pull Off-Site Training Sign-Off Forms, Pre-Opening Franchisee Business Training |
| 03 | Ordering & Stock | **Stub** — pull Opening Order Guide |
| 04 | Site & Technology Setup | **Stub** — pull Site Handover & Snag List, Technology Setup Guide |
| 05 | 7-Day On-Site Readiness | **Stub** — expand into Day 1–7 checklist from 7-Day On-Site Training Template |
| 06 | Opening Day | **Stub** — pull Opening Day Run-Sheet |
| 07 | Post-Opening Operations | **Partial** — 10-Day Tracker, 30/60/90 reviews, project sign-off seeded; add Stock Take Guide, WhatsApp templates |
| 08 | Reference & Standards | **Reference-only** (Brand Standards, COS Benchmark) — no checklist |

**To expand a stage:** edit `src/stepTemplates.js`, replace the stub array
(e.g. `STAGE_02_STEPS`) with the real steps in the same shape
(`{ key, title, description, responsible, sourceDoc, anchor, offsetDays }`).
Then, for cafés already created, call `POST /api/cafes/:id/regenerate` — it
inserts any newly-added steps (existing steps and their confirmations are
left untouched) and recomputes planned dates.

> **Stage 01 content note:** the Business Essentials items were reconstructed
> to the checklist's structure (tagged Accountant / HR Provider / Franchisee /
> FSM). Validate wording and offsets against the live source doc on the first
> content review — the mechanism is right; some individual line items may
> need adjusting.

**Escalation thresholds** (from the FSM Guide, exported at `/api/stages` and
wired into `stepTemplates.ESCALATION_THRESHOLDS` for future alerting): COS
above 34–35%, cash variance over R200/day, labour above 30% during
post-opening → mandatory escalation to Regional FM.

---

## 7. Parked until near-launch (not built yet)

Deliberately deferred per the handoff — none of it blocks the current build:

- **Auth / access boundary.** Internal HQ staff login (not routed through
  BOS) + franchisee access scoped strictly to their own café's journey.
  `.env.example` has a `JWT_SECRET` placeholder.
- **File storage.** Proof-of-completion uploads → S3-compatible bucket
  (Cloudflare R2 or AWS S3, undecided). The data model already has
  `attachment_url` per step; wire the upload + swap the URL field for a real
  uploader.
- **Email notifications.** Overdue flagging is live on-platform
  (`GET /api/overdue` + the dashboard banner). Add auto + manual email via
  Resend/SendGrid.
- **Document version library.** Download-template → fill offline → re-upload.
  New versions roll forward for active cafés; "Completed" cafés stay pinned
  to the version they submitted against.
- **Live Beeline (B.Better) integration.** Pull training completion status
  live instead of the manual `.xlsx` upload BOS uses.

---

## 8. Relationship to BOS

BOS's current **New Cafés** tab (`new-cafe-ops.html`) stays live and
untouched until this platform fully replaces it. **No early removal.**

## 9. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check → `{ ok: true }` |
| GET | `/api/stages` | Static workflow metadata (stages, template version, escalation thresholds) |
| GET | `/api/cafes` | List cafés with progress summary |
| POST | `/api/cafes` | Create café + generate step instances |
| GET | `/api/cafes/:id` | Café detail — anchors + steps grouped by stage |
| PATCH | `/api/cafes/:id` | Update anchors/metadata → recompute planned dates |
| POST | `/api/cafes/:id/regenerate` | Add newly-templated steps + recompute (idempotent) |
| DELETE | `/api/cafes/:id` | Delete café (steps cascade) |
| PATCH | `/api/steps/:id` | Confirm/update a step (sets actual_date; never touches planned_date) |
| GET | `/api/overdue` | Cross-café overdue register (active cafés) |
