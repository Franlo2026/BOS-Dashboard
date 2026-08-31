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
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '15mb' }));

const CAFE_SUBMISSION_KEY = process.env.CAFE_SUBMISSION_KEY || 'bootlegger-newcafe-2026';

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

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error('Could not create upload dir:', e.message); }

function saveBase64Photo(dataUrl, subfolder) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const dir = path.join(UPLOAD_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const filename = newId('img') + '.' + ext;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

// Generic version of saveBase64Photo — accepts any mime type (PDFs, Word
// docs, etc.), not just images. Used for CPA Timeline milestone attachments.
const FILE_EXT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv', 'text/plain': 'txt',
};
function saveBase64File(dataUrl, subfolder) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const dir = path.join(UPLOAD_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const ext = FILE_EXT_BY_MIME[mime] || (mime.split('/')[1] || 'bin').split('+')[0].replace(/[^a-zA-Z0-9]/g, '');
  const filename = newId('file') + '.' + (ext || 'bin');
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

function deletePhotoFile(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, url.replace('/uploads/', ''))); }
  catch (e) { /* already gone — fine */ }
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);
  for (const table of ['visits', 'actions', 'ltl_audits', 'trainer_visits']) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

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
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS photo_urls JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS responsible_person TEXT;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS edit_log JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS resolution_comment TEXT;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS is_non_conformance BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS due_date_override DATE;`);
  await pool.query(`ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS follow_up_notes JSONB DEFAULT '[]'::jsonb;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

// Marketing Tracker SSO handoff — issues a short-lived signed link (60s
// validity) that the Marketing Tracker's own backend verifies against the
// same shared secret before logging the browser in there. The Marketing
// Tracker's real password never appears in this app or any file a browser
// downloads — only requires a valid BOS session to obtain the link.
app.get('/api/marketing-tracker-link', authRequired, (req, res) => {
  const secret = process.env.MARKETING_TRACKER_SSO_SECRET;
  if (!secret) return res.status(503).json({ error: 'Marketing Tracker link is not configured yet — set MARKETING_TRACKER_SSO_SECRET on this app and BOS_SSO_SECRET on the Marketing Tracker (same value on both).' });
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret).update(`bos-entry:${ts}`).digest('hex');
  const base = process.env.MARKETING_TRACKER_URL || 'https://marketing-brief-tracker-production.up.railway.app';
  res.json({ url: `${base}/api/auth/bos-entry?ts=${ts}&sig=${sig}` });
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

app.get('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, role, display_name, email, active, created_at FROM users ORDER BY created_at ASC');
  res.json(rows);
});

