'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const agents = require('./agents');
const store = require('./store');
const analytics = require('./analytics');
const { zipDir } = require('./zip');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXT_DIR = path.join(__dirname, '..', 'extension');
const ADMIN_KEY = process.env.CASTMIR_ADMIN_KEY || 'castmir-admin';
const BUNDLE_VERSION = '2026.09.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CASTmir-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
}
function json(res, code, body) {
  cors(res);
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const id = (p) => p + '_' + crypto.randomBytes(6).toString('hex');

function storePrompt(policy, original, revision) {
  if (policy.storage_mode === 'none' || policy.storage_mode === 'metadata') return { stored_prompt: null, stored_revision: null };
  if (policy.storage_mode === 'full') return { stored_prompt: original, stored_revision: revision || null };
  return { stored_prompt: null, stored_revision: null, redact: true };
}

async function api(req, res, u) {
  const p = u.pathname;
  const policy = store.policy();

  // ---- POST /v1/prompts/analyze -------------------------------------------
  if (p === '/v1/prompts/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.prompt || '');
    const userId = String(body.user_id || 'anonymous');
    store.user(userId, {
      department: body.department, category: body.category,
      college: body.college, program: body.program
    });

    const quality = agents.coach(text);
    const sec = agents.security(text, policy);
    const meta = agents.track(body.host, body.model);
    const revision = agents.buildRevision(sec.action === 'redact' ? sec.redacted : text, quality);
    const revisedQuality = revision ? agents.coach(revision).score : null;

    const st = storePrompt(policy, text, revision);
    const ev = {
      id: id('pr'),
      user_id: userId,
      application: meta.application,
      model: meta.model,
      submitted_at: new Date().toISOString(),
      storage_mode: policy.storage_mode,
      quality_score: quality.score,
      revised_quality_score: revisedQuality,
      sub: quality.sub,
      gap_kinds: quality.gaps.map(g => g.kind),
      suggestions_count: quality.gaps.length,
      coaching_applied: false,
      security_score: sec.score,
      findings: sec.findings,
      action: sec.action === 'allow' ? 'allow' : sec.action,
      rule_version: sec.rule_version,
      stored_prompt: st.redact ? sec.redacted : st.stored_prompt,
      stored_revision: st.redact ? (revision ? agents.security(revision, policy).redacted : null) : st.stored_revision
    };
    store.addEvent(ev);

    return json(res, 200, {
      prompt_id: ev.id,
      quality: { score: quality.score, sub: quality.sub, gaps: quality.gaps },
      revision, revised_quality_score: revisedQuality,
      security: { score: sec.score, findings: sec.findings, action: sec.action, redacted: sec.action === 'redact' ? sec.redacted : null },
      model: meta,
      policy: { storage_mode: policy.storage_mode, mode: policy.mode }
    });
  }

  // ---- POST /v1/coaching/:id/accept ---------------------------------------
  let m = /^\/v1\/coaching\/([^/]+)\/accept$/.exec(p);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    const ev = store.updateEvent(m[1], {
      coaching_applied: true,
      applied_kind: body.kind || 'revision',
      revised_quality_score: body.quality_score != null ? body.quality_score : undefined
    });
    return json(res, ev ? 200 : 404, ev ? { ok: true } : { error: 'not found' });
  }

  // ---- POST /v1/prompts/:id/outcome ---------------------------------------
  m = /^\/v1\/prompts\/([^/]+)\/outcome$/.exec(p);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    const ev = store.updateEvent(m[1], { outcome_rating: body.rating, outcome_at: new Date().toISOString() });
    return json(res, ev ? 200 : 404, ev ? { ok: true } : { error: 'not found' });
  }

  // ---- GET /v1/me/dashboard -----------------------------------------------
  if (p === '/v1/me/dashboard' && req.method === 'GET') {
    const userId = u.searchParams.get('user_id') || req.headers['x-castmir-key'] || 'anonymous';
    return json(res, 200, analytics.userDashboard(userId, u.searchParams.get('window') || '30d'));
  }

  // ---- GET /v1/me/prompts --------------------------------------------------
  if (p === '/v1/me/prompts' && req.method === 'GET') {
    const userId = u.searchParams.get('user_id') || 'anonymous';
    const since = Date.now() - analytics.windowMs(u.searchParams.get('window') || '30d');
    const list = store.events({ user_id: userId, since }).slice().reverse().map(e => ({
      id: e.id, submitted_at: e.submitted_at, application: e.application, model: e.model,
      quality_score: e.quality_score, revised_quality_score: e.revised_quality_score,
      coaching_applied: e.coaching_applied, action: e.action,
      findings: (e.findings || []).map(f => f.label),
      prompt: e.stored_prompt, revision: e.stored_revision, storage_mode: e.storage_mode
    }));
    return json(res, 200, { window: u.searchParams.get('window') || '30d', prompts: list });
  }

  // ---- GET /v1/users -------------------------------------------------------
  if (p === '/v1/users' && req.method === 'GET') {
    return json(res, 200, { users: store.users() });
  }

  // ---- Directory (v2: university management system integration) ------------
  // Prepared in advance. Today a user is identified only by id; once the institution's
  // system is connected, these endpoints carry category (student / staff / faculty),
  // college, department and programme, and every rollup segments by them automatically.
  if (p === '/v1/directory/users' && req.method === 'GET') {
    return json(res, 200, {
      schema: { user_id: 'string', external_id: 'string', display_name: 'string',
                category: 'student | staff | faculty | employee | other',
                college: 'string', department: 'string', program: 'string' },
      users: store.users()
    });
  }
  if (p === '/v1/directory/sync' && req.method === 'POST') {
    if ((req.headers['x-castmir-key'] || '') !== ADMIN_KEY) return json(res, 401, { error: 'admin key required' });
    const body = await readBody(req);
    const rows = Array.isArray(body) ? body : (body.users || []);
    const updated = store.upsertUsers(rows);
    return json(res, 200, { updated: updated.length, users: updated });
  }
  m = /^\/v1\/directory\/users\/([^/]+)$/.exec(p);
  if (m && (req.method === 'PUT' || req.method === 'POST')) {
    if ((req.headers['x-castmir-key'] || '') !== ADMIN_KEY) return json(res, 401, { error: 'admin key required' });
    return json(res, 200, store.user(decodeURIComponent(m[1]), Object.assign({ source: 'directory' }, await readBody(req))));
  }
  if (m && req.method === 'GET') {
    const u = store.users().find(x => x.id === decodeURIComponent(m[1]));
    return json(res, u ? 200 : 404, u || { error: 'not found' });
  }

  // ---- Admin ---------------------------------------------------------------
  if (p.startsWith('/v1/org')) {
    if (p === '/v1/org/overview') return json(res, 200, analytics.orgOverview(u.searchParams.get('window') || '30d'));
    if (p === '/v1/org/segments') {
      const by = (u.searchParams.get('by') || 'category,college,department,program').split(',').map(x => x.trim()).filter(Boolean);
      return json(res, 200, analytics.segments(u.searchParams.get('window') || '30d', by));
    }
    if (p === '/v1/org/security/events') {
      const since = Date.now() - analytics.windowMs(u.searchParams.get('window') || '30d');
      const users = {}; for (const x of store.users()) users[x.id] = x.department;
      const list = store.events({ since }).filter(e => (e.findings || []).length)
        .slice().reverse().slice(0, 200).map(e => ({
          when: e.submitted_at, user_id: e.user_id, department: users[e.user_id] || 'Unassigned',
          application: e.application, action: e.action,
          detections: (e.findings || []).map(f => f.label)
        }));
      return json(res, 200, { events: list });
    }
    if (p === '/v1/org/recommendations') return json(res, 200, { recommendations: analytics.orgOverview('30d').recommendations });
    if (p === '/v1/org/policy' && req.method === 'PUT') {
      if ((req.headers['x-castmir-key'] || '') !== ADMIN_KEY) return json(res, 401, { error: 'admin key required' });
      return json(res, 200, store.setPolicy(await readBody(req)));
    }
    if (p === '/v1/org/policy') return json(res, 200, store.policy());
  }

  // ---- GET /v1/patches/check ----------------------------------------------
  if (p === '/v1/patches/check') {
    return json(res, 200, {
      bundle_version: BUNDLE_VERSION,
      rule_version: policy.rule_version,
      policy: { storage_mode: policy.storage_mode, auto_redact: policy.auto_redact, mode: policy.mode },
      detectors: agents.DETECTORS.map(d => ({ id: d.id, label: d.label, class: d.cls, severity: d.severity, source: d.re.source, flags: d.re.flags, token: d.token })),
      checked_at: new Date().toISOString()
    });
  }

  if (p === '/v1/health') return json(res, 200, { ok: true, version: BUNDLE_VERSION, events: store.events({}).length });

  return json(res, 404, { error: 'no such endpoint', path: p });
}

