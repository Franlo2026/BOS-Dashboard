# BOS Dashboard v4 — One App, One Login, Everything Included

BOS is now the single landing page for all four Bootlegger dashboards,
including Cafe Overview, which has been fully migrated off its standalone
Supabase project and onto this app's own Postgres database.

- **Dashboard, Log Visit, Actions, LTL Audits, B-Better, Trade, Standards,
  Weekly Report, Print View, Trainers** — the original BOS tabs, unchanged.
- **Ops Tasks** — the Ops Task Tracker, folded in as a true tab sharing
  BOS's login/roles.
- **Opening Timelines** — the Cafe Opening Timelines dashboard, folded in
  as a true tab, same login/roles.
- **Cafe Overview** *(migrated)* — the FSM/café status dashboard. Its data
  now lives in this app's Postgres (a `cafe_status` table, migrated 1:1
  from its old Supabase schema), and it shares BOS's login instead of its
  own Supabase auth. It opens as its own page (`/cafe-overview.html`)
  rather than an in-page tab — see "Why Cafe Overview is a page, not a
  tab" below for why, and what that does and doesn't mean for you.
- **Admin** — user management, admin-only, unchanged.

## Why Cafe Overview is a page, not a tab

Cafe Overview's checklist/scoring engine (store checklist items, CSPI
scoring, turnover tracking, Excel export) is ~1,700 lines of tightly-coupled
logic. Rewriting all of it into BOS's tab format risked introducing subtle
bugs in real scoring calculations you rely on. Instead, it was left
functionally untouched and only its **data layer** was migrated:

- It's served by this same app, from this same Railway deployment — there's
  no second server or second URL to manage.
- It reads/writes this same Postgres database — there's no more Supabase
  dependency at all.
- It shares your BOS login automatically. Signing into BOS and clicking the
  "Cafe Overview" tab does **not** prompt a second login — the page checks
  for your existing BOS session (same browser storage, same site) and lets
  you straight in. If your BOS session has expired, it sends you back to
  the main BOS login instead of showing its own separate sign-in.
- Viewer accounts can browse it fully; saving a checklist change is blocked
  server-side for viewers, same rule as everywhere else in BOS.

Practically: it behaves like a tab (one login, one deploy, one database) —
it just happens to be its own HTML page under the hood rather than a JS
view swapped into BOS's single-page app. If you'd like it fully rewritten
into a native tab later, that's a bigger, separate piece of work — this
migration gets you off Supabase and onto one platform without that risk.

## What kept the same shape (schema)

The `cafe_status` table mirrors the old Supabase table exactly
(`store_key`, `store_name`, `fsm`, `region`, `data` JSONB) so the checklist
code's read/write calls needed no changes beyond pointing at
`/api/cafe-status` instead of Supabase's REST API.

---

## 1. Project structure

```
bos-dashboard/
├── src/
│   └── server.js          Express API + auth + Postgres (visits/actions/ltl/
│                           trainer/ops_tasks/storage/cafe_status/users)
├── public/
│   ├── index.html          Main SPA: login + all in-page tabs
│   └── cafe-overview.html  Cafe Overview — shares BOS's session, own page
├── migrate-cafe-status.js  One-off importer for the Supabase CSV export
├── cafe_status_rows.csv    Your Supabase export, bundled for the import
├── package.json
├── railway.toml
├── .env.example
├── .gitignore
└── README.md               (this file)
```

## 2. How the access model works

There is **one login** for everything. Everyone signs in on BOS's main page
with their own username and password. What they see afterwards depends on
their role:

| Role   | Can view all tabs & pages | Can log visits / close actions / log audits / edit Cafe Overview | Can manage users |
|--------|:---:|:---:|:---:|
| Admin  | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ |
| Viewer | ✅ | ❌ (blocked in UI and rejected server-side) | ❌ |

This applies uniformly across the in-page tabs (Log Visit, Actions, LTL,
Trainers, Ops Tasks, Opening Timelines) and Cafe Overview.

---

## 3. Deploy — GitHub

