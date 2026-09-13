'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CASTMIR_DATA || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'castmir.json');

const DEFAULT = {
  policy: {
    storage_mode: 'redacted',   // full | redacted | metadata | none
    retention_days: 90,
    auto_redact: true,
    mode: 'enforce',            // enforce | observe
    rule_version: '2026.09.1'
  },
  users: {},
  events: []
};

let db = null;

// Optional S3 backing. App Runner containers have an ephemeral filesystem, so set
// CASTMIR_S3_BUCKET in production and the store round-trips through S3 instead.
const S3_BUCKET = process.env.CASTMIR_S3_BUCKET || '';
const S3_KEY = process.env.CASTMIR_S3_KEY || 'castmir/castmir.json';
let s3 = null;

async function init() {
  if (!S3_BUCKET) { load(); return { backend: 'file', path: FILE }; }
  try {
    const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
    s3 = { client: new S3Client({}), GetObjectCommand, PutObjectCommand };
    const r = await s3.client.send(new s3.GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_KEY }));
    db = JSON.parse(await r.Body.transformToString());
    db.policy = Object.assign({}, DEFAULT.policy, db.policy || {});
    db.users = db.users || {};
    db.events = db.events || [];
    console.log('[castmir] loaded ' + db.events.length + ' events from s3://' + S3_BUCKET + '/' + S3_KEY);
  } catch (e) {
    if (!db) db = JSON.parse(JSON.stringify(DEFAULT));
    console.log('[castmir] starting with an empty store (' + (e.name || e.message) + ')');
  }
  return { backend: s3 ? 's3' : 'file', bucket: S3_BUCKET, key: S3_KEY };
}

function load() {
  if (db) return db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db.policy = Object.assign({}, DEFAULT.policy, db.policy || {});
    db.users = db.users || {};
    db.events = db.events || [];
  } catch (e) {
    db = JSON.parse(JSON.stringify(DEFAULT));
  }
  return db;
}

let pending = null;
function save() {
  if (pending) return;
  pending = setTimeout(async () => {
    pending = null;
    const body = JSON.stringify(db, null, 2);
    if (s3) {
      try {
        await s3.client.send(new s3.PutObjectCommand({
          Bucket: S3_BUCKET, Key: S3_KEY, Body: body, ContentType: 'application/json'
        }));
      } catch (e) { console.error('[castmir] s3 save failed', e.message); }
      return;
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, body);
    } catch (e) { console.error('[castmir] save failed', e.message); }
  }, 1500);
}

const PROFILE_FIELDS = ['category', 'college', 'department', 'program', 'display_name', 'external_id', 'source'];

// A user is anyone whose prompts are monitored: student, staff, faculty, employee, customer.
// Category / college / program are filled by the directory integration (v2); until then they
// default to Unassigned and can be set by hand in the extension settings.
function user(id, profile) {
  const d = load();
  const p = typeof profile === 'string' ? { department: profile } : (profile || {});
  if (!d.users[id]) {
    d.users[id] = {
      id, category: 'Unassigned', college: 'Unassigned', department: 'Unassigned',
      program: null, display_name: null, external_id: null, source: 'extension',
      created_at: new Date().toISOString()
    };
  }
  const u = d.users[id];
  for (const k of PROFILE_FIELDS) if (p[k]) u[k] = p[k];
  save();
  return u;
}

// Bulk upsert from a university management system (v2 integration point).
function upsertUsers(rows) {
  const out = [];
  for (const r of rows || []) {
    const id = r.user_id || r.id;
    if (!id) continue;
    out.push(user(id, Object.assign({ source: 'directory' }, r)));
  }
  return out;
}

function addEvent(ev) {
  const d = load();
  d.events.push(ev);
  prune();
  save();
  return ev;
}

function updateEvent(id, patch) {
  const d = load();
  const ev = d.events.find(e => e.id === id);
  if (ev) { Object.assign(ev, patch); save(); }
  return ev;
}

function prune() {
  const d = load();
  const cutoff = Date.now() - d.policy.retention_days * 86400000;
  d.events = d.events.filter(e => new Date(e.submitted_at).getTime() >= cutoff);
  if (d.events.length > 20000) d.events = d.events.slice(-20000);
}

function events(filter) {
  const d = load();
  let list = d.events;
  if (filter && filter.user_id) list = list.filter(e => e.user_id === filter.user_id);
  if (filter && filter.since) list = list.filter(e => new Date(e.submitted_at).getTime() >= filter.since);
  return list;
}

module.exports = {
  init, load, save, user, upsertUsers, addEvent, updateEvent, events,
  policy: () => load().policy,
  setPolicy: (p) => { const d = load(); d.policy = Object.assign({}, d.policy, p); save(); return d.policy; },
  users: () => Object.values(load().users)
};
