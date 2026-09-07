# BOS Dashboard → Cortado Integration Guide

**Purpose:** how the Cortado app can read data from the BOS Dashboard, and a
catalogue of the data that is available to read.

**Audience:** the Cortado engineering team + BOS maintainers.

**Status:** proposal / reference. Nothing described here is switched on for
Cortado yet — see [What BOS needs to do](#7-what-bos-needs-to-do-to-enable-cortado).

---

## 1. Short answer

Yes — Cortado can read from BOS. BOS already exposes a JSON HTTP API on
Railway, protected by JWT login, and it stores its live data in two places:
a **PostgreSQL database** (the `pool` — operational records + uploaded/refreshed
datasets) and a set of **reference JSON blobs** embedded in the app.

The **recommended first step** is to give Cortado a dedicated **read-only
("viewer") service account** and have Cortado call the existing HTTP API
server-to-server. No code change to BOS is required to start. A cleaner
long-term option (a static API key + a curated `/api/integration/*` endpoint)
is described in §5.

> **One-line version for Cortado:** `POST /api/login` with a viewer service
> account → get a Bearer token → `GET` the read endpoints in §4.1. Treat every
> `/api/storage/:key` `value` as a JSON **string** you must `JSON.parse()` again.

---

## 2. What BOS is (context)

| | |
|---|---|
| Stack | Node.js + Express, PostgreSQL (`pg`), JWT auth |
| Hosting | Railway (GitHub → Railway auto-deploy) |
| Base URL | `https://bos-dashboard-production.up.railway.app` |
| Health check | `GET /api/health` → `{ "ok": true }` (no auth) |
| Auth | Bearer JWT, 12-hour expiry, 3 roles: `admin` / `editor` / `viewer` |

BOS is the operational "cockpit" for the Bootlegger café network: the café
directory, FSM/area-manager roster, turnover (mirrored daily from the Silo
BigQuery platform), store-visit and LTL-audit logs, the ops task tracker,
B-Better training %, Google ratings, Flow recipe/cleaning scores, CSPI customer
sentiment, budgets and equipment-servicing schedules.

---

## 3. Authentication

All `/api/*` routes require a Bearer token **except** `/api/login`,
`/api/health`, and `/api/public/cafe-submissions`.

1. **Log in** to get a token:
   ```http
   POST /api/login
   Content-Type: application/json

   { "username": "cortado-readonly", "password": "••••••" }
   ```
   Response: `{ "token": "<JWT>", "username": "...", "role": "viewer", "displayName": "..." }`

2. **Call read endpoints** with the token:
   ```http
   GET /api/state
   Authorization: Bearer <JWT>
   ```

**Notes for Cortado:**
- Tokens expire after **12 hours** — Cortado should cache the token and
  re-login on a `401`.
- Use a **`viewer`** role account: `viewer` can read everything but every
  write route is gated by `requireEditor`/`requireAdmin`, so a viewer token
  physically cannot modify BOS data.
- **CORS is not enabled** on BOS. Call it **server-to-server** from Cortado's
  backend, not from a browser on a different origin.
- Store the service-account credentials in Cortado's environment/secrets, never
  in client code or a committed file.

---

## 4. How to read the data

There are three surfaces. Cortado will mostly use 4.1 and 4.2.

### 4.1 HTTP API endpoints (read)

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/health` | none | Liveness `{ ok: true }` |
| `GET /api/me` | any | The calling account's identity/role |
| `GET /api/state` | any | `{ visits, actions, ltlAudits, trainerVisits }` — operational logs (arrays of JSON records) |
| `GET /api/ops-tasks` | any | The ops task tracker (array of tasks) |
| `GET /api/cafe-status` | any | Weekly café-status snapshots (per store) |
| `GET /api/reference-data` | any | The `bos-data` reference blob: `fsmStores`, `managers`, `gaap`, `keytech`, `beeline`, `aliases`, `trainers` |
| `GET /api/storage/:key` | any | A single stored dataset by key — see 4.2. `value` is a **JSON string**. |

Write endpoints exist (`POST /api/visits`, `/api/ops-tasks`, `/api/storage/:key`,
etc.) but all require `editor`/`admin`; Cortado should not use them.

### 4.2 Stored datasets — `GET /api/storage/:key`

Returns `{ "key": "...", "value": "<json-string>" }`. **`value` is stringified
JSON** — parse it a second time. Keys Cortado will care about:

| Key | Contents | Refresh |
|---|---|---|
| `bos-upload-data-turnover` | `{ TURNOVER_DATA, BRAND_AVGS }` — live turnover per café (MTD / last full month / FYTD, this year vs last, growth %, SPI, invoices), keyed by café name | **Daily, automatic** from Silo/BigQuery |
| `bos-upload-meta-turnover` | `{ uploadedAt, uploadedBy, rows, notes }` — freshness stamp for the above | Daily |
| `bos-upload-data-monthly-trade` | Per-café, per-calendar-month turnover, both fiscal years: `{ "<Café>": { "mar26": {sales,inv}, "mar25": {…}, …, "ytd26": {…} } }` (suffix = fiscal-year-start year) | **Daily, automatic** from Silo/BigQuery |
| `bos-upload-meta-monthly-trade` | Freshness stamp for the monthly turnover | Daily |
| `bos-upload-data-bbetter` | B-Better training completion % per café | Manual upload |
| `bos-upload-data-flow` | KeyTech Flow recipe & cleaning scores per café | Manual upload |
| `bos-upload-data-social` | Google ratings / review data per café | Manual upload |
| `bos-upload-data-cspi` / `bos-upload-data-cspi-components` | CSPI customer-sentiment scores | Manual upload |
| `dashboard-stores-v1` | Extra/added café directory entries (merged on top of the embedded base directory) | On edit |
| `silo-turnover-map-v1` | The Silo-store → BOS-café-key mapping table used by the daily turnover refresh | On edit |
| `email-automation-enabled` | Master switch for scheduled email digests | On edit |

Each `bos-upload-data-*` has a matching `bos-upload-meta-*` freshness stamp.
Cortado should read the `meta` first (`uploadedAt`) to know how fresh a dataset
is before using it.

### 4.3 Reference datasets embedded in the app

Some directory/reference data lives as JSON `<script>` blobs in
`public/index.html` rather than behind a dedicated API. `bos-data` is exposed at
`GET /api/reference-data`; the others currently are **not** individually exposed
(they can be read by fetching `index.html` and extracting the block, or by BOS
adding a small endpoint — see §5/§7).

| Blob id | Contents |
|---|---|
| `bos-data` | `fsmStores` (FSM → their stores), `managers` (area-manager → FSMs), `aliases` (name-mapping table), `gaap`/`keytech`/`beeline` reference maps, `trainers` — **exposed at `/api/reference-data`** |
| `cafe-data` | **The café directory** — `STORES` (133 cafés) plus `CSPI_DATA`, `GOOGLE_DATA`, `FLOW_DATA`, `BB_DATA`, brand averages |
| `trade-data` | Seed/fallback `TURNOVER_DATA`, `BRAND_AVGS`, `FC_DATA` (cost-of-sales %). *Live turnover comes from the storage key, not this blob.* |
| `monthly-trade-data` | Seed/fallback monthly turnover. *Live version is the storage key.* |
| `cspi-components-data`, `budget-data`, `service-schedule-data` | CSPI component breakdown, per-café budgets, equipment-servicing schedule |

**Café directory fields (`cafe-data.STORES[]`):**
`region, store_name, abbr, open_month, category (format), fsm, mall, address,
town, city, phone, email, gm_name, gm_phone, liquor, night_trading, slushies,
merrychef, ice_cream, online_ordering, halaal, hours_mon…hours_sun,
special_notes, franchisee_name, franchisee_email, operator_name, operator_email`.

> ⚠️ The complete live directory = the embedded `cafe-data.STORES` **plus** the
> `dashboard-stores-v1` storage key (added/edited cafés). There is no single
> endpoint that returns the merged list today — this is the main thing worth
> adding for Cortado (§7).

---

## 5. Integration options (choose per need)

| # | Option | Best for | Effort on BOS | Trade-offs |
|---|---|---|---|---|
| 1 | **Viewer service account + existing HTTP API** (recommended start) | Reading BOS-native data (tasks, visits, café status, turnover overrides, reference data) now | **None** | 12h token refresh; `/api/storage` needs known keys; no per-field scoping |
| 2 | **Static API key + curated `/api/integration/*` read endpoints** | A stable, documented, long-lived contract for Cortado | Small build | BOS builds & maintains the endpoints |
| 3 | **Read-only Postgres role on the same DB (`pool`)** | Heavy analytics / bulk export over the raw tables | Small (DB role) | Couples Cortado to BOS's schema; bypasses app logic; higher blast radius |
| 4 | **Read turnover from Silo/BigQuery directly** | If Cortado only needs turnover/sales | None on BOS | Different auth (GCP); Cortado re-implements the café-name mapping |
| 5 | **HMAC/SSO deep-link handoff** (as used for the Marketing Tracker) | *User* linking / single sign-on between the apps — **not** data reads | Small | Auth handoff only, not a data feed |

**Recommendation:**
- **Now:** Option 1 for BOS-native data + Option 4 for turnover-at-source if
  Cortado wants the rawest sales numbers.
- **Soon:** Option 2 — a read-only API key and 2–3 curated endpoints
  (`/api/integration/stores`, `/api/integration/turnover`,
  `/api/integration/tasks`) give Cortado a clean, versioned, non-expiring
  contract and remove the need to know internal storage keys or parse HTML.

### 5.1 Precedent already in the codebase
BOS already links to a sibling app (the **Marketing Tracker**) via an HMAC
handoff: `GET /api/marketing-tracker-link` signs a timestamp with a shared
secret (`MARKETING_TRACKER_SSO_SECRET`) that the other app verifies. The same
pattern can give Cortado **SSO** (Option 5) if users need to jump between the
apps — but for a *data feed*, Options 1/2 are the right tools.

---

## 6. The data in the database (`pool`)

For Option 3, or to understand what the API is serving, these are the
PostgreSQL tables:

| Table | Grain | Key columns |
|---|---|---|
| `users` | one per login | `username`, `role` (admin/editor/viewer), `display_name`, `email`, `active` — **do not expose to Cortado** |
| `visits` | store-visit reports | `id`, `data` (JSONB), `created_at` |
| `actions` | actions/issues raised on visits | `id`, `data` (JSONB), `created_at` |
| `ltl_audits` | ECAS "Licence-to-Learn"/compliance audits | `id`, `data` (JSONB), `created_at` |
| `trainer_visits` | trainer visit reports | `id`, `data` (JSONB), `created_at` |
| `ops_tasks` | ops task tracker | `id`, `submitter_name`, `department`, `cafe`, `region`, `escalation_label`, `escalation_hours`, `comments`, `completed`, `completed_by`, `completed_at`, `responsible_person`, `is_non_conformance`, `due_date_override`, `follow_up_notes`, `photo_urls`, … |
| `storage` | key/value datasets (see 4.2) | `key`, `value` (TEXT/JSON string), `updated_at` |
| `cafe_status` | weekly café-status snapshot | `store_key`, `store_name`, `fsm`, `region`, `data` (JSONB), `updated_at` |

`visits`, `actions`, `ltl_audits`, `trainer_visits` are surfaced (already
JSON-decoded) via `GET /api/state`; `ops_tasks` via `GET /api/ops-tasks`;
`cafe_status` via `GET /api/cafe-status`; `storage` via `GET /api/storage/:key`.
So **Option 1 already covers all of these without direct DB access** — prefer
the API over Option 3 unless you need bulk analytics.

---

## 7. What BOS needs to do to enable Cortado

**For Option 1 (fastest, no code):**
1. Create a login for Cortado with the **`viewer`** role (Admin → Users), e.g.
   `cortado-readonly`.
2. Share the credentials with the Cortado team via a secret manager (not chat/
   email).
3. Cortado follows §3 + §4.

**For Option 2 (recommended medium-term):**
1. Add a `CORTADO_API_KEY` environment variable on Railway.
2. Add read-only `/api/integration/*` endpoints that accept the key via an
   `X-API-Key` header and return curated JSON, notably:
   - `GET /api/integration/stores` → the **merged** café directory
     (`cafe-data.STORES` + `dashboard-stores-v1`).
   - `GET /api/integration/turnover` → parsed `bos-upload-data-turnover` +
     `-monthly-trade` with their freshness stamps.
   - `GET /api/integration/tasks` → `ops_tasks`.
3. Version the payloads (`"schema": 1`) so Cortado can depend on them.

*(BOS maintainers: this is a small, self-contained addition — say the word and
it can be built and deployed the same way as the turnover work.)*

---

## 8. Turnover at source (Silo / BigQuery)

BOS's turnover is a daily mirror of the **Silo Data Platform** (BigQuery,
project `silo-data-platform`, brand dataset `bootlegger_curated.turnover_daily`).
If Cortado wants the rawest sales data (daily granularity, covers, invoices,
ex-VAT turnover) it can read Silo directly with its own GCP credentials, using
`store_master` as the store attribute source. The one thing BOS adds on top is
the **Silo-store → BOS-café-name mapping** (`silo-turnover-map-v1`); Cortado can
read that same map from BOS to stay consistent, or key off Silo's stable `node`
id.

---

## 9. Data sensitivity / governance

- The café directory contains **PII** (franchisee & operator names, emails,
  phone numbers). Scope Cortado's use accordingly.
- Never expose the `users` table to Cortado.
- Use a **read-only** account/key so Cortado cannot mutate BOS data.
- Rotate the service-account password / API key periodically.
- All turnover/financial figures are **ZAR, ex-VAT** unless stated otherwise.

---

## 10. Example requests

```bash
BASE=https://bos-dashboard-production.up.railway.app

# 1. Log in (server-to-server)
TOKEN=$(curl -s "$BASE/api/login" -H 'Content-Type: application/json' \
  -d '{"username":"cortado-readonly","password":"••••••"}' | jq -r .token)

# 2. Live turnover (note the double JSON-decode of .value)
curl -s "$BASE/api/storage/bos-upload-data-turnover" -H "Authorization: Bearer $TOKEN" \
  | jq -r .value | jq '.TURNOVER_DATA["Boardwalk"]'

# 3. Freshness of the turnover feed
curl -s "$BASE/api/storage/bos-upload-meta-turnover" -H "Authorization: Bearer $TOKEN" \
  | jq -r .value | jq .

# 4. Operational logs
curl -s "$BASE/api/state" -H "Authorization: Bearer $TOKEN" | jq '.visits | length'

# 5. Ops tasks
curl -s "$BASE/api/ops-tasks" -H "Authorization: Bearer $TOKEN" | jq 'length'

# 6. Reference roster (FSMs, managers, aliases)
curl -s "$BASE/api/reference-data" -H "Authorization: Bearer $TOKEN" | jq 'keys'
```

---

*Generated for the Bootlegger BOS ↔ Cortado integration. Questions on the BOS
side: Franlo. This document describes BOS as of the current deploy; the
`/api/integration/*` endpoints in §7 are proposed, not yet built.*