const zipCache = new Map();
function extensionZip(origin) {
  const hit = zipCache.get(origin);
  if (hit && Date.now() - hit.at < 30000) return hit.buf;
  // Bake this deployment's URL into the download so the extension works with no manual setup.
  const config = 'globalThis.CASTMIR_DEFAULT_API = ' + JSON.stringify(origin) + ';\n';
  const buf = zipDir(EXT_DIR, 'castmir-extension', [{ name: 'castmir-extension/config.js', data: config }]);
  zipCache.set(origin, { buf, at: Date.now() });
  return buf;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  try {
    if (u.pathname.startsWith('/v1/')) return await api(req, res, u);

    if (u.pathname === '/download/castmir-extension.zip') {
      const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      const buf = extensionZip(proto + '://' + (req.headers.host || 'localhost:' + PORT));
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="castmir-extension.zip"',
        'Content-Length': buf.length
      });
      return res.end(buf);
    }
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    console.error('[castmir]', e);
    return json(res, 500, { error: 'server error', detail: String(e && e.message) });
  }
});

store.init().then((info) => server.listen(PORT, () => {
  console.log('CASTmir server listening on http://localhost:' + PORT + '  ·  store: ' + info.backend);
  console.log('  dashboards : /  ·  /dashboard.html  ·  /admin.html');
  console.log('  extension  : /download/castmir-extension.zip');
}));
