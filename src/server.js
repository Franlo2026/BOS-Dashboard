// BOS Dashboard — server
// Express + PostgreSQL, with JWT auth and three roles:
//   admin  — full access + user management
//   editor — full access to log/edit data
//   viewer — read-only ("mirror" access, no write capability)
//
// Reference data (GAAP/KeyTech/Beeline/FSM structure) ships inside
// public/index.html and never touches this server — only live, user-logged
// data (visits/actions/ltl audits/trainer visits) and user accounts live here.

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '8mb' }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.');
  process.exit(1);
}
const TOKEN_TTL = '12h';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- schema ----------
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
      display_name  TEXT,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Live data tables — each row keeps its full record as JSONB, matching
  // the exact field names/shape the frontend already expects. This avoids
  // camelCase/snake_case drift and keeps server logic close to the original
  // JSON-file version.
  for (const table of ['visits', 'actions', 'ltl_audits', 'trainer_visits']) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  // Ops Task Tracker — folded in as a tab. Same fields as the standalone
  // tracker; task creation is open to any signed-in role (anyone should be
  // able to report an issue), completing a task requires editor/admin.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_tasks (
      id               TEXT PRIMARY KEY,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitter_name   TEXT NOT NULL,
      department       TEXT NOT NULL,
      cafe             TEXT NOT NULL,
      region           TEXT,
      escalation_label TEXT NOT NULL,
      escalation_hours INTEGER NOT NULL,
      comments         TEXT,
      completed        BOOLEAN NOT NULL DEFAULT FALSE,
      completed_by     TEXT,
      completed_at     TIMESTAMPTZ
    );
  `);
  // Photo attachment support — added later, so migrate existing tables safely.
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS photo_url TEXT;`);

  // Cafe Opening Timelines — folded in as a tab. Generic key/value store,
  // same shape as the standalone version's storage API, just reusing this
  // database instead of a separate one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Cafe Overview — migrated in from its standalone Supabase-backed version.
  // Mirrors the Supabase `cafe_status` table shape exactly (store_key,
  // store_name, fsm, region, data JSONB) so the existing checklist/scoring
  // frontend code needs no changes beyond where it fetches/saves.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cafe_status (
      store_key  TEXT PRIMARY KEY,
      store_name TEXT,
      fsm        TEXT,
      region     TEXT,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Bootstrap: create a first admin user if none exists yet, so the app is
  // usable on first deploy without needing direct DB access.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'changeme123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4)',
      [username, hash, 'admin', 'Administrator']
    );
    console.log(`Created initial admin user "${username}". Log in and change the password / add real users via the Admin tab.`);
  }
}

// ---------- auth helpers ----------
function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, displayName: user.display_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

function requireEditor(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'editor') {
    return res.status(403).json({ error: 'View-only account — editing is disabled' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ---------- auth routes ----------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid username or password' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
    const token = signToken(user);
    res.json({ token, username: user.username, role: user.role, displayName: user.display_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, displayName: req.user.displayName });
});

app.post('/api/change-password', authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.sub]);
    const user = rows[0];
    const ok = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.sub]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- admin: user management ----------
app.get('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, role, display_name, active, created_at FROM users ORDER BY created_at ASC');
  res.json(rows);
});

