# CLAUDE.md — BOS Dashboard (Bootlegger Operating System)

Reference file for Claude when working on this project. Read this first
before making any changes.

---

## What this is

BOS is the single landing page / login for **all Bootlegger internal
dashboards**. One login, role-based access, one Postgres database, one
Railway deployment. It absorbed several previously-separate tools over
time (Ops Task Tracker, Opening Timelines, Cafe Overview — formerly its
own Supabase project) into this one app.

## Infrastructure

| | |
|---|---|
| GitHub repo | `Franlo2026/BOS-dashboard` (private — contains live GAAP/KeyTech figures + full store/contact list) |
| Railway service | `BOS-Dashboard` |
| Railway database | Postgres (separate service, same project) |
| Public URL | `bos-dashboard-production.up.railway.app` (port 8080) |
| Private networking | `bos-dashboard.railway.internal` |
| Runtime | Node.js ≥18, Express |

## Project structure

```
bos-dashboard/
├── src/
│   └── server.js            Express API + auth + Postgres
├── public/
│   ├── index.html           Main SPA — login + all in-page tabs
│   ├── cafe-overview.html   Cafe Overview — own page, shares BOS session
│   ├── scheduler.html       Team Scheduler — own page, shares BOS session
│   ├── log-support-visit.html
│   └── vendor/
├── migrate-cafe-status.js   One-off Supabase CSV → Postgres importer
├── cafe_status_rows.csv     Bundled Supabase export for the import
├── package.json
├── railway.toml
└── README.md                 Full human-readable doc — more detail than this file
```

## Tabs / pages in the app

**In-page tabs (index.html):** Dashboard, Log Visit, Actions, LTL Audits,
B-Better, Trade, Standards, Weekly Report, Print View, Trainers, Ops
Tasks, Opening Timelines, Admin.

**Standalone pages (own URL, shared session):**
- `/cafe-overview.html` — FSM/café status dashboard, checklist/scoring
  engine (~1,700 lines), CSPI scoring, turnover tracking, Excel export,
  plus a report-builder view (📊 icon) that generates a print/PDF
  one-pager per store over a date range.
- `/scheduler.html` — Team Scheduler: weekly route/visit planner
  (quarterly view, geo-ordered daily routes, overdue tracking) + a
  Franchisees view for franchisee meetings.

Both standalone pages check for an existing BOS session client-side
(same-origin, same browser storage) rather than showing their own login.
If the session's expired, they redirect to the main BOS login instead of
prompting separately.

## Access model — one login, three roles

| Role | View all tabs/pages | Log visits / close actions / log audits / edit Cafe Overview | Manage users |
|---|:---:|:---:|:---:|
| Admin | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ |
| Viewer | ✅ | ❌ (blocked client + server-side) | ❌ |

Applies uniformly across every in-page tab and both standalone pages.

**Franchisee-meeting restriction (Scheduler only):** the "Franchisees"
tab, franchisee-meeting cards in the weekly view, and the Overdue
counter/list are only visible to users whose username or display name
contains "tarryn" or "franlo" (case-insensitive) — data-level filtering,
not just a hidden button.

## Data model (PostgreSQL)

```sql
users          (id, username, password_hash, role, display_name, active, created_at)
visits         (id, data JSONB, created_at)
actions        (id, data JSONB, created_at)
ltl_audits     (id, data JSONB, created_at)
trainer_visits (id, data JSONB, created_at)
ops_tasks      (id, submitter_name, department, cafe, region, escalation_label,
                escalation_hours, comments, completed, completed_by, completed_at, created_at)
storage        (key, value, updated_at)   -- generic KV; used by Opening Timelines AND Scheduler
cafe_status    (store_key, store_name, fsm, region, data JSONB, updated_at)  -- Cafe Overview
```

Most tables store the record body as JSONB rather than flat columns, to
match what each migrated frontend already expected — low-risk migration,
since request/response shapes didn't need to change, only where the data
physically lives.

`cafe_status` mirrors the old Supabase table 1:1 (`store_key`,
`store_name`, `fsm`, `region`, `data`), imported via
`migrate-cafe-status.js cafe_status_rows.csv`. Safe to re-run — matches on
`store_key` and updates in place rather than duplicating.

