'use strict';
const store = require('./store');

const DAY = 86400000;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round = (n) => Math.round(n * 10) / 10;

function windowMs(win) {
  const m = /^(\d+)d$/.exec(win || '30d');
  return (m ? parseInt(m[1], 10) : 30) * DAY;
}

function buckets(list, n, span) {
  const now = Date.now();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const hi = now - i * span, lo = hi - span;
    const inBucket = list.filter(e => {
      const t = new Date(e.submitted_at).getTime();
      return t > lo && t <= hi;
    });
    out.push({
      label: 'W' + (n - i),
      count: inBucket.length,
      quality: Math.round(avg(inBucket.map(e => e.quality_score))) || null
    });
  }
  return out;
}

function pmi(list) {
  if (!list.length) return { value: 0, components: {} };
  const coached = list.filter(e => e.suggestions_count > 0);
  const acceptance = coached.length ? list.filter(e => e.coaching_applied).length / coached.length : 0;
  const half = Math.floor(list.length / 2) || 1;
  const early = avg(list.slice(0, half).map(e => e.quality_score));
  const late = avg(list.slice(-half).map(e => e.quality_score));
  const gain = Math.max(0, Math.min(1, (late - early) / 25 + 0.35));
  const repeats = list.filter(e => e.gap_kinds && e.gap_kinds.length).length / list.length;
  const decay = 1 - Math.min(1, repeats);
  const clean = list.filter(e => !e.findings || !e.findings.length).length / list.length;
  const value = Math.round(acceptance * 30 + gain * 30 + decay * 20 + clean * 20);
  return {
    value,
    components: {
      coaching_acceptance: Math.round(acceptance * 100),
      sustained_gain: Math.round(gain * 100),
      repeat_mistake_decay: Math.round(decay * 100),
      security_clean_rate: Math.round(clean * 100)
    }
  };
}

function byModel(list) {
  const map = {};
  for (const e of list) {
    const k = e.application + (e.model && e.model !== e.application + ' (default)' ? ' · ' + e.model : '');
    map[k] = map[k] || { name: k, prompts: 0, q: [], findings: 0, first: [], last: [] };
    map[k].prompts++;
    map[k].q.push(e.quality_score);
    map[k].findings += (e.findings || []).length;
  }
  return Object.values(map).map(m => {
    const half = Math.floor(m.q.length / 2) || 1;
    const early = avg(m.q.slice(0, half));
    const late = avg(m.q.slice(-half));
    const delta = late - early;
    return {
      name: m.name, prompts: m.prompts,
      quality: Math.round(avg(m.q)) || 0,
      security_events: m.findings,
      trend: m.q.length < 4 ? '→' : delta > 2 ? '↑' : delta < -2 ? '↓' : '→',
      drift: m.q.length >= 6 && delta < -5 ? round(delta) : null
    };
  }).sort((a, b) => b.prompts - a.prompts);
}