```bash
cd bos-dashboard
git init
git add .
git commit -m "BOS dashboard v4 — Cafe Overview migrated off Supabase"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Use a **private** repo — this codebase contains live GAAP/KeyTech figures
and the full café contact/store list.

---

## 4. Deploy — Railway

1. Go to [railway.app](https://railway.app) and sign in.
2. **New Project → Deploy from GitHub repo** → select this repo.
3. Railway detects Node.js via `package.json` and runs `npm install` then
   `npm start` automatically.
4. **Add PostgreSQL**: in the project, click **+ New → Database →
   PostgreSQL**. Railway automatically creates a `DATABASE_URL` variable and
   wires it into your app service — no manual copying needed.
5. **Set the required environment variables** on your app service (Settings
   → Variables):

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | A long random string. Generate one with `openssl rand -base64 32` |
   | `ADMIN_USERNAME` | e.g. `admin` (only used once, on first boot) |
   | `ADMIN_PASSWORD` | A temporary password you'll change immediately |
   | `NODE_ENV` | `production` |

   `DATABASE_URL` and `PORT` are set automatically by Railway — don't add
   them yourself.
6. **Generate a domain**: Settings → Networking → Generate Domain. That URL
   is what you share with the team.

On first boot, the server sees an empty `users` table and creates one admin
account from `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Log in with that, then
immediately:

1. Go to the **Admin** tab.
2. Create real accounts for each editor and viewer (their own username +
   temporary password + role).
3. Change your own admin password.
4. Once real accounts exist, you can remove `ADMIN_USERNAME` /
   `ADMIN_PASSWORD` from Railway's Variables.

## Team Scheduler

A new "Team Scheduler" tab opens `/scheduler.html` — a weekly route/visit
planner (quarterly view, geo-ordered daily routes, drag-free
confirm/reschedule, overdue tracking) plus a separate **Franchisees** view
for scheduling franchisee meetings.

- **Shares your BOS login** the same way Cafe Overview does — no second
  sign-in, same-origin session check.
- **Data persistence** reuses the same generic `storage` table already
  built for Opening Timelines — no new database table was needed.
- **Franchisee meetings are restricted to Tarryn and Franlo.** Anyone else
  signed in sees the Weekly Schedule and All Sites views, but the
  "Franchisees" tab is hidden entirely, franchisee-meeting cards are
  stripped out of their weekly view, and the Overdue counter/list excludes
  them too — not just a hidden button, the data itself doesn't render for
  other users. The check matches on username or display name containing
  "tarryn" or "franlo" (case-insensitive); tell me if either of them uses a
  different BOS login and I'll adjust the match.

**Scope note — please read before relying on this for other regions:**
The site list and franchisee list baked into this scheduler are
**Western Cape–focused** (94 of 108 sites), with a handful of Eastern Cape,
Namibia, and Northern Cape sites — this looks like it was built around one
person's actual route rather than the full national franchise network. It
does not currently include Gauteng, KZN, Free State, North West,
Mpumalanga, or Limpopo stores/franchisees. If you want full national
coverage, that's a real follow-up: the Master Information workbook has a
separate sheet per region with FSM, franchisee, and GM columns for every
store, which is exactly what's needed to extend this — just say the word.

---

Cafe Overview now has a third view (the 📊 icon next to Table/Card view) —
pick any store and a date range (week/month/quarter/custom) and it builds a
one-page, print/PDF-ready report consolidating:

- Store details, GM contact, FSM, region
- Commercial: turnover, budget, budget %, YoY growth, average spend, cost of sales
- People: B-Better completion, training compliance, team notes
- Operations: recipe compliance, open maintenance items, ops task completion
- Brand: CSPI/QC score, mystery diner (where logged), Google rating, brand compliance notes
- Store visits: count in range, last visit + summary, repeat issues across recent visits
- Action tracker: open / overdue / completed tasks from that store's visits
- An auto-generated Performance Summary: Key Wins, Areas Requiring Attention,
  Top 3 Priorities, and Recommended Actions for the next visit — all derived
  from the actual numbers above, not a separate manual write-up