## API endpoints (src/server.js)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Authenticate, issue JWT |
| GET | `/api/me` | Current session/user info |
| POST | `/api/change-password` | Self-service password change |
| GET | `/api/admin/users` | List users (admin) |
| POST | `/api/admin/users` | Create user (admin) |
| PATCH | `/api/admin/users/:id` | Edit/disable user, change role (admin) |
| GET | `/api/state` | Bulk app state fetch |
| POST | `/api/visits` | Log a support visit |
| DELETE | `/api/visits/:id` | Delete a visit |
| PATCH | `/api/actions/:id` | Update an action item |
| POST | `/api/ltl` | Log an LTL audit |
| POST | `/api/trainer-visits` | Log a trainer visit |
| GET | `/api/ops-tasks` | List ops tasks |
| POST | `/api/ops-tasks` | Create ops task |
| PATCH | `/api/ops-tasks/:id` | Update ops task |
| PATCH | `/api/ops-tasks/:id/complete` | Mark ops task complete |
| GET/POST | `/api/storage/:key` | Generic KV get/set (Opening Timelines, Scheduler) |
| GET/POST | `/api/cafe-status` | Cafe Overview data read/write |
| GET | `/api/reference-data` | Shared lookup/reference data |
| GET | `/api/admin/photo-stats` | Photo storage stats (admin) |
| POST | `/api/admin/cleanup-photos` | Purge unused photos (admin) |
| GET | `/api/health` | Health check |

## Environment variables (Railway → Variables tab)

| Variable | Notes |
|---|---|
| `JWT_SECRET` | Long random string (`openssl rand -base64 32`) |
| `ADMIN_USERNAME` | Only used on first boot (empty `users` table) |
| `ADMIN_PASSWORD` | Temporary — change immediately after first login |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Auto-set by Railway's Postgres service — don't set manually |
| `PORT` | Auto-set by Railway — don't set manually |

Once real accounts exist via the Admin tab, `ADMIN_USERNAME` /
`ADMIN_PASSWORD` can be removed from Variables.

> ⚠️ **JWT_SECRET check (found 2026-07-10):** this variable was set to the
> literal text of the PowerShell one-liner
> (`[Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))`) instead of
> its evaluated output — i.e. the signing secret was a fixed, guessable
> string, not a random one. Fix by running the whole line together so
> PowerShell evaluates the `$(...)` part first:
> ```powershell
> railway variables --set "JWT_SECRET=$([Convert]::ToBase64String((1..32|%{Get-Random -Max 256})))"
> ```
> Then redeploy (`railway up` or a git push) so the app picks up the new
> value. This invalidates all existing sessions — everyone has to log in
> again, which is expected. Worth spot-checking any other secret-style env
> vars for the same paste-the-command-instead-of-the-output mistake.

## Which file to edit for what

| Change | File |
|---|---|
| Store list, GAAP/KeyTech/Beeline figures, in-page tabs | `public/index.html` |
| Café checklist items, scoring logic, store master list | `public/cafe-overview.html` |
| Route/visit planner, franchisee list/logic | `public/scheduler.html` |
| Login logic, roles, API behaviour | `src/server.js` |
| New npm package | `package.json` (run `npm install` locally first) |
| Railway build/start settings | `railway.toml` |

## Update workflow (ongoing)

```bash
git add .
git commit -m "Brief description of what changed"
git push
```
Railway auto-redeploys on push, zero downtime, ~60–90 seconds.

## Known scope limits (as of last README update)

- **Scheduler site/franchisee list is Western Cape–focused** (94 of 108
  sites), plus a handful of Eastern Cape, Namibia, and Northern Cape
  sites. Does **not** currently cover Gauteng, KZN, Free State, North
  West, Mpumalanga, or Limpopo. Extending this needs the Master
  Information workbook (per-region sheet with FSM/franchisee/GM columns).
- **Cafe Overview report has no dedicated "Franchisee" field** — falls
  back to showing the GM as the closest available contact, and flags this
  openly in the generated report rather than mislabeling it.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "FATAL: JWT_SECRET..." on boot | Env var missing | Add `JWT_SECRET` in Railway Variables |
| Can't log in with admin/changeme123 | `users` table already has rows (not first boot) | Ask an existing admin, or reset via Railway's Postgres data tab |
| 403 "View-only account" on save | Working as intended | That account is a Viewer — have an admin change their role |
| Cafe Overview shows "Sign In Required" right after BOS login | Timing/localStorage race | Refresh Cafe Overview once — it re-checks session on load |
| Cafe Overview is empty | Old Supabase data not migrated yet | Run `migrate-cafe-status.js` (see above) |
| App crashes on deploy | Missing `pg`/`bcryptjs`/`jsonwebtoken` in package.json | Confirm `package.json` matches this repo, redeploy |

## Full reference

`README.md` in repo root has more narrative detail (deploy steps from
scratch, day-to-day user management via Admin tab, migration steps) —
consult it for anything not covered above.