function riskBreakdown(list) {
  const map = {};
  for (const e of list) for (const f of e.findings || []) {
    map[f.class] = (map[f.class] || 0) + 1;
  }
  return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function subScores(list) {
  const keys = ['clarity', 'context', 'specificity', 'structure', 'output_instructions'];
  const out = {};
  for (const k of keys) out[k] = Math.round(avg(list.map(e => (e.sub || {})[k]).filter(Boolean))) || 0;
  return out;
}

function recommendations(list) {
  const recs = [];
  if (!list.length) return recs;
  const sub = subScores(list);
  const weakest = Object.entries(sub).sort((a, b) => a[1] - b[1])[0];
  const label = { clarity: 'Clarity', context: 'Context', specificity: 'Specificity', structure: 'Structure', output_instructions: 'Output instructions' }[weakest[0]];
  recs.push({
    tag: 'Quality', title: label + ' is your weakest area',
    body: 'Your average ' + label.toLowerCase() + ' sub-score is ' + weakest[1] + ' across ' + list.length + ' prompts.',
    action: weakest[0] === 'output_instructions'
      ? 'State the format you want — table, bullets, JSON — in every prompt.'
      : 'Add one concrete constraint per prompt: audience, length or an explicit success criterion.'
  });
  const risks = riskBreakdown(list);
  if (risks.length) {
    recs.push({
      tag: 'Security', title: risks[0].label + ' is your most common finding',
      body: risks[0].value + ' ' + risks[0].label.toLowerCase() + ' finding(s) in this period.',
      action: 'Replace real identifiers with anonymised placeholders before submitting.'
    });
  }
  const models = byModel(list);
  const drifting = models.find(m => m.drift);
  if (drifting) {
    recs.push({
      tag: 'Models', title: drifting.name + ' quality is trending down',
      body: 'Average prompt quality on ' + drifting.name + ' moved ' + drifting.drift + ' points across this window.',
      action: 'Compare against your best-performing platform before assuming the model changed.'
    });
  }
  const applied = list.filter(e => e.coaching_applied).length;
  recs.push({
    tag: 'Skills', title: 'Coaching uptake',
    body: 'You applied ' + applied + ' of ' + list.filter(e => e.suggestions_count > 0).length + ' suggestions offered.',
    action: 'Applying a suggestion is the fastest way to move your PMI.'
  });
  return recs;
}

function userDashboard(userId, win) {
  const since = Date.now() - windowMs(win);
  const list = store.events({ user_id: userId, since }).sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  const sec = list.reduce((a, e) => {
    a.scanned++;
    if (e.action === 'block') a.blocked++;
    else if (e.action === 'redact') a.redacted++;
    else if (e.action === 'warn') a.warnings++;
    return a;
  }, { scanned: 0, warnings: 0, redacted: 0, blocked: 0 });
  const trend = buckets(list, 4, windowMs(win) / 4);
  const half = Math.floor(list.length / 2) || 1;
  const improvement = list.length >= 4
    ? Math.round(((avg(list.slice(-half).map(e => e.quality_score)) / (avg(list.slice(0, half).map(e => e.quality_score)) || 1)) - 1) * 100)
    : 0;
  return {
    user_id: userId,
    window: win || '30d',
    prompts: list.length,
    quality_score: Math.round(avg(list.map(e => e.quality_score))) || 0,
    security_score: Math.round(avg(list.map(e => e.security_score))) || 100,
    improvement,
    sub_scores: subScores(list),
    trend,
    pmi: pmi(list),
    models: byModel(list),
    security: sec,
    risks: riskBreakdown(list),
    recommendations: recommendations(list),
    recent: list.slice(-12).reverse().map(e => ({
      id: e.id, when: e.submitted_at, application: e.application, model: e.model,
      quality_before: e.quality_score, quality_after: e.revised_quality_score,
      action: e.action, coaching_applied: !!e.coaching_applied,
      preview: e.stored_prompt ? e.stored_prompt.slice(0, 90) : null,
      revised: e.stored_revision ? e.stored_revision.slice(0, 160) : null,
      findings: (e.findings || []).map(f => f.label)
    }))
  };
}

// Rollup of activity by any user attribute — department today, category / college /
// program once the directory integration lands.
function segmentRows(list, userMap, field) {
  const groups = {};
  for (const e of list) {
    const u = userMap[e.user_id] || {};
    const key = u[field] || 'Unassigned';
    groups[key] = groups[key] || { name: key, q: [], findings: 0, users: new Set() };
    groups[key].q.push(e.quality_score);
    groups[key].users.add(e.user_id);
    groups[key].findings += (e.findings || []).length;
  }
  return Object.values(groups).map(g => {
    const h = Math.floor(g.q.length / 2) || 1;
    const imp = g.q.length >= 4 ? Math.round(((avg(g.q.slice(-h)) / (avg(g.q.slice(0, h)) || 1)) - 1) * 100) : 0;
    const rate = g.q.length ? g.findings / g.q.length : 0;
    return {
      name: g.name, users: g.users.size, prompts: g.q.length,
      quality: Math.round(avg(g.q)) || 0, improvement: imp,
      risk: rate > 0.25 ? 'High' : rate > 0.1 ? 'Medium' : 'Low',
      findings: g.findings
    };
  }).sort((x, y) => y.prompts - x.prompts);
}

function segments(win, fields) {
  const since = Date.now() - windowMs(win);
  const list = store.events({ since });
  const userMap = {};
  for (const u of store.users()) userMap[u.id] = u;
  const out = {};
  for (const f of fields || ['category', 'college', 'department', 'program']) out[f] = segmentRows(list, userMap, f);
  return { window: win || '30d', segments: out };
}

function orgOverview(win) {
  const since = Date.now() - windowMs(win);
  const list = store.events({ since });
  const users = store.users();
  const userMap = {};
  for (const u of users) userMap[u.id] = u;
  const half = Math.floor(list.length / 2) || 1;
  const improvement = list.length >= 4
    ? Math.round(((avg(list.slice(-half).map(e => e.quality_score)) / (avg(list.slice(0, half).map(e => e.quality_score)) || 1)) - 1) * 100)
    : 0;
  const risks = riskBreakdown(list);
  const deptRows = segmentRows(list, userMap, 'department');

  const orgRecs = [];
  const worst = deptRows.slice().sort((a, b) => b.findings - a.findings)[0];
  if (worst && worst.findings) {
    const share = Math.round((worst.findings / Math.max(1, risks.reduce((a, r) => a + r.value, 0))) * 100);
    orgRecs.push({
      title: worst.name + ' generates ' + share + '% of security findings',
      body: 'Create a targeted 10-minute module on anonymising sensitive information before using AI.'
    });
  }
  const best = deptRows.slice().sort((a, b) => b.improvement - a.improvement)[0];
  if (best && best.improvement > 0) {
    orgRecs.push({ title: best.name + ' improves fastest after coaching', body: 'Share their prompt templates with other departments as a starting library.' });
  }
  const drift = byModel(list).find(m => m.drift);
  if (drift) orgRecs.push({ title: drift.name + ' quality is trending down', body: 'Review platform guidance before expanding licences; compare against outcome data first.' });

  return {
    window: win || '30d',
    users: users.length,
    prompts: list.length,
    platforms: new Set(list.map(e => e.application)).size,
    quality: Math.round(avg(list.map(e => e.quality_score))) || 0,
    improvement,
    security_events: list.reduce((a, e) => a + (e.findings || []).length, 0),
    warnings: list.filter(e => e.action === 'warn').length,
    redactions: list.filter(e => e.action === 'redact').length,
    blocked: list.filter(e => e.action === 'block').length,
    departments: deptRows,
    by_category: segmentRows(list, userMap, 'category'),
    by_college: segmentRows(list, userMap, 'college'),
    models: byModel(list),
    risks,
    trend: buckets(list, 4, windowMs(win) / 4),
    recommendations: orgRecs,
    highest_risk_department: deptRows.slice().sort((a, b) => b.findings - a.findings)[0] || null,
    top_issue: risks[0] || null
  };
}

module.exports = { userDashboard, orgOverview, segments, segmentRows, pmi, windowMs };