app.post('/api/admin/users', authRequired, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, displayName, email } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role are required' });
    if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be admin, editor or viewer' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role, display_name, email) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, display_name, email, active, created_at',
      [username, hash, role, displayName || username, email || null]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', authRequired, requireAdmin, async (req, res) => {
  try {
    const { role, active, password, display_name, email } = req.body;
    if (role && !['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    if (role) await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    if (active !== undefined) await pool.query('UPDATE users SET active = $1 WHERE id = $2', [active, req.params.id]);
    if (display_name !== undefined) await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [display_name, req.params.id]);
    if (email !== undefined) await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email || null, req.params.id]);
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    }
    const { rows } = await pool.query('SELECT id, username, role, display_name, email, active, created_at FROM users WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.post('/api/visits', authRequired, requireEditor, async (req, res) => {
  try {
    const { fsm, store, date, type, notes, actions, grindResponses, fullReport } = req.body;
    if (!fsm || !store || !date || !type) return res.status(400).json({ error: 'fsm, store, date and type are required' });
    const visitId = newId('v');
    const photos = fullReport && fullReport.photos;
    const photoUrls = {};
    if (photos && typeof photos === 'object') {
      for (const [itemId, dataUrls] of Object.entries(photos)) {
        const list = Array.isArray(dataUrls) ? dataUrls : (dataUrls ? [dataUrls] : []);
        const saved = [];
        for (const dataUrl of list) {
          if (typeof dataUrl === 'string' && dataUrl.length > 6 * 1024 * 1024) continue;
          const url = dataUrl && dataUrl.startsWith('data:') ? saveBase64Photo(dataUrl, 'cafe-visits') : dataUrl;
          if (url) saved.push(url);
        }
        if (saved.length) photoUrls[itemId] = saved;
      }
    }
    const storedFullReport = fullReport ? { ...fullReport, photos: photoUrls } : null;
    const visitRow = {
      id: visitId, fsm, store, date, type, notes: notes || '',
      actionCount: (actions || []).length,
      grindResponses: grindResponses || [],
      photos: photoUrls,
      fullReport: storedFullReport,
    };
    await pool.query('INSERT INTO visits (id, data) VALUES ($1,$2)', [visitId, visitRow]);

    for (const a of (actions || [])) {
      const actionRow = {
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

app.put('/api/visits/:id', authRequired, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM visits WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'visit not found' });
    const visit = rows[0].data;
    const { fsm, store, date, type, notes, fullReport } = req.body;
    if (!fsm || !store || !date || !type) return res.status(400).json({ error: 'fsm, store, date and type are required' });

    const photos = fullReport && fullReport.photos;
    const photoUrls = {};
    if (photos && typeof photos === 'object') {
      for (const [itemId, dataUrls] of Object.entries(photos)) {
        const list = Array.isArray(dataUrls) ? dataUrls : (dataUrls ? [dataUrls] : []);
        const saved = [];
        for (const entry of list) {
          if (typeof entry === 'string' && entry.startsWith('data:')) {
            if (entry.length > 6 * 1024 * 1024) continue;
            const url = saveBase64Photo(entry, 'cafe-visits');
            if (url) saved.push(url);
          } else if (entry) {
            saved.push(entry);
          }
        }
        if (saved.length) photoUrls[itemId] = saved;
      }
    }

    const oldPhotos = (visit.fullReport && visit.fullReport.photos) || visit.photos || {};
    const stillReferenced = new Set(Object.values(photoUrls).flat());
    Object.values(oldPhotos).flat().forEach(url => {
      if (url && !stillReferenced.has(url)) deletePhotoFile(url);
    });

    const storedFullReport = fullReport ? { ...fullReport, photos: photoUrls } : visit.fullReport;
    const editor = req.user.displayName || req.user.username;
    if (!Array.isArray(visit.editLog)) visit.editLog = [];
    visit.editLog.push({ editedBy: editor, editedAt: new Date().toISOString() });

    const updatedVisit = {
      ...visit,
      fsm, store, date, type, notes: notes || visit.notes || '',
      photos: photoUrls,
      fullReport: storedFullReport,
      editLog: visit.editLog,
    };
    await pool.query('UPDATE visits SET data = $1 WHERE id = $2', [updatedVisit, req.params.id]);
    res.json({ ok: true, visit: updatedVisit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/visits/:id', authRequired, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM visits WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'visit not found' });
    const visit = rows[0].data;
    const photos = (visit.fullReport && visit.fullReport.photos) || visit.photos || {};
    Object.values(photos).forEach(urls => {
      (Array.isArray(urls) ? urls : [urls]).forEach(deletePhotoFile);
    });
    await pool.query('DELETE FROM visits WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/actions/:id', authRequired, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM actions WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'action not found' });
    const action = rows[0].data;
    const editor = req.user.displayName || req.user.username;
    if (!Array.isArray(action.editLog)) action.editLog = [];

    const editableFields = ['description', 'pillar', 'owner', 'store', 'fsm', 'dueDate'];
    editableFields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== action[field]) {
        action.editLog.push({ field, oldValue: action[field] ?? null, newValue: req.body[field], editedBy: editor, editedAt: new Date().toISOString() });
        action[field] = req.body[field];
      }
    });

    if (req.body.status && req.body.status !== action.status) {
      action.editLog.push({ field: 'status', oldValue: action.status ?? null, newValue: req.body.status, editedBy: editor, editedAt: new Date().toISOString() });
      action.status = req.body.status;
    }
    if (req.body.status === 'closed' && !action.closedDate) {
      action.closedDate = new Date().toISOString().slice(0, 10);
    }
    if (req.body.status && req.body.status !== 'closed') {
      delete action.closedDate;
    }
    if (req.body.comment && req.body.comment.trim()) {
      if (!Array.isArray(action.comments)) action.comments = [];
      action.comments.push({
        text: req.body.comment.trim(),
        author: editor,
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

app.get('/api/ops-tasks', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ops_tasks ORDER BY created_at DESC');
    res.json(rows.map(r => {
      // photo_urls is the current multi-photo column; photo_url is the
      // older single-photo one from before this existed. Merge both so old
      // tasks (single photo_url only) and new ones (photo_urls array) both
      // render correctly without duplicating an already-included URL.
      const urls = Array.isArray(r.photo_urls) ? r.photo_urls.slice() : [];
      if (r.photo_url && !urls.includes(r.photo_url)) urls.unshift(r.photo_url);
      return {
        id: r.id, createdAt: r.created_at, submitterName: r.submitter_name,
        department: r.department, cafe: r.cafe, region: r.region,
        escalationLabel: r.escalation_label, escalationHours: r.escalation_hours,
        comments: r.comments, completed: r.completed, completedBy: r.completed_by,
        completedAt: r.completed_at, photoUrl: r.photo_url, photoUrls: urls, responsiblePerson: r.responsible_person,
        editLog: r.edit_log || [], resolutionComment: r.resolution_comment, isNonConformance: r.is_non_conformance,
        notes: r.follow_up_notes || [],
        dueDateOverride: r.due_date_override ? new Date(r.due_date_override).toISOString().slice(0,10) : null,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ops-tasks', authRequired, async (req, res) => {
  try {
    const { department, cafe, region, escalationLabel, escalationHours, comments, submitterName, photoUrl, photoUrls, responsiblePerson, isNonConformance } = req.body;
    if (!department || !cafe || !escalationLabel || !escalationHours) {
      return res.status(400).json({ error: 'department, cafe, escalationLabel and escalationHours are required' });
    }
    // photoUrls (array) is the current multi-photo path from the Add Task
    // form; a lone photoUrl is still accepted for anything older that only
    // ever sends one. Either way everything ends up saved to disk and
    // recorded in the new photo_urls column.
    const incomingPhotos = Array.isArray(photoUrls) ? photoUrls : (photoUrl ? [photoUrl] : []);
    const MAX_PHOTOS = 6;
    if (incomingPhotos.length > MAX_PHOTOS) {
      return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos per task` });
    }
    for (const p of incomingPhotos) {
      if (p && p.length > 6 * 1024 * 1024) {
        return res.status(400).json({ error: 'One of those photos is too large — please use smaller images.' });
      }
    }
    const id = newId('t');
    const savedUrls = incomingPhotos.map(p => (p && p.startsWith('data:')) ? saveBase64Photo(p, 'ops-tasks') : p).filter(Boolean);
    const legacyPhotoUrl = savedUrls[0] || null; // keep first photo mirrored into the old column too, for anything still reading it
    await pool.query(
      `INSERT INTO ops_tasks (id, submitter_name, department, cafe, region, escalation_label, escalation_hours, comments, photo_url, photo_urls, responsible_person, is_non_conformance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, (submitterName && submitterName.trim()) || req.user.displayName || req.user.username, department, cafe, region || '', escalationLabel, escalationHours, comments || '', legacyPhotoUrl, JSON.stringify(savedUrls), responsiblePerson || null, !!isNonConformance]
    );
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/ops-tasks/:id', authRequired, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ops_tasks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'task not found' });
    const current = rows[0];
    const editor = req.user.displayName || req.user.username;
    const editLog = Array.isArray(current.edit_log) ? current.edit_log : [];

    const fieldMap = {
      department: 'department', cafe: 'cafe', region: 'region',
      escalationLabel: 'escalation_label', escalationHours: 'escalation_hours',
      comments: 'comments', responsiblePerson: 'responsible_person', submitterName: 'submitter_name',
      dueDateOverride: 'due_date_override', isNonConformance: 'is_non_conformance',
    };
    const updates = {};
    Object.entries(fieldMap).forEach(([bodyKey, col]) => {
      if (req.body[bodyKey] !== undefined && req.body[bodyKey] !== current[col]) {
        editLog.push({ field: bodyKey, oldValue: current[col] ?? null, newValue: req.body[bodyKey], editedBy: editor, editedAt: new Date().toISOString() });
        updates[col] = req.body[bodyKey];
      }
    });

    // Photo can be updated/replaced/removed from the edit form too. A new
    // data: URL gets saved to disk (and the old file cleaned up); an empty
    // string means "remove the photo"; undefined means "leave it alone".
    if (req.body.photoUrl !== undefined) {
      const incoming = req.body.photoUrl;
      if (incoming && incoming.length > 6 * 1024 * 1024) {
        return res.status(400).json({ error: 'Photo is too large — please use a smaller image.' });
      }
      let newPhotoUrl = current.photo_url;
      if (!incoming) {
        if (current.photo_url) deletePhotoFile(current.photo_url);
        newPhotoUrl = null;
      } else if (incoming.startsWith('data:')) {
        const saved = saveBase64Photo(incoming, 'ops-tasks');
        if (saved) {
          if (current.photo_url) deletePhotoFile(current.photo_url);
          newPhotoUrl = saved;
        }
      } else {
        newPhotoUrl = incoming; // already a saved URL, unchanged
      }
      if (newPhotoUrl !== current.photo_url) {
        editLog.push({ field: 'photoUrl', oldValue: current.photo_url ?? null, newValue: newPhotoUrl, editedBy: editor, editedAt: new Date().toISOString() });
        updates.photo_url = newPhotoUrl;
      }
    }

    // Full-array replace: the client sends the complete list it wants to
    // end up with (a mix of already-saved URLs it's keeping, plus any new
    // data: URLs for photos just added). Anything that was there before
    // but isn't in the new list gets its file deleted.
    if (req.body.photoUrls !== undefined) {
      const incoming = Array.isArray(req.body.photoUrls) ? req.body.photoUrls : [];
      const MAX_PHOTOS = 6;
      if (incoming.length > MAX_PHOTOS) {
        return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos per task` });
      }
      for (const p of incoming) {
        if (p && p.length > 6 * 1024 * 1024) {
          return res.status(400).json({ error: 'One of those photos is too large — please use smaller images.' });
        }
      }
      const currentUrls = Array.isArray(current.photo_urls) ? current.photo_urls : (current.photo_url ? [current.photo_url] : []);
      const newUrls = incoming.map(p => (p && p.startsWith('data:')) ? saveBase64Photo(p, 'ops-tasks') : p).filter(Boolean);
      currentUrls.filter(u => !newUrls.includes(u)).forEach(u => deletePhotoFile(u));
      if (JSON.stringify(newUrls) !== JSON.stringify(currentUrls)) {
        editLog.push({ field: 'photoUrls', oldValue: currentUrls, newValue: newUrls, editedBy: editor, editedAt: new Date().toISOString() });
        updates.photo_urls = JSON.stringify(newUrls);
        updates.photo_url = newUrls[0] || null; // keep the legacy single-photo column mirrored to the first photo
      }
    }

    // A follow-up note/question — distinct from Edit, which replaces
    // fields outright. This appends to a running log instead, same as the
    // "update" thread on visit-created actions.
    if (req.body.note && req.body.note.trim()) {
      const currentNotes = Array.isArray(current.follow_up_notes) ? current.follow_up_notes : [];
      const newNotes = [...currentNotes, { text: req.body.note.trim(), author: editor, at: new Date().toISOString() }];
      updates.follow_up_notes = JSON.stringify(newNotes);
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, unchanged: true });
    }
    // BUG FIX: edit_log is its own top-level JSONB column here (unlike
    // actions.data, which nests editLog inside one big object column) —
    // passing the bare JS array straight to node-pg makes it serialize as
    // a Postgres ARRAY literal instead of JSON, which Postgres then rejects
    // for a JSONB column with "invalid input syntax for type json". It has
    // to be explicitly stringified first.
    updates.edit_log = JSON.stringify(editLog);
    const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE ops_tasks SET ${setClauses} WHERE id = $1`, [req.params.id, ...Object.values(updates)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/ops-tasks/:id/complete', authRequired, requireEditor, async (req, res) => {
  try {
    const comment = (req.body && req.body.comment && req.body.comment.trim()) || null;
    await pool.query(
      `UPDATE ops_tasks SET completed = TRUE, completed_by = $1, completed_at = NOW(), resolution_comment = COALESCE($3, resolution_comment) WHERE id = $2`,
      [req.user.displayName || req.user.username, req.params.id, comment]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generic file attachment upload — used by the New Cafés CPA Timeline
// milestones (contracts, signed applications, invoices, etc). Files land
// on the Railway Volume under UPLOAD_DIR, same as task photos, never in
// the database.
app.post('/api/upload-file', authRequired, requireEditor, async (req, res) => {
  try {
    const { dataUrl, subfolder } = req.body;
    const safeSubfolder = (subfolder || 'misc').replace(/[^a-zA-Z0-9_-]/g, '') || 'misc';
    const url = saveBase64File(dataUrl, safeSubfolder);
    if (!url) return res.status(400).json({ error: 'Invalid or missing file data' });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.post('/api/public/cafe-submissions', async (req, res) => {
  try {
    const { key, submittedBy, stores } = req.body || {};
    if (key !== CAFE_SUBMISSION_KEY) return res.status(403).json({ error: 'Invalid or missing submission link' });
    if (!Array.isArray(stores) || !stores.length) return res.status(400).json({ error: 'No store rows in submission' });
    const { rows } = await pool.query("SELECT value FROM storage WHERE key = 'cafe-submissions-v1'");
    const existing = rows[0] ? JSON.parse(rows[0].value) : [];
    const now = new Date().toISOString();
    const added = stores.map((s, i) => ({
      id: 'sub_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 7),
      status: 'pending',
      submittedBy: (submittedBy || 'New Business Team').toString().slice(0, 200),
      submittedAt: now,
      ...s,
    }));
    const updated = [...existing, ...added];
    await pool.query(
      `INSERT INTO storage (key, value) VALUES ('cafe-submissions-v1', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(updated)]
    );
    res.json({ ok: true, count: added.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

const PHOTO_RETENTION_DAYS = 30;
async function cleanupOldTaskPhotos() {
  try {
    const { rows } = await pool.query(
      `SELECT id, photo_url, photo_urls FROM ops_tasks
       WHERE completed = TRUE AND (photo_url IS NOT NULL OR jsonb_array_length(COALESCE(photo_urls, '[]'::jsonb)) > 0)
         AND completed_at < NOW() - INTERVAL '${PHOTO_RETENTION_DAYS} days'`
    );
    if (!rows.length) return;
    for (const r of rows) {
      if (r.photo_url) deletePhotoFile(r.photo_url);
      (Array.isArray(r.photo_urls) ? r.photo_urls : []).forEach(deletePhotoFile);
    }
    await pool.query(
      `UPDATE ops_tasks SET photo_url = NULL, photo_urls = '[]'::jsonb
       WHERE completed = TRUE AND (photo_url IS NOT NULL OR jsonb_array_length(COALESCE(photo_urls, '[]'::jsonb)) > 0)
         AND completed_at < NOW() - INTERVAL '${PHOTO_RETENTION_DAYS} days'`
    );
    console.log(`Photo cleanup: cleared photos from ${rows.length} task(s) completed over ${PHOTO_RETENTION_DAYS} days ago.`);
  } catch (e) {
    console.error('Photo cleanup failed:', e.message);
  }
}

app.get('/api/admin/photo-stats', authRequired, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        count(*) FILTER (WHERE photo_url IS NOT NULL) AS total_with_photo,
        count(*) FILTER (WHERE photo_url LIKE 'data:%') AS legacy_base64_in_db,
        count(*) FILTER (WHERE photo_url LIKE '/uploads/%') AS on_disk,
        count(*) FILTER (WHERE completed = TRUE AND photo_url IS NOT NULL AND completed_at < NOW() - INTERVAL '${PHOTO_RETENTION_DAYS} days') AS eligible_for_cleanup,
        pg_size_pretty(coalesce(sum(length(photo_url)) FILTER (WHERE photo_url LIKE 'data:%'), 0)) AS legacy_base64_size
      FROM ops_tasks
    `);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/cleanup-photos', authRequired, requireAdmin, async (req, res) => {
  try {
    await cleanupOldTaskPhotos();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Non-Conformance Notice: AI auto-populate proxy ----------
// Client sends the raw field notes plus the clause library (kept in the
// front-end HTML so it stays a single source of truth); this endpoint just
// adds the system prompt and forwards to Anthropic with the server-side key,
// since a public page can't safely hold an API key itself.
// ---------- Escalation Matrix (Brand Standards, June 2026 v1.0) ----------
// Used to determine the correct first-deviation action/deadline for each
// non-conformance category identified in raw notes. Kept server-side since
// it informs the notice's remedy timeframe rather than the letter template.
const ESCALATION_MATRIX = [
  { category: 'Coffee beans (espresso/decaf) out of stock', action1: 'Immediate store closure — may not trade without coffee beans in stock; auto-generated emergency order same day; special delivery charge to franchisee', escalation: 'Breach letter issued by Head Office on first occurrence (critical/non-negotiable)' },
  { category: 'Other IP/branded products out of stock (packaging, sauces, Silo Bakery, sugar sachets, serviettes, branded consumables)', action1: 'Auto-generated order placed same day; special delivery charge; must be in stock within 48–72 hours', escalation: 'Shorter deadline + escalation on 2nd deviation; breach letter on 3rd/critical' },
  { category: 'IP element damage/absence — general (signage, fixtures)', action1: 'Repair within 3 days, franchisee pays with proof of payment', escalation: 'Contractors quoted on 2nd deviation; HQ pays and bills back franchisee + breach letter on 3rd' },
  { category: 'Neon sign', action1: 'Repair within 7 days, franchisee pays with proof of payment', escalation: 'HQ pays and bills back + breach letter on non-compliance' },
  { category: 'Trading hours / Wi-Fi signage', action1: 'Must be displayed, current and undamaged at all times; repair/replace immediately', escalation: 'HQ pays and bills back + breach letter on non-compliance' },
  { category: 'Plants (upkeep/replacement)', action1: 'Replace within 7 days', escalation: 'Order placed on behalf of store; billed back; breach letter if unresolved' },
  { category: 'Branded crockery & glassware', action1: 'Order for next delivery', escalation: 'Order placed on behalf of store; billed back' },
  { category: 'A-Frame & table talkers', action1: 'Order for next delivery', escalation: 'Order placed on behalf of store; billed back' },
  { category: 'Timber slatted hatch / floating timber ceiling', action1: 'Repair within 3 days', escalation: 'HQ pays and bills back + breach letter' },
  { category: 'Marketing/advertising not brand-compliant', action1: 'Remove from all mediums and correct before re-publishing', escalation: 'Immediate removal + breach letter on 2nd deviation/critical' },
  { category: 'Certificates — legal (liquor licence, COA, occupancy, business licence)', action1: 'Application submitted to relevant council/supplier within 7 days', escalation: 'Breach letter issued by Head Office if not resolved' },
  { category: 'Certificates — financial (VAT, tax clearance)', action1: 'Application made to SARS and submitted to HQ within 14 days', escalation: 'Breach letter issued by Head Office if not resolved' },
  { category: 'Certificates — technical COCs (electrical, gas, HVAC, plumbing, glazing, fire, pest control, extraction cleaning)', action1: 'Application submitted to relevant council/supplier within 7 days', escalation: 'Breach letter issued by Head Office if not resolved' },
  { category: 'Certificates — entertainment (SAMRO, SAMPRO, TV licence)', action1: 'Application made to relevant department within 14 days', escalation: 'Breach letter issued by Head Office if not resolved' },
  { category: 'Certificates — safety (First Aid, Fire Fighter, H&S Rep, COVID Officer)', action1: 'Training and certification completed within 30 days', escalation: 'Breach letter issued by Head Office if not resolved' },
  { category: 'Payroll documentation (payslips, UIF, hours, rate, leave, minimum wage)', action1: 'Complete payslip with all required detail provided in the next payroll run', escalation: 'Breach letter issued by Head Office if unresolved' },
  { category: 'Employment contracts (signed, commencement date, CoC, remuneration, hours, supporting documents)', action1: 'Complete contract with all required detail provided within 30 days', escalation: 'Breach letter issued by Head Office if unresolved' },
  { category: 'Uniform — management/barista/FOH/kitchen items (branded golfer, denim shirt, chef jacket, apron, cap, jersey, name badge)', action1: 'Order placed by franchisee same day; POP sent to FSM/RFM; 7-day lead time', escalation: 'Auto-generated order with special delivery charge + breach letter issued by Head Office' },
  { category: 'Uniform — own-purchase items (blue jeans, black shoes, black chef pants, boots)', action1: 'Staff to purchase within 48 hours', escalation: 'Staff to purchase within 24 hours + breach letter issued if unresolved' },
  { category: 'Hygiene — FOH surfaces/floors/fixtures/POS/menus/chairs/sauce fridge', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Hygiene — customer toilets', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Hygiene — bar/deli (incl. coffee machine & grinder)', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Hygiene — grill line (incl. fryer, extraction canopy, fridges)', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Hygiene — filleting & storage areas', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Hygiene — scullery (dishwasher, crockery, cutlery, hand basin)', action1: 'Rectify within 24 hours, or FSM conducts a field audit', escalation: 'RFM calls in a cleaning company at franchisee\'s expense, billed back; breach letter issued' },
  { category: 'Cleaning chemicals (Kem Klean) missing/low', action1: 'Order placed by franchisee same day; POP to FSM/RFM; next delivery day', escalation: 'Auto-generated order with special delivery charge + breach letter issued' },
  { category: 'Field audit swab test failure', action1: 'Surfaces retested within 24 hours; Kem Klean training within 24 hours', escalation: 'FCS called in by RFM at franchisee\'s expense + breach letter issued' },
  { category: 'Colour coding & hand wash facilities', action1: 'Items cleaned immediately per Bootlegger SOP', escalation: 'Items cleaned immediately per SOP + breach letter issued' },
  { category: 'Equipment — flat tops / salamanders', action1: 'If only one in store: cannot open; if two: 7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back franchisee + breach letter issued' },
  { category: 'Equipment — fryers (double)', action1: 'Damaged double fryer: store may not trade', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Equipment — extractor fan', action1: 'Immediate — store may not trade', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Fire equipment service', action1: 'Immediate action required', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Freezer / cold room', action1: 'Immediate action required', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Dishwasher / thermometer', action1: 'Immediate action required', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Geysers / blockages / plumbing', action1: 'Geysers & blockages: immediate; plumbing: 3 days', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'POS hardware & software', action1: 'Immediate, unless a secondary device is in place', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Credit card machines / takeaway devices', action1: 'Immediate action required', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Alarm system / fire equipment (FOH)', action1: 'Immediate action required', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Lights / signage (general)', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Chip warmer / chest freezer / upright fridge-freezer', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Underbar fridge / section tables', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Gas boiling table / induction cookers / mincer', action1: '3 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Coffee machine / grinder — missed service schedule', action1: 'HQ automatically books the service on the store\'s behalf; full cost recovered from franchisee, no grace period', escalation: 'Same — no grace period applies' },
  { category: 'Merry Chef — missed service schedule', action1: 'HQ automatically books the service on the store\'s behalf; full cost recovered from franchisee, no grace period', escalation: 'Same — no grace period applies' },
  { category: 'Merry Chef — unscheduled breakdown', action1: '3 days to repair; contractor appointed, quote submitted; HQ pays and bills back franchisee', escalation: 'Breach letter issued' },
  { category: 'Oven', action1: '3 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Milkshake mixer / blender', action1: '3 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Microwave', action1: 'Immediate', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Cameras', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Tables / chairs (FOH)', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Air conditioning & air duct extraction', action1: '7 days to repair', escalation: 'Contractor appointed, quote submitted; HQ pays and bills back + breach letter issued' },
  { category: 'Franchise fee non-payment', action1: 'Due 7th of the month; letter of demand issued on Day 8', escalation: 'Breach letter issued by the 10th of the month if payment not received' },
  { category: 'Roastery account non-payment', action1: 'Due 7 days from delivery invoice date; account blocked immediately if not paid within 7 days', escalation: 'Breach letter issued if payment not received within 10 days of invoice' },
  { category: 'B.Better Academy course completion below 90%', action1: 'Immediate non-conformance notice', escalation: 'Breach letter issued if 90% compliance not achieved within 7 days of the notice' },
  { category: 'Failure to acknowledge Head Office/franchise support communication', action1: 'Must acknowledge within 48 hours of receipt', escalation: 'Immediate breach letter issued on non-compliance' },
];

app.post('/api/notices/auto-populate', authRequired, async (req, res) => {
  try {
    const { rawNotes, clauseLibrary, today } = req.body;
    if (!rawNotes || !String(rawNotes).trim()) {
      return res.status(400).json({ error: 'rawNotes is required' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this server. Add it in Railway → Variables.' });
    }
    const clauseListText = (Array.isArray(clauseLibrary) ? clauseLibrary : [])
      .map(c => `${c.id}: Clause ${c.id.replace(/^c/, '')} — ${c.title} — ${c.text}`)
      .join('\n');

    const escalationText = ESCALATION_MATRIX
      .map(m => `- ${m.category} → 1st deviation: ${m.action1}. Escalation if unresolved: ${m.escalation}`)
      .join('\n');

    const systemPrompt = `You convert raw, messy field notes about a Bootlegger franchisee non-conformance into structured JSON for a breach/non-conformance notice generator. Respond with ONLY a single valid JSON object — no markdown fences, no preamble, no commentary.

Available Franchise Agreement clauses (use the "id" field verbatim when you reference one, pick only clauses genuinely supported by the notes, do not invent clauses):
${clauseListText}

Brand Standards Escalation Matrix (June 2026 v1.0) — use this to determine the correct action and completion deadline for each non-conformance item, based on category:
${escalationText}

How to use the Escalation Matrix: for each breach item you identify, match it to the closest category above and use its "1st deviation" action and deadline to set remedyTimeframe/remedyItems (or immediateAction if the action says "Immediate" or describes something the store must stop or close for). If the raw notes indicate this is a repeat/second occurrence of the same issue, use the escalation (2nd/3rd deviation) action instead and mention the shorter deadline. If an item doesn't clearly match any category, fall back to sensible judgement using the Franchise Agreement clauses instead. Do not invent categories or deadlines not supported by the matrix or the notes.

Output JSON schema (all fields optional/omit if not inferable, use empty string/array/false as appropriate):
{
  "toEntity": string,
  "storeName": string,
  "attention": [string],
  "greeting": string,
  "basisType": "operational_visit" | "email_correspondence" | "operational_review" | "custom",
  "basisDate": "YYYY-MM-DD" or "",
  "basisCustom": string,
  "clausesBreached": [{"clauseId": string, "clause": string, "description": string}],
  "breachItems": [string],
  "immediateEnabled": boolean,
  "immediateTimeframe": string,
  "immediateItems": [string],
  "remedyTimeframe": string,
  "remedyItems": [string],
  "requireEvidence": boolean,
  "followUpInspection": boolean,
  "urgencyLine": string,
  "supportLine": string
}

Guidance: choose remedyTimeframe based on severity and the matched clauses (e.g. health/safety → "3 (three) days"; equipment → "24 (twenty four) hours"; premises/maintenance → "48 (forty eight) hours"; general → "7 (seven) days"). Write breachItems as short factual bullet points in professional letter language, not verbatim notes. Only set immediateEnabled true if the notes describe something needing to stop immediately. Today's date is ${today || new Date().toISOString().slice(0,10)}.

If the notes come from a GRIND Café Support / Store Visit Report, they follow a repeated pattern: a bold section heading (e.g. "Staffing — adequately staffed; mgmt/supervisor on shift & uniformed"), a highlighted finding/observation line describing what was seen, and a green action line starting with "→" that records what happened as a result. Use the action line — not the finding alone — to decide whether a section belongs in this notice:
- If the action line says "Logged as Non-Conformance" (with an Owner and/or Due date), INCLUDE it: use the finding text as the breachItem wording, and use any "Due: YYYY-MM-DD" date to help set remedyTimeframe/remedyItems (e.g. "by 31 July 2026"). The "Owner" name is who is responsible for fixing it — use it for responsiblePerson-type context only if no better attention name is given elsewhere in the notes.
- If the action line says "Retrained and Rectified" or "Satisfactory Outcome — No Action" (or similar language showing it was resolved on the spot during the visit), EXCLUDE that section entirely — it is not a breach requiring formal notice action, even though the finding text may look negative on its own.
- Only sections explicitly logged as non-conformances should end up in breachItems, clausesBreached, or remedyItems.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: String(rawNotes) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      return res.status(502).json({ error: `Anthropic API error: ${anthropicRes.status} ${errText}`.slice(0, 500) });
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'No text in Anthropic response' });

    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      return res.status(502).json({ error: 'Could not parse AI response as JSON' });
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================================================================
// Email — Microsoft 365 via Graph API (application permissions)
// ==================================================================
// Setup needed from your IT manager, in Microsoft Entra ID (Azure AD):
//   1. Register a new app (any name, e.g. "BOS Dashboard Mailer").
//   2. API permissions -> Microsoft Graph -> Application permissions ->
//      Mail.Send -> add it, then an admin must click "Grant admin consent".
//      (Application permission, not Delegated — this sends as a fixed
//      mailbox with no user sign-in involved, which is what a server needs.)
//   3. Certificates & secrets -> New client secret -> copy the VALUE
//      immediately (it's only shown once).
//   4. Note down: Tenant ID, Application (client) ID, the client secret
//      value, and which real mailbox in your tenant BOS should send from
//      (e.g. bos@bootlegger.co.za — it must be a real, licensed mailbox).
//
// Then set these on Railway (Variables tab on the BOS service):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL
//
// Nothing below runs until all four are set — sendEmail() just logs a
// warning and returns until then, so this is safe to deploy right away.
const MS_TENANT_ID = process.env.MS_TENANT_ID;
const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MS_SENDER_EMAIL = process.env.MS_SENDER_EMAIL;
const EMAIL_CONFIGURED = !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_SENDER_EMAIL);

// Master switch for the four RECURRING automatic digest jobs — stored in
// the same generic storage table everything else uses, defaults to OFF.
// This is intentionally separate from EMAIL_CONFIGURED: email sending
// itself can be fully wired up and manually tested (via the run-once
// endpoints below) while the automatic recurring sends stay dormant
// until this is explicitly switched on. Nothing automatic ever fires
// until an admin turns this on from the control panel.
const EMAIL_AUTOMATION_KEY = 'email-automation-enabled';
async function isEmailAutomationEnabled() {
  try {
    const { rows } = await pool.query('SELECT value FROM storage WHERE key = $1', [EMAIL_AUTOMATION_KEY]);
    return rows[0] ? rows[0].value === 'true' : false;
  } catch (e) { return false; }
}
async function setEmailAutomationEnabled(enabled) {
  await pool.query(
    `INSERT INTO storage (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [EMAIL_AUTOMATION_KEY, enabled ? 'true' : 'false']
  );
}

let _graphTokenCache = { token: null, expiresAt: 0 };
async function getGraphAccessToken() {
  const now = Date.now();
  if (_graphTokenCache.token && now < _graphTokenCache.expiresAt - 60000) {
    return _graphTokenCache.token; // reuse until ~1 min before real expiry
  }
  const url = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph token request failed: ${data.error_description || data.error || res.status}`);
  _graphTokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return data.access_token;
}

// to/cc: a string or array of email addresses. html: the email body.
// Never throws to the caller by default (logs and returns false instead)
// so a failed notification never takes down whatever triggered it —
// pass throwOnError:true if a specific caller genuinely needs to know.
let _testModeOverrideEmail = null;
// ==================================================================
// Letterhead email template — matches Franlo's trimmed spec exactly:
// To:/café name/Attention header, subject title + café name repeated,
// a generic greeting (not personalized to the recipient), the body
// content, a generic team sign-off (not an individual's name/title/
// phone), and the full head-office footer with registration details.
// Deliberately has NO company address header, NO date line, and NO
// divider rules — those were cut as too much boilerplate for routine
// notifications.
// ==================================================================
function buildLetterheadEmailHtml({ cafeName, attentionName, subjectTitle, bodyHtml }) {
  const f = (s) => s || '';
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.5;max-width:640px;">
      <p style="margin:0;">To:</p>
      <p style="margin:0 0 4px;">Bootlegger ${f(cafeName)}</p>
      ${attentionName ? `<p style="margin:0 0 14px;">Attention: ${f(attentionName)}</p>` : ''}
      <p style="font-weight:700;color:#c8ae79;text-transform:uppercase;margin:0 0 2px;">${f(subjectTitle)}</p>
      <p style="margin:0 0 14px;">Bootlegger ${f(cafeName)}</p>
      <p>Good day team</p>
      ${bodyHtml}
      <p style="margin-top:18px;">Regards,</p>
      <p style="margin:0 0 18px;">Bootlegger Franchise Support Team</p>
      <p style="font-weight:700;margin:0;">Bootlegger Head Office</p>
      <p style="margin:0;">1st floor, Silo Building, The Coffee Depot, 47 Morningside Road, Ndabeni, 7405</p>
      <p style="margin:0 0 10px;">+27 21 433 2599</p>
      <p style="font-weight:700;margin:0;">Bootlegger Franchise (Pty) Ltd.</p>
      <p style="margin:0;">Reg No: 2017/428048/07</p>
      <p style="margin:0;">VAT No: 4110284793</p>
    </div>`;
}

async function sendEmail({ to, cc, subject, html, throwOnError = false }) {
  if (!EMAIL_CONFIGURED) {
    console.warn('sendEmail() called but Microsoft 365 email is not configured yet — set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL on Railway.');
    return { ok: false, error: 'Email is not configured yet — set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL on Railway' };
  }
  let actualTo = to, actualCc = cc, actualSubject = subject, actualHtml = html;
  if (_testModeOverrideEmail) {
    const originalTo = (Array.isArray(to) ? to : [to]).filter(Boolean).join(', ') || '(no recipients would have been found)';
    actualTo = _testModeOverrideEmail;
    actualCc = undefined;
    actualSubject = '[TEST MODE] ' + subject;
    actualHtml = `<p style="background:#fffbe6;padding:8px 10px;border:1px solid #e6c200;margin-bottom:12px;"><b>Test mode</b> — this would normally have gone to: ${originalTo}</p>` + html;
  }
  const toList = (Array.isArray(actualTo) ? actualTo : [actualTo]).filter(Boolean).map(addr => ({ emailAddress: { address: addr } }));
  const ccList = actualCc ? (Array.isArray(actualCc) ? actualCc : [actualCc]).filter(Boolean).map(addr => ({ emailAddress: { address: addr } })) : [];
  if (!toList.length) return { ok: false, error: 'No recipients to send to' };
  try {
    const token = await getGraphAccessToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_SENDER_EMAIL)}/sendMail`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { subject: actualSubject, body: { contentType: 'HTML', content: actualHtml }, toRecipients: toList, ccRecipients: ccList },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      // Graph's error body is JSON with a nested error.message — pull the
      // human-readable part out so the frontend can show something useful
      // like "Access is denied" or "mailbox not found", not a raw dump.
      let friendly = errBody;
      try { friendly = JSON.parse(errBody).error?.message || errBody; } catch (e) { /* leave as raw text */ }
      throw new Error(`Graph sendMail failed (${res.status}): ${friendly}`);
    }
    return { ok: true };
  } catch (e) {
    console.error('sendEmail() error:', e.message);
    if (throwOnError) throw e;
    return { ok: false, error: e.message };


  }
}

// ==================================================================
// Notification recipient resolution — shared by every digest below
// ==================================================================
// Reads café contact details (email, franchisee_email, fsm) from the
// live index.html data blob, and cross-references which regional manager
// (Franlo / Tarryn Palmer) owns a given FSM, via the same managers
// mapping the scheduler and reference-data endpoint already use.
function getStoresAndManagersData() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const bosMatch = html.match(/<script id="bos-data" type="application\/json">([\s\S]*?)<\/script>/);
  const cafeMatch = html.match(/<script id="cafe-data" type="application\/json">([\s\S]*?)<\/script>/);
  const bosData = bosMatch ? JSON.parse(bosMatch[1]) : { fsmStores: {}, managers: {} };
  const cafeData = cafeMatch ? JSON.parse(cafeMatch[1]) : { STORES: [] };
  const storesByName = {};
  const storesByAbbr = {};
  (cafeData.STORES || []).forEach(s => {
    storesByName[s.store_name] = s;
    if (s.abbr && s.region) storesByAbbr[s.abbr + '_' + s.region] = s;
  });
  const managerOfFsm = {};
  Object.entries(bosData.managers || {}).forEach(([mgr, fsmList]) => {
    (fsmList || []).forEach(fsm => { managerOfFsm[fsm] = mgr; });
  });
  return { storesByName, storesByAbbr, managerOfFsm };
}

// Some manager keys used throughout BOS's data are short internal labels,
// not the person's real name as it'll appear in the users table (Tarryn's
// key already happens to be her full name, but Franlo's isn't) — this is
// a known, permanent convention difference, not a typo, so it's handled
// as an explicit alias rather than by fuzzy matching.
const MANAGER_NAME_ALIASES = { Franlo: 'Franlo Geldenhuys' };

function normalizePersonName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Looks up a user's email by name, tolerating minor real-world spelling
// drift between the canonical FSM/manager name used in BOS's data and
// whatever got typed into that person's Display Name in Admin — e.g.
// "Charlene v Heerden" (canonical) vs "Charlene Van Heerden" (as entered).
// Tries an exact match first (fast path, no ambiguity), then an explicit
// alias, then falls back to a normalized comparison against every active
// user. If more than one user normalizes to the same thing, this
// deliberately returns nothing rather than guessing which one is right.
async function findUserEmailByName(name) {
  if (!name) return null;
  const exact = await pool.query('SELECT email FROM users WHERE display_name = $1 AND email IS NOT NULL', [name]);
  if (exact.rows[0]) return exact.rows[0].email;

  const aliased = MANAGER_NAME_ALIASES[name];
  if (aliased) {
    const aliasMatch = await pool.query('SELECT email FROM users WHERE display_name = $1 AND email IS NOT NULL', [aliased]);
    if (aliasMatch.rows[0]) return aliasMatch.rows[0].email;
  }

  const target = normalizePersonName(name);
  const all = await pool.query('SELECT display_name, email FROM users WHERE email IS NOT NULL');
  const matches = all.rows.filter(u => normalizePersonName(u.display_name) === target);
  return matches.length === 1 ? matches[0].email : null;
}

// Recipients for a given café + its FSM: the café's own mailbox, the
// FSM's email (looked up in the users table by matching display name),
// their regional manager's email, and the franchisee's email once that's
// been captured (currently blank for every café — there's no UI yet to
// enter it, flagged separately). Anyone whose email isn't on file is
// silently skipped rather than blocking the whole notification.
async function resolveStoreNotificationRecipientsLabeled(storeName, fsmName) {
  const { storesByName, managerOfFsm } = getStoresAndManagersData();
  const store = storesByName[storeName] || {};
  const out = [];
  const seen = new Set();
  const add = (label, email) => { if (email && !seen.has(email)) { seen.add(email); out.push({ label, email }); } };
  add('Café', store.email);
  add('Franchisee' + (store.franchisee_name ? ` (${store.franchisee_name})` : ''), store.franchisee_email);
  add('Operator' + (store.operator_name ? ` (${store.operator_name})` : ''), store.operator_email);
  if (fsmName) {
    add(`FSM (${fsmName})`, await findUserEmailByName(fsmName));
    const mgrName = managerOfFsm[fsmName];
    if (mgrName) add(`Regional Manager (${mgrName})`, await findUserEmailByName(mgrName));
  }
  return out;
}
// Modal-facing version — always shows FSM and Regional Manager as visible
// options, even if their email isn't set yet (email: null, disabled on
// the frontend), so it's obvious who's missing a contact rather than
// them silently not appearing as a choice at all. The daily digest jobs
// use the strict version above instead, since they need real, sendable
// addresses only.
async function resolveStoreNotificationRecipientsForModal(storeName, fsmName) {
  const { storesByName, managerOfFsm } = getStoresAndManagersData();
  const store = storesByName[storeName] || {};
  const out = [];
  const seen = new Set();
  const add = (label, email, missingNote) => {
    if (email) { if (!seen.has(email)) { seen.add(email); out.push({ label, email }); } }
    else out.push({ label, email: null, missing: missingNote || 'No email on file' });
  };
  add('Café', store.email, 'No café email on file');
  if (store.franchisee_name || store.franchisee_email) add(`Franchisee${store.franchisee_name ? ` (${store.franchisee_name})` : ''}`, store.franchisee_email, 'No franchisee email on file');
  if (store.operator_name || store.operator_email) add(`Operator${store.operator_name ? ` (${store.operator_name})` : ''}`, store.operator_email, 'No operator email on file');
  if (fsmName) {
    add(`FSM (${fsmName})`, await findUserEmailByName(fsmName), `${fsmName} has no email set, or their Admin display name doesn't match "${fsmName}" closely enough — check Admin \u2192 User Management`);
    const mgrName = managerOfFsm[fsmName];
    if (mgrName) add(`Regional Manager (${mgrName})`, await findUserEmailByName(mgrName), `${mgrName} has no email set, or their Admin display name doesn't match closely enough — check Admin \u2192 User Management`);
  }
  return out;
}
async function resolveStoreNotificationRecipients(storeName, fsmName) {
  const labeled = await resolveStoreNotificationRecipientsLabeled(storeName, fsmName);
  return labeled.map(r => r.email);
}

// ==================================================================
// Daily digest — overdue tasks/actions
// ==================================================================
// Runs once a day: finds every open action whose due date has passed,
// groups them by café, and sends each café's FSM/mailbox/manager/
// franchisee one digest listing everything overdue there. A café with
// nothing overdue gets no email at all.
// ==================================================================
// Daily digest — visit frequency & LTL "at risk" cafés
// ==================================================================
// Mirrors the exact thresholds already used on the Dashboard/LTL pages:
// a café is visit-overdue if it hasn't had ANY visit (confirmed or full
// report — this KPI counts both) in the last 28 days, and LTL-at-risk if
// its latest score is below 85% AND it has a non-conformance open for
// more than 7 days. Same recipient set as the task digest above.
// Shared by every digest below — tracks real send outcomes (not just
// "the function ran without throwing") so the manual test-run endpoint
// can report accurately whether things actually sent, rather than
// silently swallowing Graph API failures the way fire-and-forget calls
// would.
function newDigestSummary() { return { attempted: 0, sent: 0, failed: 0, errors: [] }; }
async function sendAndTrack(summary, emailArgs) {
  summary.attempted++;
  const result = await sendEmail(emailArgs);
  if (result.ok) summary.sent++;
  else { summary.failed++; if (!summary.errors.includes(result.error)) summary.errors.push(result.error); }
}

async function sendDailyVisitLtlOverdueDigests() {
  if (!EMAIL_CONFIGURED) return { attempted: 0, sent: 0, failed: 0, errors: ['Email is not configured yet'] };
  const summary = newDigestSummary();
  try {
    const { storesByName } = getStoresAndManagersData();
    const today = new Date();
    const daysAgo = (dateStr) => Math.floor((today - new Date(dateStr)) / 86400000);

    const { rows: visitRows } = await pool.query('SELECT data FROM visits');
    const lastVisitByStore = {};
    visitRows.forEach(r => {
      const v = r.data;
      if (!v || !v.store || !v.date) return;
      if (!lastVisitByStore[v.store] || v.date > lastVisitByStore[v.store]) lastVisitByStore[v.store] = v.date;
    });

    const { rows: ltlRows } = await pool.query('SELECT data FROM ltl_audits');
    const latestLtlByStore = {};
    ltlRows.map(r => r.data).filter(a => a && a.store && a.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(a => { latestLtlByStore[a.store] = a; }); // last one wins = latest by date, ascending sort
    const agingNcStores = new Set(
      ltlRows.map(r => r.data).filter(a => a && a.store && a.date && Number(a.ncRaised) > Number(a.ncClosed) && daysAgo(a.date) > 7).map(a => a.store)
    );

    for (const [storeName, store] of Object.entries(storesByName)) {
      const lastVisit = lastVisitByStore[storeName];
      const visitOverdue = !lastVisit || daysAgo(lastVisit) > 28;

      const latestLtl = latestLtlByStore[storeName];
      const ltlAtRisk = latestLtl && Number(latestLtl.score) < 85 && agingNcStores.has(storeName);

      if (!visitOverdue && !ltlAtRisk) continue;

      const recipients = await resolveStoreNotificationRecipients(storeName, store.fsm);
      if (!recipients.length) continue;

      const issues = [];
      if (visitOverdue) issues.push(lastVisit ? `No café visit logged in the last 28 days (last visit: ${lastVisit}).` : 'No café visit has ever been logged.');
      if (ltlAtRisk) issues.push(`LTL score is ${latestLtl.score}%, below the 85% target, with ${latestLtl.ncRaised - latestLtl.ncClosed} non-conformance(s) open for more than 7 days.`);

      const bodyHtml = `
        <p>The following item(s) at Bootlegger ${storeName} require follow-up:</p>
        <ul style="padding-left:20px;">${issues.map(i => `<li style="margin-bottom:6px;">${i}</li>`).join('')}</ul>
        <p>Please action the above and update your FSM with confirmation once completed.</p>
        <p>Please contact your Franchise Support Manager should you require assistance in resolving these matters.</p>`;
      const html = buildLetterheadEmailHtml({
        cafeName: storeName,
        attentionName: store.franchisee_name,
        subjectTitle: 'CAFÉ FOLLOW-UP NOTIFICATION',
        bodyHtml,
      });
      await sendAndTrack(summary, { to: recipients, subject: `BOS: ${storeName} — visit/LTL follow-up needed`, html });
    }
  } catch (e) {
    console.error('sendDailyVisitLtlOverdueDigests() error:', e.message);
    summary.errors.push(e.message);
  }
  return summary;
}
// ==================================================================
// CPA milestone calculation — ported from New Café Ops' calcCPA(), kept
// in sync with that file manually. Computes every milestone's due date
// for a given pipeline café, honoring any manual date overrides the same
// way the frontend does.
// ==================================================================
function calcCPAServer(store) {
  if (!store || !store.openDate) return null;
  const open = new Date(store.openDate + 'T00:00:00');
  if (isNaN(open)) return null;
  const add = (d, days) => { const r = new Date(d); r.setDate(r.getDate() + days); return r; };
  const sub = (d, days) => add(d, -days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const overrides = Object.assign({ handoverDate: store.handoverDate, trainingStart: store.trainingStartDate }, store.cpaOverrides || {});
  const ov = (key) => {
    const v = overrides[key];
    if (!v) return null;
    const d = new Date(v + 'T00:00:00');
    return isNaN(d) ? null : d;
  };
  const handover = ov('handoverDate') || sub(open, 7);
  const createdRaw = store.createdDate || (typeof store.id === 'number' ? new Date(store.id).toISOString().slice(0, 10) : null);
  const created = createdRaw ? new Date(createdRaw + 'T00:00:00') : sub(handover, 98);
  const franchiseeMeeting1 = ov('franchiseeMeeting1') || add(created, 14);
  const base = [
    { key: 'welcomeMail', label: 'Welcome Mail Sent, Masterfile Created/Updated', date: add(created, 2) },
    { key: 'franchiseeMeeting1', label: 'Franchisee Meeting 1', date: franchiseeMeeting1 },
    { key: 'cafeInfoCaptured', label: 'Café Info Captured & Communicated', date: add(created, 21) },
    { key: 'cafeEmailsCreated', label: 'Café E-mails Created & Orderflow Profiles Live', date: add(created, 14) },
    { key: 'acctAppDocsReceived', label: 'Account Application Supporting Documents Received', date: add(created, 14) },
    { key: 'acctAppCompletion', label: 'Account Application Completion', date: sub(handover, 35) },
    { key: 'appEncryptionSetup', label: 'Bootlegger App Applications Completed & Encryption Key Shared/Set Up', date: sub(handover, 42) },
    { key: 'handoverDate', label: 'Handover Date', date: handover },
    { key: 'openingOrdersPlaced', label: 'Opening Orders Placed & Delivery Dates Confirmed', date: sub(handover, 28) },
    { key: 'openingOrdersReceived', label: 'Opening Orders Received', date: add(handover, 2) },
    { key: 'topUpOrders', label: 'Top Up Orders Completed', date: add(handover, 4) },
    { key: 'recruitmentArtwork', label: 'Recruitment Artwork Ready, Shared & Posted', date: add(created, 21) },
    { key: 'interviewsScheduled', label: 'Interviews Scheduled', date: add(created, 35) },
    { key: 'staffSecuredMgmt', label: 'Staff Positions Secured — GM, Managers, Baristas & Kitchen Supervisors', date: sub(handover, 56) },
    { key: 'staffSecuredSupport', label: 'Staff Positions Secured — Kitchen Assistants, Scullers, Waitrons & Cashiers', date: sub(handover, 42) },
    { key: 'trainingScheduleCommunicated', label: 'Training Schedule Communicated & Training Café Allocated', date: sub(handover, 56) },
    { key: 'trainingCommencesMgmt', label: 'Training Commences — GM, Managers, Baristas & Kitchen Supervisors', date: sub(handover, 28) },
    { key: 'trainingCommencesSupport', label: 'Training Commences — Kitchen Assistants, Scullers, Waitrons & Cashiers', date: sub(handover, 14) },
    { key: 'bbetterCompletion', label: 'Online B.Better Training Completion — 100% All Sections', date: sub(handover, 7) },
    { key: 'trainingEndAdjustments', label: 'Training End & Additional Training Period Adjustments', date: sub(handover, 1) },
    { key: 'inStoreTraining1', label: 'In-Store Training Day 1', date: sub(handover, 7) },
    { key: 'inStoreTraining2', label: 'In-Store Training Day 2', date: sub(handover, 6) },
    { key: 'inStoreTraining3', label: 'In-Store Training Day 3', date: sub(handover, 5) },
    { key: 'inStoreTraining4', label: 'In-Store Training Day 4', date: sub(handover, 4) },
    { key: 'inStoreTraining5', label: 'In-Store Training Day 5', date: sub(handover, 3) },
    { key: 'inStoreTraining6', label: 'In-Store Training Day 6', date: sub(handover, 2) },
    { key: 'inStoreTraining7', label: 'In-Store Training Day 7', date: sub(handover, 1) },
    { key: 'staffRecruitmentCommences', label: 'Staff Recruitment Commences', date: add(created, 21) },
    { key: 'baristaSignOff', label: 'Barista Sign Off', date: sub(open, 2) },
    { key: 'openingReadinessChecklist', label: 'Opening Readiness Checklist Complete', date: sub(open, 1) },
    { key: 'openDate', label: 'Opening Date', date: open },
    { key: 'completeBusinessEssentials', label: 'Complete Business Essentials', date: add(open, 7) },
    { key: 'fullPostOpeningReport', label: 'Full Post-Opening Summary/Report', date: add(open, 28) },
    { key: 'postSupportWk1', label: 'Post-Support Week 1', date: open },
    { key: 'postSupportWk2', label: 'Post-Support Week 2', date: add(open, 14) },
    { key: 'postSupportWk3', label: 'Post-Support Week 3', date: add(open, 21) },
    { key: 'postSupportWk4', label: 'Post-Support Week 4', date: add(open, 28) },
  ];
  const milestones = base.map(m => ({ key: m.key, label: m.label, date: fmt(ov(m.key) || m.date) }));
  let cursor = add(franchiseeMeeting1, 14);
  let n = 2;
  while (cursor < open) {
    const key = `franchiseeMeeting${n}`;
    milestones.push({ key, label: `Franchisee Meeting ${n}`, date: fmt(ov(key) || cursor) });
    cursor = add(cursor, 14);
    n++;
  }
  milestones.sort((a, b) => a.date.localeCompare(b.date));
  return { milestones };
}

// ==================================================================
// Daily digest — CPA milestones: missed (overdue, unconfirmed) and
// upcoming (due within 2 days, unconfirmed) — per Franlo's spec.
// ==================================================================
// ==================================================================
// Weekly digest — café status rollup, per region
// ==================================================================
// One email per regional manager (Franlo, Tarryn), listing every café in
// their region with: days since last visit, latest LTL score, and how
// many tasks are currently open — a single weekly rollup rather than
// per-café alerts, using the exact same underlying data as the two daily
// digests above.
// ==================================================================
// Coffee machine servicing — auto-creates a task the moment a café's
// next-service date falls within the current calendar month, per
// Franlo's spec: "for any café due for servicing in September, a task
// will appear... with a 7 day due date." Runs daily; a tracking tag
// (servicingTaskFor) on each created task prevents ever creating the
// same café's servicing reminder twice for the same month, even though
// this check runs every day throughout that month.
// ==================================================================
async function createServicingTasksForCurrentMonth() {
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const match = html.match(/<script id="service-schedule-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return;
    const parsed = JSON.parse(match[1]);
    const serviceDataByName = parsed.SERVICE_SCHEDULE_DATA || {};
    const serviceDataByAbbr = parsed.SERVICE_SCHEDULE_DATA_BY_ABBR || {};
    const { storesByName, storesByAbbr } = getStoresAndManagersData();

    const today = new Date();
    const currentYearMonth = today.toISOString().slice(0, 7); // e.g. "2026-09"
    const createdDate = today.toISOString().slice(0, 10);

    // Last calendar day of the month a given "YYYY-MM-DD" falls in — day 0
    // of the *next* month is the last day of *this* month in JS Date math.
    function lastDayOfServiceMonth(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    }

    const { rows: existingActions } = await pool.query('SELECT data FROM actions');
    const alreadyCreated = new Set(
      existingActions.map(r => r.data).filter(a => a && a.servicingTaskFor).map(a => a.servicingTaskFor)
    );

    async function maybeCreateTask(nameKey, store, sd) {
      // Due this month OR already overdue from an earlier month — a plain
      // string comparison works correctly here since YYYY-MM sorts the
      // same lexicographically as chronologically.
      if (!sd.next_service || sd.next_service.slice(0, 7) > currentYearMonth) return;
      // Keyed on the specific next_service date, not the creation month —
      // so an overdue café gets exactly one task for this servicing
      // cycle, not a fresh duplicate every month it stays unresolved.
      // Once Franlo records the café as actually serviced (a new
      // next_service date), that becomes a new, distinct key.
      const trackingKey = nameKey + '|' + sd.next_service;
      if (alreadyCreated.has(trackingKey)) return;
      const isOverdue = sd.next_service.slice(0, 7) < currentYearMonth;
      // Due date = the last day of the ORIGINAL servicing month. A café
      // due this month gets a due date at this month's end (so it turns
      // overdue exactly when the month closes without action, per
      // Franlo's spec); an already-overdue café gets a due date already
      // in the past, so it shows as overdue immediately.
      const dueDate = lastDayOfServiceMonth(sd.next_service);
      const actionRow = {
        id: newId('a'),
        fsm: (store && store.fsm) || '',
        store: (store && store.store_name) || nameKey.split('_')[0],
        pillar: 'R&M',
        description: isOverdue
          ? `Coffee equipment servicing is OVERDUE — was scheduled for ${sd.next_service}. Follow up urgently to confirm the service booking.`
          : `Coffee equipment servicing due this month — follow up to confirm the service booking, and close this task once proof of service is submitted (next service was scheduled for ${sd.next_service}).`,
        owner: (store && store.fsm) || 'BOS System',
        dueDate,
        status: 'open',
        createdDate,
        servicingTaskFor: trackingKey,
      };
      await pool.query('INSERT INTO actions (id, data) VALUES ($1,$2)', [actionRow.id, actionRow]);
    }

    for (const [storeName, sd] of Object.entries(serviceDataByName)) {
      await maybeCreateTask(storeName, storesByName[storeName], sd);
    }
    for (const [abbrKey, sd] of Object.entries(serviceDataByAbbr)) {
      await maybeCreateTask(abbrKey, storesByAbbr[abbrKey], sd);
    }
  } catch (e) {
    console.error('createServicingTasksForCurrentMonth() error:', e.message);
  }
}

async function sendWeeklyCafeStatusDigests() {
  if (!EMAIL_CONFIGURED) return { attempted: 0, sent: 0, failed: 0, errors: ['Email is not configured yet'] };
  const summary = newDigestSummary();
  try {
    const { storesByName, managerOfFsm } = getStoresAndManagersData();
    const today = new Date();
    const daysAgo = (dateStr) => Math.floor((today - new Date(dateStr)) / 86400000);

    const { rows: visitRows } = await pool.query('SELECT data FROM visits');
    const lastVisitByStore = {};
    visitRows.forEach(r => {
      const v = r.data;
      if (!v || !v.store || !v.date) return;
      if (!lastVisitByStore[v.store] || v.date > lastVisitByStore[v.store]) lastVisitByStore[v.store] = v.date;
    });

    const { rows: ltlRows } = await pool.query('SELECT data FROM ltl_audits');
    const latestLtlByStore = {};
    ltlRows.map(r => r.data).filter(a => a && a.store && a.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(a => { latestLtlByStore[a.store] = a; });

    const { rows: taskRows } = await pool.query('SELECT data FROM actions');
    const openTasksByStore = {};
    taskRows.map(r => r.data).filter(a => a && a.store && a.status !== 'closed')
      .forEach(a => { openTasksByStore[a.store] = (openTasksByStore[a.store] || 0) + 1; });

    // Group every café by which regional manager owns its FSM
    const storesByManager = {};
    Object.values(storesByName).forEach(store => {
      const mgr = managerOfFsm[store.fsm];
      if (!mgr) return;
      (storesByManager[mgr] = storesByManager[mgr] || []).push(store);
    });

    for (const [mgrName, stores] of Object.entries(storesByManager)) {
      const mgrEmail = await findUserEmailByName(mgrName);
      if (!mgrEmail) continue; // no email on file — nothing to send to

      const bullets = stores.map(store => {
        const lastVisit = lastVisitByStore[store.store_name];
        const visitCol = lastVisit ? `${daysAgo(lastVisit)}d ago` : 'Never';
        const ltl = latestLtlByStore[store.store_name];
        const ltlCol = ltl ? `${ltl.score}%` : '—';
        const openCount = openTasksByStore[store.store_name] || 0;
        return `<li style="margin-bottom:6px;">${store.store_name} (FSM: ${store.fsm||'—'}) — last visit ${visitCol}, latest LTL ${ltlCol}, ${openCount} open task(s)</li>`;
      }).join('');
      const bodyHtml = `
        <p>Please find below this week's café status summary for your region:</p>
        <ul style="padding-left:20px;">${bullets}</ul>`;
      const html = buildLetterheadEmailHtml({
        cafeName: `${mgrName}'s Region`,
        attentionName: null,
        subjectTitle: 'WEEKLY CAFÉ STATUS REPORT',
        bodyHtml,
      });
      await sendAndTrack(summary, { to: mgrEmail, subject: `BOS: Weekly Café Status — ${mgrName}'s Region`, html });
    }
  } catch (e) {
    console.error('sendWeeklyCafeStatusDigests() error:', e.message);
    summary.errors.push(e.message);
  }
  return summary;
}

async function sendDailyCpaMilestoneDigests() {
  if (!EMAIL_CONFIGURED) return { attempted: 0, sent: 0, failed: 0, errors: ['Email is not configured yet'] };
  const summary = newDigestSummary();
  try {
    const { rows: storeRows } = await pool.query("SELECT value FROM storage WHERE key = 'dashboard-stores-v1'");
    const { rows: confRows } = await pool.query("SELECT value FROM storage WHERE key = 'cpa-confirmations-v1'");
    const extraStores = storeRows[0] ? JSON.parse(storeRows[0].value || '[]') : [];
    const cpaConfirmations = confRows[0] ? JSON.parse(confRows[0].value || '{}') : {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const in2Days = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);

    for (const store of extraStores) {
      const cpa = calcCPAServer(store);
      if (!cpa) continue;
      const storeConf = cpaConfirmations[store.name] || {};
      const missed = [], upcoming = [];
      cpa.milestones.forEach(m => {
        const confirmed = storeConf[m.key] && storeConf[m.key].confirmed;
        if (confirmed) return;
        if (m.date < todayStr) missed.push(m);
        else if (m.date <= in2Days) upcoming.push(m);
      });
      if (!missed.length && !upcoming.length) continue;

      const recipients = await resolveStoreNotificationRecipients(store.name, store.fsm);
      if (!recipients.length) continue;

      const bullets = [
        ...missed.map(m => `MISSED — ${m.label} (was due ${m.date})`),
        ...upcoming.map(m => `Due within 2 days — ${m.label} (${m.date})`),
      ];
      const bodyHtml = `
        <p>The following CPA milestone(s) for the opening of Bootlegger ${store.name} require attention:</p>
        <ul style="padding-left:20px;">${bullets.map(b => `<li style="margin-bottom:6px;">${b}</li>`).join('')}</ul>
        <p>Please action the above and update your FSM with confirmation once completed.</p>
        <p>Please contact your Franchise Support Manager should you require assistance in resolving these matters.</p>`;
      const html = buildLetterheadEmailHtml({
        cafeName: store.name,
        attentionName: store.fsm,
        subjectTitle: 'NEW CAFÉ OPENING — MILESTONE UPDATE',
        bodyHtml,
      });
      await sendAndTrack(summary, { to: recipients, subject: `BOS: ${store.name} — CPA milestone update`, html });
    }
  } catch (e) {
    console.error('sendDailyCpaMilestoneDigests() error:', e.message);
    summary.errors.push(e.message);
  }
  return summary;
}
// ==================================================================
// Daily Silo turnover refresh — direct BigQuery connection to the
// brand-scoped Silo Data Platform dataset (bootlegger_curated), per the
// platform team's build guide. Replaces the manual "generate a CSV via
// the MCP connector, then upload it" workflow with a genuine daily
// automatic refresh. Inert until GOOGLE_APPLICATION_CREDENTIALS_JSON is
// actually set in Railway — the server boots and runs fine without it,
// this job just skips itself and logs why.
// ==================================================================
const SILO_CONFIGURED = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
let bigquery = null;
if (SILO_CONFIGURED) {
  try {
    const { BigQuery } = require('@google-cloud/bigquery');
    bigquery = new BigQuery({
      projectId: 'silo-data-platform',
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    });
  } catch (e) {
    console.error('Failed to initialise Silo BigQuery client:', e.message);
  }
}

function uploadSpi(sales, inv) { return inv ? Math.round((sales / inv) * 100) / 100 : null; }
function uploadGrowth(cur, py) { return (cur == null || py == null || py === 0) ? null : Math.round(((cur - py) / py) * 10000) / 10000; }

// Same MTD/last-month/FYTD boundary logic as the manual trade-upload
// process — fiscal year starts 1 March, computed fresh from whatever
// "today" actually is rather than hardcoded.
function computeTradePeriods(latestDate) {
  const d = new Date(latestDate + 'T00:00:00');
  const Y = d.getFullYear(), M = d.getMonth(); // 0-indexed
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const mtdStart = iso(new Date(Y, M, 1));
  const mtdEnd = latestDate;
  const mtdStartPy = iso(new Date(Y - 1, M, 1));
  const mtdEndPy = iso(new Date(Y - 1, M, d.getDate()));
  const lastMonthStart = iso(new Date(Y, M - 1, 1));
  const lastMonthEnd = iso(new Date(Y, M, 0));
  const lastMonthStartPy = iso(new Date(Y - 1, M - 1, 1));
  const lastMonthEndPy = iso(new Date(Y - 1, M, 0));
  const fyStartYear = M < 2 ? Y - 1 : Y; // fiscal year starts March; Jan/Feb belong to the prior FY
  const fytdStart = iso(new Date(fyStartYear, 2, 1));
  // In the first days/weeks of a new fiscal year (March), "last complete
  // month" is still February — which belongs to the PREVIOUS fiscal year.
  // Using it as fytdEnd would invert the range (fytdStart > fytdEnd) and
  // silently return zero rows. Clamp so fytdEnd is never before fytdStart.
  const fytdEnd = lastMonthEnd < fytdStart ? fytdStart : lastMonthEnd;
  const fytdStartPy = iso(new Date(fyStartYear - 1, 2, 1));
  const fytdEndPy = lastMonthEndPy;
  return { mtdStart, mtdEnd, mtdStartPy, mtdEndPy, lastMonthStart, lastMonthEnd, lastMonthStartPy, lastMonthEndPy, fytdStart, fytdEnd, fytdStartPy, fytdEndPy };
}

async function refreshSiloTurnoverData() {
  if (!SILO_CONFIGURED || !bigquery) {
    console.log('Skipped Silo turnover refresh — GOOGLE_APPLICATION_CREDENTIALS_JSON not set yet.');
    return { skipped: true };
  }
  try {
    const [latestRows] = await bigquery.query({
      query: `SELECT MAX(date) as latest_date FROM \`silo-data-platform.bootlegger_curated.turnover_daily\``,
      location: 'europe-west1',
    });
    const latestDate = latestRows[0] && latestRows[0].latest_date && latestRows[0].latest_date.value;
    if (!latestDate) { console.error('Silo turnover refresh: no data returned for MAX(date).'); return { error: 'no data' }; }
    const p = computeTradePeriods(latestDate);

    // Single pass covering all three current-year windows in one
    // contiguous range, plus the two prior-year windows — mirrors the
    // manual process's query shape. A defensive GROUP BY dedup is kept
    // even though bootlegger_curated is described as pre-curated, since
    // this hasn't been verified against live data yet.
    const [rows] = await bigquery.query({
      query: `
        WITH dedup AS (
          SELECT node, date, branch,
            ANY_VALUE(store_type) as store_type,
            MAX(turnover_exclusive) as turnover_exclusive,
            MAX(invoices) as invoices
          FROM \`silo-data-platform.bootlegger_curated.turnover_daily\`
          WHERE (date BETWEEN @fytdStartPy AND @lastMonthEndPy)
             OR (date BETWEEN @fytdStart AND @mtdEnd)
             OR (date BETWEEN @mtdStartPy AND @mtdEndPy)
          GROUP BY node, date, branch
        )
        SELECT branch as store_name, store_type, date, turnover_exclusive, invoices FROM dedup
        ORDER BY branch, date`,
      params: { fytdStartPy: p.fytdStartPy, lastMonthEndPy: p.lastMonthEndPy, fytdStart: p.fytdStart, mtdEnd: p.mtdEnd, mtdStartPy: p.mtdStartPy, mtdEndPy: p.mtdEndPy },
      location: 'europe-west1',
    });

    // Aggregate each store's rows into the three period windows, both
    // years — same shape parseTurnoverUploadRows() builds client-side
    // from an uploaded CSV.
    const byStore = {};
    rows.forEach(r => {
      const name = r.store_name;
      if (!byStore[name]) byStore[name] = { store_type: r.store_type || 'Full Store', sales_mtd: 0, inv_mtd: 0, sales_mtd_py: 0, inv_mtd_py: 0, sales_lastmonth: 0, inv_lastmonth: 0, sales_lastmonth_py: 0, inv_lastmonth_py: 0, sales_fytd: 0, inv_fytd: 0, sales_fytd_py: 0, inv_fytd_py: 0 };
      const s = byStore[name];
      const date = r.date.value || r.date;
      const sales = Number(r.turnover_exclusive) || 0, inv = Number(r.invoices) || 0;
      if (date >= p.mtdStart && date <= p.mtdEnd) { s.sales_mtd += sales; s.inv_mtd += inv; }
      if (date >= p.mtdStartPy && date <= p.mtdEndPy) { s.sales_mtd_py += sales; s.inv_mtd_py += inv; }
      if (date >= p.lastMonthStart && date <= p.lastMonthEnd) { s.sales_lastmonth += sales; s.inv_lastmonth += inv; }
      if (date >= p.lastMonthStartPy && date <= p.lastMonthEndPy) { s.sales_lastmonth_py += sales; s.inv_lastmonth_py += inv; }
      if (date >= p.fytdStart && date <= p.fytdEnd) { s.sales_fytd += sales; s.inv_fytd += inv; }
      if (date >= p.fytdStartPy && date <= p.fytdEndPy) { s.sales_fytd_py += sales; s.inv_fytd_py += inv; }
    });

    // FSM comes from BOS's own store roster, not Silo — the new
    // brand-scoped schema doesn't expose an fsm column the way the old
    // gaap_curated query did.
    const { rows: storeRows } = await pool.query("SELECT value FROM storage WHERE key = 'dashboard-stores-v1'");
    let fsmByStoreName = {};
    try {
      const { storesByName } = getStoresAndManagersData();
      Object.entries(storesByName).forEach(([name, s]) => { fsmByStoreName[name] = s.fsm || ''; });
    } catch (e) { /* fsm lookup is best-effort; blank fsm is acceptable, not fatal */ }

    const TURNOVER_DATA = {};
    const typeGroups = {};
    Object.entries(byStore).forEach(([name, d]) => {
      d.fsm = fsmByStoreName[name] || '';
      d.is_new_store = false; // Silo doesn't flag this — matches manual-upload default when unspecified
      d.sales_mtd_growth = uploadGrowth(d.sales_mtd, d.sales_mtd_py);
      d.inv_mtd_growth = uploadGrowth(d.inv_mtd, d.inv_mtd_py);
      d.sales_lastmonth_growth = uploadGrowth(d.sales_lastmonth, d.sales_lastmonth_py);
      d.inv_lastmonth_growth = uploadGrowth(d.inv_lastmonth, d.inv_lastmonth_py);
      d.sales_fytd_growth = uploadGrowth(d.sales_fytd, d.sales_fytd_py);
      d.inv_fytd_growth = uploadGrowth(d.inv_fytd, d.inv_fytd_py);
      d.sales_fytd_avg_monthly = Math.round((d.sales_fytd / 4) * 100) / 100;
      d.inv_fytd_avg_monthly = Math.round((d.inv_fytd / 4) * 10) / 10;
      d.spi_mtd = uploadSpi(d.sales_mtd, d.inv_mtd);
      d.spi_mtd_py = uploadSpi(d.sales_mtd_py, d.inv_mtd_py);
      d.spi_mtd_growth = uploadGrowth(d.spi_mtd, d.spi_mtd_py);
      d.spi_lastmonth = uploadSpi(d.sales_lastmonth, d.inv_lastmonth);
      d.spi_lastmonth_py = uploadSpi(d.sales_lastmonth_py, d.inv_lastmonth_py);
      d.spi_lastmonth_growth = uploadGrowth(d.spi_lastmonth, d.spi_lastmonth_py);
      d.spi_fytd = uploadSpi(d.sales_fytd, d.inv_fytd);
      d.spi_fytd_py = uploadSpi(d.sales_fytd_py, d.inv_fytd_py);
      d.spi_fytd_growth = uploadGrowth(d.spi_fytd, d.spi_fytd_py);
      TURNOVER_DATA[name] = d;
      const g = typeGroups[d.store_type] || (typeGroups[d.store_type] = { sales_mtd: 0, inv_mtd: 0, sales_lastmonth: 0, inv_lastmonth: 0, sales_fytd: 0, inv_fytd: 0, n: 0 });
      g.sales_mtd += d.sales_mtd; g.inv_mtd += d.inv_mtd;
      g.sales_lastmonth += d.sales_lastmonth; g.inv_lastmonth += d.inv_lastmonth;
      g.sales_fytd += d.sales_fytd; g.inv_fytd += d.inv_fytd; g.n++;
    });
    const BRAND_AVGS = {};
    Object.entries(typeGroups).forEach(([st, g]) => {
      if (!g.n) return;
      BRAND_AVGS[st] = {
        n_stores: g.n,
        sales_mtd: Math.round((g.sales_mtd / g.n) * 100) / 100, inv_mtd: Math.round((g.inv_mtd / g.n) * 10) / 10, spi_mtd: uploadSpi(g.sales_mtd, g.inv_mtd),
        sales_lastmonth: Math.round((g.sales_lastmonth / g.n) * 100) / 100, inv_lastmonth: Math.round((g.inv_lastmonth / g.n) * 10) / 10, spi_lastmonth: uploadSpi(g.sales_lastmonth, g.inv_lastmonth),
        sales_fytd: Math.round(((g.sales_fytd / g.n) / 4) * 100) / 100, inv_fytd: Math.round(((g.inv_fytd / g.n) / 4) * 10) / 10, spi_fytd: uploadSpi(g.sales_fytd, g.inv_fytd),
      };
    });

    const payload = JSON.stringify({ TURNOVER_DATA, BRAND_AVGS });
    await pool.query(
      `INSERT INTO storage (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      ['bos-upload-data-turnover', payload]
    );
    console.log(`Silo turnover refresh complete — ${Object.keys(TURNOVER_DATA).length} stores, latest Silo date ${latestDate}.`);
    return { ok: true, storeCount: Object.keys(TURNOVER_DATA).length, latestDate };
  } catch (e) {
    console.error('Silo turnover refresh failed:', e.message);
    return { error: e.message };
  }
}

async function sendDailyOverdueTaskDigests() {
  if (!EMAIL_CONFIGURED) return { attempted: 0, sent: 0, failed: 0, errors: ['Email is not configured yet'] };
  const summary = newDigestSummary();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query('SELECT data FROM actions');
    const overdue = rows.map(r => r.data).filter(a => a && a.status !== 'closed' && a.status !== 'escalated' && a.dueDate && a.dueDate < today);
    const byStore = {};
    overdue.forEach(a => { (byStore[a.store] = byStore[a.store] || []).push(a); });
    const { storesByName } = getStoresAndManagersData();
    for (const [store, tasks] of Object.entries(byStore)) {
      const fsm = tasks[0].fsm;
      const recipients = await resolveStoreNotificationRecipients(store, fsm);
      if (!recipients.length) continue;
      const storeInfo = storesByName[store] || {};
      const bodyHtml = `
        <p>The following outstanding task(s) at Bootlegger ${store} are now overdue and require corrective action:</p>
        <ul style="padding-left:20px;">${tasks.map(t => `<li style="margin-bottom:6px;">${t.description || '(no description)'} — was due ${t.dueDate}</li>`).join('')}</ul>
        <p>Please action the above and update your FSM with confirmation once completed.</p>
        <p>Failure to remedy these items within a reasonable timeframe may result in further escalation.</p>
        <p>Please contact your Franchise Support Manager should you require assistance in resolving these matters.</p>`;
      const html = buildLetterheadEmailHtml({
        cafeName: store,
        attentionName: storeInfo.franchisee_name,
        subjectTitle: 'OVERDUE TASK NOTIFICATION',
        bodyHtml,
      });
      await sendAndTrack(summary, { to: recipients, subject: `BOS: ${tasks.length} overdue task(s) at ${store}`, html });
    }
  } catch (e) {
    console.error('sendDailyOverdueTaskDigests() error:', e.message);
    summary.errors.push(e.message);
  }
  return summary;
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
// Lets the frontend (and you, when testing with IT) check at a glance
// whether email is fully configured yet, without exposing the secret values.
app.get('/api/email/status', authRequired, (req, res) => res.json({ configured: EMAIL_CONFIGURED, senderEmail: EMAIL_CONFIGURED ? MS_SENDER_EMAIL : null }));
// Admin-only: send a one-off test email to confirm the Azure AD setup
// actually works end-to-end, before wiring up any real notification.
app.post('/api/email/test', authRequired, requireAdmin, async (req, res) => {
  const to = req.body && req.body.to;
  if (!to) return res.status(400).json({ error: 'to address required' });
  const result = await sendEmail({ to, subject: 'BOS Dashboard — test email', html: '<p>This is a test email from BOS Dashboard, sent via Microsoft Graph.</p><p>If you\'re reading this, the Microsoft 365 email setup is working correctly.</p>' });
  if (result.ok) res.json({ ok: true });
  else res.status(500).json({ error: result.error });
});

// Returns who a manual "Send Update Email" button should offer as
// recipients for a given café — café mailbox, franchisee, operator, FSM,
// regional manager — each labeled so the frontend can show a real name,
// not just a bare address. Missing contacts are simply left out.
app.get('/api/email/recipients', authRequired, async (req, res) => {
  try {
    const store = req.query.store;
    if (!store) return res.status(400).json({ error: 'store query param required' });
    const { storesByName } = getStoresAndManagersData();
    const fsmName = (storesByName[store] || {}).fsm;
    const recipients = await resolveStoreNotificationRecipientsForModal(store, fsmName);
    res.json({ recipients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// General-purpose manual send — any editor can use this (not admin-only
// like the diagnostic test endpoint above), since these are ordinary
// update/escalation emails sent as part of everyday BOS use, not a
// one-off setup check.
app.post('/api/email/send', authRequired, requireEditor, async (req, res) => {
  try {
    const { to, cc, subject, html } = req.body;
    if (!to || (Array.isArray(to) && !to.length)) return res.status(400).json({ error: 'at least one recipient required' });
    if (!subject || !html) return res.status(400).json({ error: 'subject and html body required' });
    const result = await sendEmail({ to, cc, subject, html });
    if (result.ok) res.json({ ok: true });
    else res.status(500).json({ error: result.error });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================================================================
// Automation control panel — the four RECURRING digest jobs stay off
// until an admin explicitly enables them here. Manual test runs below
// work regardless of this switch, always redirected to a chosen test
// address, never to real people.
// ==================================================================
const DIGEST_JOBS = {
  overdueTasks: { fn: sendDailyOverdueTaskDigests, label: 'Daily overdue tasks' },
  visitLtl: { fn: sendDailyVisitLtlOverdueDigests, label: 'Daily visit/LTL overdue' },
  cpaMilestones: { fn: sendDailyCpaMilestoneDigests, label: 'Daily CPA milestones' },
  weeklyCafeStatus: { fn: sendWeeklyCafeStatusDigests, label: 'Weekly café status' },
};

app.get('/api/email/automation-status', authRequired, async (req, res) => {
  res.json({ enabled: await isEmailAutomationEnabled(), configured: EMAIL_CONFIGURED, jobs: Object.entries(DIGEST_JOBS).map(([id, j]) => ({ id, label: j.label })) });
});

app.post('/api/email/automation-status', authRequired, requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    await setEmailAutomationEnabled(!!enabled);
    res.json({ enabled: !!enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Runs one digest job immediately, once, redirected entirely to
// testEmail — real recipients are never touched. Returns whether the run
// completed so the control panel can confirm it went through.
app.post('/api/admin/run-silo-refresh', authRequired, requireAdmin, async (req, res) => {
  const result = await refreshSiloTurnoverData();
  if (result.skipped) return res.status(400).json({ error: 'GOOGLE_APPLICATION_CREDENTIALS_JSON is not set in Railway yet — nothing to run.' });
  if (result.error) return res.status(500).json({ error: result.error });
  res.json({ ok: true, message: `Refreshed ${result.storeCount} stores from Silo (latest date: ${result.latestDate}).` });
});

app.post('/api/email/run-digest-test/:jobId', authRequired, requireAdmin, async (req, res) => {
  const job = DIGEST_JOBS[req.params.jobId];
  if (!job) return res.status(400).json({ error: 'Unknown digest job: ' + req.params.jobId });
  const testEmail = req.body && req.body.testEmail;
  if (!testEmail) return res.status(400).json({ error: 'testEmail is required — this run always redirects to a test address, never real recipients' });
  if (!EMAIL_CONFIGURED) return res.status(400).json({ error: 'Email is not configured yet — set the Microsoft 365 environment variables first' });
  _testModeOverrideEmail = testEmail;
  try {
    const summary = await job.fn();
    if (!summary || summary.attempted === 0) {
      res.json({ ok: true, message: `${job.label}: nothing to send right now — no cafés currently match this digest's conditions.` });
    } else if (summary.failed > 0) {
      res.json({ ok: false, message: `${job.label}: attempted ${summary.attempted}, ${summary.sent} sent, ${summary.failed} FAILED. Error: ${summary.errors[0]}` });
    } else {
      res.json({ ok: true, message: `${job.label}: ${summary.sent} email(s) sent successfully — check ${testEmail}.` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    _testModeOverrideEmail = null; // always clear, even if the job throws — real sends must never stay redirected by accident
  }
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`BOS Dashboard running on port ${PORT}`));
    cleanupOldTaskPhotos();
    setInterval(cleanupOldTaskPhotos, 24 * 60 * 60 * 1000);

    // Every recurring digest checks the master switch fresh, right before
    // it would actually run — so turning automation off takes effect on
    // the very next scheduled tick, no restart needed. Nothing here ever
    // fires unless an admin has explicitly turned automation on from the
    // control panel.
    const runIfEnabled = async (fn, label) => {
      if (await isEmailAutomationEnabled()) {
        console.log(`Running scheduled digest: ${label}`);
        await fn();
      } else {
        console.log(`Skipped scheduled digest (automation is off): ${label}`);
      }
    };
    runIfEnabled(sendDailyOverdueTaskDigests, 'daily overdue tasks');
    setInterval(() => runIfEnabled(sendDailyOverdueTaskDigests, 'daily overdue tasks'), 24 * 60 * 60 * 1000);
    runIfEnabled(sendDailyVisitLtlOverdueDigests, 'daily visit/LTL overdue');
    setInterval(() => runIfEnabled(sendDailyVisitLtlOverdueDigests, 'daily visit/LTL overdue'), 24 * 60 * 60 * 1000);
    runIfEnabled(sendDailyCpaMilestoneDigests, 'daily CPA milestones');
    setInterval(() => runIfEnabled(sendDailyCpaMilestoneDigests, 'daily CPA milestones'), 24 * 60 * 60 * 1000);
    runIfEnabled(sendWeeklyCafeStatusDigests, 'weekly café status');
    setInterval(() => runIfEnabled(sendWeeklyCafeStatusDigests, 'weekly café status'), 7 * 24 * 60 * 60 * 1000);
    createServicingTasksForCurrentMonth();
    setInterval(createServicingTasksForCurrentMonth, 24 * 60 * 60 * 1000);
    refreshSiloTurnoverData();
    setInterval(refreshSiloTurnoverData, 24 * 60 * 60 * 1000);
  })
  .catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