app.post('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, displayName } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role are required' });
    if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be admin, editor or viewer' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, display_name, active, created_at',
      [username, hash, role, displayName || username]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', authRequired, requireAdmin, async (req, res) => {
  try {
    const { role, active, password } = req.body;
    if (role && !['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (role) await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    if (active !== undefined) await pool.query('UPDATE users SET active = $1 WHERE id = $2', [active, req.params.id]);
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    }
    const { rows } = await pool.query('SELECT id, username, role, display_name, active, created_at FROM users WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- shared dashboard data (read: any logged-in role) ----------
app.get('/api/state', authRequired, async (req, res) => {
  try {
    const [visits, actions, ltl, trainer] = await Promise.all([
      pool.query('SELECT data FROM visits ORDER BY created_at ASC'),
      pool.query('SELECT data FROM actions ORDER BY created_at ASC'),
      pool.query('SELECT data FROM ltl_audits ORDER BY created_at ASC'),
      pool.query('SELECT data FROM trainer_visits ORDER BY created_at ASC'),
    ]);
    res.json({
      visits: visits.rows.map(r => r.data),
      actions: actions.rows.map(r => r.data),
      ltlAudits: ltl.rows.map(r => r.data),
      trainerVisits: trainer.rows.map(r => r.data),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- writes: editor or admin only ----------
app.post('/api/visits', authRequired, requireEditor, async (req, res) => {
  try {
    const { fsm, store, date, type, notes, actions, grindResponses } = req.body;
    if (!fsm || !store || !date || !type) return res.status(400).json({ error: 'fsm, store, date and type are required' });
    const visitId = newId('v');
    const visitRow = {
      id: visitId, fsm, store, date, type, notes: notes || '',
      actionCount: (actions || []).length,
      grindResponses: grindResponses || [],
    };
    await pool.query('INSERT INTO visits (id, data) VALUES ($1,$2)', [visitId, visitRow]);

    for (const a of (actions || [])) {
      const actionRow = {
        // spread first so any extra GRIND-task fields (priority, grindCategory,
        // issueDescription, requiredAction) pass straight through, then pin
        // down the fields the rest of the app depends on.
        ...a,
        id: newId('a'), fsm, store, pillar: a.pillar, description: a.description,
        owner: a.owner, dueDate: a.dueDate, status: 'open', createdDate: date, visitId,
      };
      await pool.query('INSERT INTO actions (id, data) VALUES ($1,$2)', [actionRow.id, actionRow]);
    }
    res.json({ ok: true, visitId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/actions/:id', authRequired, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM actions WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'action not found' });
    const action = rows[0].data;
    if (req.body.status) action.status = req.body.status;
    if (req.body.status === 'closed' && !action.closedDate) {
      action.closedDate = new Date().toISOString().slice(0, 10);
    }
    if (req.body.status && req.body.status !== 'closed') {
      // reopening — clear the closed date so it doesn't look closed-but-open
      delete action.closedDate;
    }
    if (req.body.dueDate) {
      action.dueDate = req.body.dueDate;
    }
    if (req.body.comment && req.body.comment.trim()) {
      if (!Array.isArray(action.comments)) action.comments = [];
      action.comments.push({
        text: req.body.comment.trim(),
        author: req.user.displayName || req.user.username,
        at: new Date().toISOString(),
      });
    }
    await pool.query('UPDATE actions SET data = $1 WHERE id = $2', [action, req.params.id]);
    res.json({ ok: true, action });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ltl', authRequired, requireEditor, async (req, res) => {
  try {
    const { fsm, store, date, score } = req.body;
    if (!fsm || !store || !date || score === undefined) return res.status(400).json({ error: 'fsm, store, date and score are required' });
    const audit = {
      id: newId('l'), fsm, store, date,
      score: Number(score), cspi: Number(req.body.cspi || 0),
      ncRaised: Number(req.body.ncRaised || 0), ncClosed: Number(req.body.ncClosed || 0),
      notes: req.body.notes || '',
    };
    await pool.query('INSERT INTO ltl_audits (id, data) VALUES ($1,$2)', [audit.id, audit]);
    res.json({ ok: true, audit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trainer-visits', authRequired, requireEditor, async (req, res) => {
  try {
    const { trainer, store, date } = req.body;
    if (!trainer || !store || !date) return res.status(400).json({ error: 'trainer, store and date are required' });
    const visit = { id: newId('t'), ...req.body };
    await pool.query('INSERT INTO trainer_visits (id, data) VALUES ($1,$2)', [visit.id, visit]);
    res.json({ ok: true, visit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Ops Task Tracker (folded in as a tab) ----------
app.get('/api/ops-tasks', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ops_tasks ORDER BY created_at DESC');
    res.json(rows.map(r => ({
      id: r.id, createdAt: r.created_at, submitterName: r.submitter_name,
      department: r.department, cafe: r.cafe, region: r.region,
      escalationLabel: r.escalation_label, escalationHours: r.escalation_hours,
      comments: r.comments, completed: r.completed, completedBy: r.completed_by,
      completedAt: r.completed_at, photoUrl: r.photo_url,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reporting an issue is open to any signed-in role, not just editors —
// anyone should be able to flag a problem at a store.
app.post('/api/ops-tasks', authRequired, async (req, res) => {
  try {
    const { department, cafe, region, escalationLabel, escalationHours, comments, submitterName, photoUrl } = req.body;
    if (!department || !cafe || !escalationLabel || !escalationHours) {
      return res.status(400).json({ error: 'department, cafe, escalationLabel and escalationHours are required' });
    }
    if (photoUrl && photoUrl.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo is too large — please use a smaller image.' });
    }
    const id = newId('t');
    await pool.query(
      `INSERT INTO ops_tasks (id, submitter_name, department, cafe, region, escalation_label, escalation_hours, comments, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, (submitterName && submitterName.trim()) || req.user.displayName || req.user.username, department, cafe, region || '', escalationLabel, escalationHours, comments || '', photoUrl || null]
    );
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/ops-tasks/:id/complete', authRequired, requireEditor, async (req, res) => {
  try {
    await pool.query(
      `UPDATE ops_tasks SET completed = TRUE, completed_by = $1, completed_at = NOW() WHERE id = $2`,
      [req.user.displayName || req.user.username, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Cafe Opening Timelines (folded in as a tab) ----------
// Generic key/value store — read is available to any signed-in role,
// writing (adding/removing a store) requires editor/admin.
app.get('/api/storage/:key', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM storage WHERE key = $1', [req.params.key]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/storage/:key', authRequired, requireEditor, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    await pool.query(
      `INSERT INTO storage (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [req.params.key, value]
    );
    res.json({ key: req.params.key, value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Cafe Overview (migrated in from standalone Supabase version) ----------
app.get('/api/cafe-status', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT store_key, store_name, fsm, region, data FROM cafe_status');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cafe-status', authRequired, requireEditor, async (req, res) => {
  try {
    const { store_key, store_name, fsm, region, data } = req.body;
    if (!store_key || data === undefined) return res.status(400).json({ error: 'store_key and data are required' });
    await pool.query(
      `INSERT INTO cafe_status (store_key, store_name, fsm, region, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (store_key) DO UPDATE SET store_name=$2, fsm=$3, region=$4, data=$5, updated_at=NOW()`,
      [store_key, store_name || store_key, fsm || '', region || '', data]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Reference data (GAAP/KeyTech/Beeline/aliases) ----------
// This data lives as a single source of truth inside public/index.html's
// <script id="bos-data"> block. This endpoint reads it from there rather
// than duplicating it, so cafe-overview.html (a separate page, used for
// the Store Health Report) can use the exact same figures without a
// second copy that could drift out of sync.
app.get('/api/reference-data', authRequired, (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const match = html.match(/<script id="bos-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return res.status(500).json({ error: 'reference data block not found in index.html' });
    res.json(JSON.parse(match[1]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// health check for Railway
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`BOS Dashboard running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
