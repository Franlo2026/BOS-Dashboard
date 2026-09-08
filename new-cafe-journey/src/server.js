'use strict';

/**
 * New Café & Franchisee Journey — API server
 * ------------------------------------------------------------------
 * Node + Express + PostgreSQL. Standalone service (separate Railway
 * service + Postgres from BOS Dashboard).
 *
 * Core responsibility: when a café is created, materialise one
 * `step_instances` row per step template (see stepTemplates.js),
 * computing a FIXED `planned_date` from the café's anchor dates.
 * Confirmation only ever sets `actual_date` — planned dates never move,
 * so the timeline never reshuffles.
 */

const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const {
  STAGES,
  ESCALATION_THRESHOLDS,
  TEMPLATE_VERSION,
  allStepTemplates,
} = require('./stepTemplates');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && /railway|amazonaws|render|supabase/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

const ANCHOR_COLUMN = {
  created: 'created_date',
  handover: 'handover_date',
  open: 'open_date',
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cafes (
      id               SERIAL PRIMARY KEY,
      name             TEXT NOT NULL,
      region           TEXT,
      franchisee_name  TEXT,
      fsm              TEXT,
      created_date     DATE NOT NULL,
      handover_date    DATE,
      open_date        DATE,
      status           TEXT NOT NULL DEFAULT 'active',
      template_version TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS step_instances (
      id             SERIAL PRIMARY KEY,
      cafe_id        INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
      stage_id       TEXT NOT NULL,
      step_key       TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT,
      responsible    TEXT,
      source_doc     TEXT,
      anchor         TEXT NOT NULL,
      offset_days    INTEGER NOT NULL DEFAULT 0,
      planned_date   DATE,
      actual_date    DATE,
      confirmed_by   TEXT,
      attachment_url TEXT,
      notes          TEXT,
      override_reason TEXT,
      is_reference   BOOLEAN NOT NULL DEFAULT false,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (cafe_id, step_key)
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_step_instances_cafe ON step_instances(cafe_id);`
  );
}

// ---------------------------------------------------------------------------
// Date helpers (UTC-safe, date-only — no time component)
// ---------------------------------------------------------------------------
function toISODate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const dt = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + (days || 0));
  return dt.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute a step's planned date from a café's anchors.
 * Returns null if the required anchor date isn't set yet (e.g. open_date
 * unknown) — such steps still exist but show "TBC" until the anchor is set.
 */
function computePlannedDate(cafe, step) {
  const col = ANCHOR_COLUMN[step.anchor] || ANCHOR_COLUMN.created;
  const anchorISO = toISODate(cafe[col]);
  if (!anchorISO) return null;
  return addDays(anchorISO, step.offsetDays || 0);
}

// ---------------------------------------------------------------------------
// Step generation & planned-date recompute
// ---------------------------------------------------------------------------
async function generateStepInstances(client, cafe) {
  const templates = allStepTemplates();
  for (const t of templates) {
    const planned = computePlannedDate(cafe, t);
    await client.query(
      `INSERT INTO step_instances
        (cafe_id, stage_id, step_key, title, description, responsible,
         source_doc, anchor, offset_days, planned_date, is_reference, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (cafe_id, step_key) DO NOTHING`,
      [
        cafe.id,
        t.stageId,
        t.key,
        t.title,
        t.description || null,
        t.responsible || null,
        t.sourceDoc || null,
        t.anchor,
        t.offsetDays || 0,
        planned,
        !!t.isReference,
        t.sortOrder,
      ]
    );
  }
}

/**
 * Recompute planned_date for all of a café's steps from current anchors.
 * Only touches planned_date — never actual_date / confirmation fields.
 */
async function recomputePlannedDates(client, cafe) {
  const rows = (
    await client.query(
      `SELECT id, anchor, offset_days FROM step_instances WHERE cafe_id = $1`,
      [cafe.id]
    )
  ).rows;
  for (const r of rows) {
    const planned = computePlannedDate(cafe, {
      anchor: r.anchor,
      offsetDays: r.offset_days,
    });
    await client.query(`UPDATE step_instances SET planned_date = $1 WHERE id = $2`, [
      planned,
      r.id,
    ]);
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------
function serializeStep(row) {
  const planned = toISODate(row.planned_date);
  const actual = toISODate(row.actual_date);
  const confirmed = !!actual;
  const overdue = !row.is_reference && !confirmed && planned && planned < todayISO();
  return {
    id: row.id,
    cafeId: row.cafe_id,
    stageId: row.stage_id,
    stepKey: row.step_key,
    title: row.title,
    description: row.description,
    responsible: row.responsible,
    sourceDoc: row.source_doc,
    anchor: row.anchor,
    offsetDays: row.offset_days,
    plannedDate: planned,
    actualDate: actual,
    confirmed,
    confirmedBy: row.confirmed_by,
    attachmentUrl: row.attachment_url,
    notes: row.notes,
    overrideReason: row.override_reason,
    isReference: row.is_reference,
    sortOrder: row.sort_order,
    overdue,
  };
}

function summarize(steps) {
  const actionable = steps.filter((s) => !s.isReference);
  const total = actionable.length;
  const done = actionable.filter((s) => s.confirmed).length;
  const overdue = actionable.filter((s) => s.overdue).length;
  return {
    total,
    done,
    overdue,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Static workflow metadata (stages + template info) — no DB needed.
app.get('/api/stages', (_req, res) => {
  res.json({
    templateVersion: TEMPLATE_VERSION,
    escalationThresholds: ESCALATION_THRESHOLDS,
    stages: STAGES.map((s) => ({
      id: s.id,
      name: s.name,
      fsmRole: s.fsmRole,
      concurrentWith: s.concurrentWith,
      complete: s.complete,
      referenceOnly: !!s.referenceOnly,
      stepCount: s.steps.length,
    })),
  });
});

// List cafés with progress summary.
app.get('/api/cafes', async (_req, res, next) => {
  try {
    const cafes = (
      await pool.query(`SELECT * FROM cafes ORDER BY created_at DESC`)
    ).rows;
    const result = [];
    for (const c of cafes) {
      const steps = (
        await pool.query(
          `SELECT * FROM step_instances WHERE cafe_id = $1 ORDER BY planned_date NULLS LAST, sort_order`,
          [c.id]
        )
      ).rows.map(serializeStep);
      result.push({ ...serializeCafe(c), summary: summarize(steps) });
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

function serializeCafe(c) {
  return {
    id: c.id,
    name: c.name,
    region: c.region,
    franchiseeName: c.franchisee_name,
    fsm: c.fsm,
    createdDate: toISODate(c.created_date),
    handoverDate: toISODate(c.handover_date),
    openDate: toISODate(c.open_date),
    status: c.status,
    templateVersion: c.template_version,
    createdAt: c.created_at,
  };
}

// Create a café + generate step instances.
app.post('/api/cafes', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, region, franchiseeName, fsm, createdDate, handoverDate, openDate } =
      req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const created = toISODate(createdDate) || todayISO();
    await client.query('BEGIN');
    const cafe = (
      await client.query(
        `INSERT INTO cafes
          (name, region, franchisee_name, fsm, created_date, handover_date, open_date, template_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          String(name).trim(),
          region || null,
          franchiseeName || null,
          fsm || null,
          created,
          toISODate(handoverDate),
          toISODate(openDate),
          TEMPLATE_VERSION,
        ]
      )
    ).rows[0];
    await generateStepInstances(client, cafe);
    await client.query('COMMIT');
    res.status(201).json(serializeCafe(cafe));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Café detail — anchors + all steps grouped by stage.
app.get('/api/cafes/:id', async (req, res, next) => {
  try {
    const cafe = (await pool.query(`SELECT * FROM cafes WHERE id = $1`, [req.params.id]))
      .rows[0];
    if (!cafe) return res.status(404).json({ error: 'café not found' });
    const steps = (
      await pool.query(
        `SELECT * FROM step_instances WHERE cafe_id = $1 ORDER BY planned_date NULLS LAST, sort_order`,
        [cafe.id]
      )
    ).rows.map(serializeStep);

    const stages = STAGES.map((s) => {
      const stageSteps = steps.filter((x) => x.stageId === s.id);
      return {
        id: s.id,
        name: s.name,
        fsmRole: s.fsmRole,
        concurrentWith: s.concurrentWith,
        referenceOnly: !!s.referenceOnly,
        summary: summarize(stageSteps),
        steps: stageSteps,
      };
    });

    res.json({
      cafe: serializeCafe(cafe),
      summary: summarize(steps),
      stages,
    });
  } catch (e) {
    next(e);
  }
});

// Update café anchors / metadata → recompute planned dates.
app.patch('/api/cafes/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const existing = (
      await client.query(`SELECT * FROM cafes WHERE id = $1`, [req.params.id])
    ).rows[0];
    if (!existing) return res.status(404).json({ error: 'café not found' });

    const b = req.body || {};
    const next_ = {
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      region: b.region !== undefined ? b.region : existing.region,
      franchisee_name:
        b.franchiseeName !== undefined ? b.franchiseeName : existing.franchisee_name,
      fsm: b.fsm !== undefined ? b.fsm : existing.fsm,
      created_date:
        b.createdDate !== undefined ? toISODate(b.createdDate) : toISODate(existing.created_date),
      handover_date:
        b.handoverDate !== undefined
          ? toISODate(b.handoverDate)
          : toISODate(existing.handover_date),
      open_date:
        b.openDate !== undefined ? toISODate(b.openDate) : toISODate(existing.open_date),
      status: b.status !== undefined ? b.status : existing.status,
    };
    if (!next_.created_date) return res.status(400).json({ error: 'createdDate cannot be blank' });

    await client.query('BEGIN');
    const cafe = (
      await client.query(
        `UPDATE cafes SET name=$1, region=$2, franchisee_name=$3, fsm=$4,
           created_date=$5, handover_date=$6, open_date=$7, status=$8
         WHERE id=$9 RETURNING *`,
        [
          next_.name,
          next_.region,
          next_.franchisee_name,
          next_.fsm,
          next_.created_date,
          next_.handover_date,
          next_.open_date,
          next_.status,
          existing.id,
        ]
      )
    ).rows[0];
    await recomputePlannedDates(client, cafe);
    await client.query('COMMIT');
    res.json(serializeCafe(cafe));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Explicit regenerate-planned-dates endpoint (idempotent).
app.post('/api/cafes/:id/regenerate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const cafe = (await client.query(`SELECT * FROM cafes WHERE id = $1`, [req.params.id]))
      .rows[0];
    if (!cafe) return res.status(404).json({ error: 'café not found' });
    await client.query('BEGIN');
    // Add any steps introduced by newer template versions, then recompute.
    await generateStepInstances(client, cafe);
    await recomputePlannedDates(client, cafe);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Delete a café (and its steps via ON DELETE CASCADE).
app.delete('/api/cafes/:id', async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM cafes WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'café not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * Update / confirm a single step.
 * Body may contain: confirmed (bool), actualDate, confirmedBy, notes,
 * overrideReason, attachmentUrl.
 *  - confirmed=true with no actualDate → actualDate defaults to today.
 *  - confirmed=false → clears actualDate/confirmedBy (un-confirm).
 * planned_date is never touched here.
 */
app.patch('/api/steps/:id', async (req, res, next) => {
  try {
    const existing = (
      await pool.query(`SELECT * FROM step_instances WHERE id = $1`, [req.params.id])
    ).rows[0];
    if (!existing) return res.status(404).json({ error: 'step not found' });

    const b = req.body || {};
    let actual = toISODate(existing.actual_date);
    let confirmedBy = existing.confirmed_by;

    if (b.confirmed === true) {
      actual = toISODate(b.actualDate) || actual || todayISO();
      confirmedBy = b.confirmedBy || confirmedBy || null;
    } else if (b.confirmed === false) {
      actual = null;
      confirmedBy = null;
    } else if (b.actualDate !== undefined) {
      actual = toISODate(b.actualDate);
      if (actual && b.confirmedBy) confirmedBy = b.confirmedBy;
    }

    const notes = b.notes !== undefined ? b.notes : existing.notes;
    const overrideReason =
      b.overrideReason !== undefined ? b.overrideReason : existing.override_reason;
    const attachmentUrl =
      b.attachmentUrl !== undefined ? b.attachmentUrl : existing.attachment_url;

    const row = (
      await pool.query(
        `UPDATE step_instances
           SET actual_date=$1, confirmed_by=$2, notes=$3, override_reason=$4, attachment_url=$5
         WHERE id=$6 RETURNING *`,
        [actual, confirmedBy, notes, overrideReason, attachmentUrl, existing.id]
      )
    ).rows[0];
    res.json(serializeStep(row));
  } catch (e) {
    next(e);
  }
});

// Cross-café overdue register (feeds the on-platform flag + future email alerts).
app.get('/api/overdue', async (_req, res, next) => {
  try {
    const rows = (
      await pool.query(
        `SELECT si.*, c.name AS cafe_name, c.fsm AS cafe_fsm, c.status AS cafe_status
           FROM step_instances si
           JOIN cafes c ON c.id = si.cafe_id
          WHERE c.status = 'active'
            AND si.is_reference = false
            AND si.actual_date IS NULL
            AND si.planned_date IS NOT NULL
            AND si.planned_date < $1
          ORDER BY si.planned_date ASC`,
        [todayISO()]
      )
    ).rows;
    res.json(
      rows.map((r) => ({
        ...serializeStep(r),
        cafeName: r.cafe_name,
        cafeFsm: r.cafe_fsm,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Errors + boot
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error', detail: String(err.message || err) });
});

async function start() {
  try {
    await initDb();
    console.log('DB ready.');
  } catch (e) {
    console.error('DB init failed (server will still start; check DATABASE_URL):', e.message);
  }
  app.listen(PORT, () => console.log(`New Café & Franchisee Journey listening on :${PORT}`));
}

if (require.main === module) {
  start();
}

module.exports = { app, computePlannedDate, addDays, toISODate };