It pulls from the rich per-store datasets already embedded in this page
(turnover, cost of sales, B-Better, recipe/cleaning, CSPI, Google — these
were already there from earlier exports) plus live visits/actions/tasks
from the main BOS app. Use the **Print / Save as PDF** button on the report
itself — it uses the browser's native print-to-PDF, so no extra library or
service is involved.

**One field it can't fill in:** there's no separate "Franchisee" field in
the current store master data — the report shows the GM as the closest
available contact and flags this openly rather than mislabeling it. If you
want a genuine franchisee field added to the store list, that's a quick
follow-up.

---

## 5. Migrating existing Cafe Overview data

Your Supabase export (`cafe_status_rows.csv`) is bundled in this repo along
with `migrate-cafe-status.js`, a one-off script that loads it straight into
this app's `cafe_status` table. Run it **once**, after you've deployed and
have your Railway `DATABASE_URL`:

```bash
cd bos-dashboard
npm install
DATABASE_URL="<paste from Railway: your Postgres service → Variables tab>" node migrate-cafe-status.js cafe_status_rows.csv
```

It prints one line per store as it imports, then a final count. It's safe
to re-run — matching `store_key`s get updated in place rather than
duplicated, so if you get a newer export later, just run it again with the
new file.

If you get a fresh CSV export from Supabase in the future (same
`store_key, store_name, fsm, region, data, updated_at` columns), this same
script works on it too — no changes needed.

---

## 6. Adding users day-to-day

No GitHub or Railway access needed — it's all in the app:

1. Sign in as an admin.
2. **Admin tab → Add User** → username, display name, temporary password,
   role (Viewer / Editor / Admin).
3. Send them their username + temporary password.
4. Change role / disable an account any time from the same tab.

---

## 7. The ongoing update workflow

```bash
git add .
git commit -m "Brief description of what changed"
git push
```
Railway redeploys automatically. Zero downtime, ~60–90 seconds.

**Which file to edit for what:**

| Change | File |
|---|---|
| Store list, GAAP/KeyTech/Beeline figures, in-page tabs | `public/index.html` |
| Café checklist items, scoring logic, store master list | `public/cafe-overview.html` |
| Login logic, roles, API behaviour | `src/server.js` |
| New npm package | `package.json` (then `npm install` locally first) |
| Railway build/start settings | `railway.toml` |

---

## 8. Data model (PostgreSQL)

```sql
users          (id, username, password_hash, role, display_name, active, created_at)
visits         (id, data JSONB, created_at)
actions        (id, data JSONB, created_at)
ltl_audits     (id, data JSONB, created_at)
trainer_visits (id, data JSONB, created_at)
ops_tasks      (id, submitter_name, department, cafe, region, escalation_label,
                escalation_hours, comments, completed, completed_by, completed_at, created_at)
storage        (key, value, updated_at)                    -- Opening Timelines' added stores
cafe_status    (store_key, store_name, fsm, region, data JSONB, updated_at)  -- Cafe Overview
```

Most tables use JSONB for the record body rather than flat columns,
matching the exact field shapes each frontend already expects — this kept
every migration low-risk, since request/response shapes didn't need to
change, only where the data physically lives.

---

## 9. Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "FATAL: JWT_SECRET..." on boot | Env var missing | Add `JWT_SECRET` in Railway Variables |
| Can't log in with admin/changeme123 | Users table already has rows (not first boot) | Ask an existing admin, or reset via Railway's Postgres data tab |
| 403 "View-only account" on save | Working as intended | That account is a Viewer — have an admin change their role |
| Cafe Overview shows "Sign In Required" right after logging into BOS | Rare timing/localStorage issue | Refresh the Cafe Overview page once — it re-checks the session on load |
| Cafe Overview is empty | Old Supabase data hasn't been migrated yet | See Section 5 |
| App crashes on deploy | Missing `pg`/`bcryptjs`/`jsonwebtoken` in package.json | Confirm `package.json` matches this repo's version, redeploy |
