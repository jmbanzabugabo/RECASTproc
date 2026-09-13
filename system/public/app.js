const qs = new URLSearchParams(location.search);
let userId = qs.get('user_id') || localStorage.getItem('castmir_user') || '';
const winSel = document.getElementById('win');
const root = document.getElementById('root');
if (userId) localStorage.setItem('castmir_user', userId);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, max) => max ? Math.round((v / max) * 100) : 0;
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function pickUser() {
  const res = await fetch('/v1/users');
  const { users } = await res.json();
  if (!users.length) {
    root.innerHTML = '<div class="card empty">No prompt activity yet. Install the extension from the <a href="index.html">install page</a>, approve a supported AI site, and send a prompt — this dashboard fills in immediately.</div>';
    return null;
  }
  if (users.length === 1) return users[0].id;
  root.innerHTML = '<div class="card"><h2>Choose a user</h2><div style="display:flex;gap:8px;flex-wrap:wrap">' +
    users.map(u => '<button data-id="' + esc(u.id) + '">' + esc(u.id) + ' · ' + esc(u.department) + '</button>').join('') + '</div></div>';
  root.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => {
    userId = b.dataset.id; localStorage.setItem('castmir_user', userId); load();
  });
  return null;
}

async function load() {
  if (!userId) { const u = await pickUser(); if (!u) return; userId = u; localStorage.setItem('castmir_user', userId); }
  document.getElementById('who').textContent = userId;
  const res = await fetch('/v1/me/dashboard?user_id=' + encodeURIComponent(userId) + '&window=' + winSel.value);
  const d = await res.json();
  if (!d.prompts) {
    root.innerHTML = '<div class="card empty">No prompts captured for <b>' + esc(userId) + '</b> in this window. Send a prompt on an approved AI site and refresh.</div>';
    return;
  }
  const maxRisk = Math.max(1, ...d.risks.map(r => r.value));
  const subs = [['clarity', 'Clarity'], ['context', 'Context'], ['specificity', 'Specificity'], ['structure', 'Structure'], ['output_instructions', 'Output instructions']];
  const trendMax = 100;

  root.innerHTML = `
  <div class="grid kpis" style="margin-bottom:16px">
    <div class="card kpi"><div class="n">${d.quality_score}<span class="muted" style="font-size:14px">/100</span></div><div class="l">Prompt quality</div></div>
    <div class="card kpi"><div class="n">${d.security_score}<span class="muted" style="font-size:14px">/100</span></div><div class="l">Security score</div></div>
    <div class="card kpi"><div class="n">${d.pmi.value}</div><div class="l">Prompt Monitoring Index</div></div>
    <div class="card kpi"><div class="n ${d.improvement >= 0 ? 'good' : 'bad'}">${d.improvement >= 0 ? '+' : ''}${d.improvement}%</div><div class="l">Quality improvement</div></div>
    <div class="card kpi"><div class="n">${d.prompts}</div><div class="l">Prompts analysed</div></div>
  </div>

  <div class="grid cols" style="margin-bottom:16px">
    <div class="card">
      <h2>A · Prompt coaching &amp; performance</h2>
      <div style="display:flex;align-items:flex-end;gap:10px;height:130px;border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:12px">
        ${d.trend.map(b => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px">
          <div class="mono" style="font-size:11px;color:var(--muted)">${b.quality == null ? '—' : b.quality}</div>
          <div style="width:100%;background:var(--garnet);border-radius:5px 5px 0 0;height:${b.quality ? Math.max(4, (b.quality / trendMax) * 100) : 2}px"></div>
          <div class="mono" style="font-size:10.5px;color:var(--muted)">${b.label}</div></div>`).join('')}
      </div>
      ${subs.map(([k, label]) => `<div class="rowbar" style="margin-bottom:9px"><div class="lb">${label}</div>
        <div class="bar" style="flex:1"><i style="width:${d.sub_scores[k]}%"></i></div>
        <div class="vl mono">${d.sub_scores[k]}</div></div>`).join('')}
    </div>

    <div class="card">
      <h2>B · AI model usage &amp; drift</h2>
      <table><thead><tr><th>Model</th><th class="r">Prompts</th><th class="r">Quality</th><th class="r">Trend</th></tr></thead>
      <tbody>${d.models.map(m => `<tr><td><b>${esc(m.name)}</b></td><td class="r mono">${m.prompts}</td><td class="r mono">${m.quality}</td>
        <td class="r" style="font-weight:700;color:${m.trend === '↑' ? 'var(--good)' : m.trend === '↓' ? 'var(--bad)' : 'var(--muted)'}">${m.trend}</td></tr>`).join('')}</tbody></table>
      ${d.models.filter(m => m.drift).map(m => `<div class="rec" style="border-color:#F0DCB9;background:#FEFAF1;margin-top:12px">
        <b style="font-size:12.5px;color:#7d5a12">Drift signal</b><div class="muted" style="color:#5d4a20">${esc(m.name)} prompt quality moved ${m.drift} points across this window. Prompt-behaviour drift and model-performance drift are measured separately.</div></div>`).join('')}
    </div>
  </div>

  <div class="grid cols" style="margin-bottom:16px">
    <div class="card">
      <h2>C · Security &amp; risk</h2>
      <div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px">
        <div class="kpi"><div class="n" style="font-size:22px">${d.security.scanned}</div><div class="l">Scanned</div></div>
        <div class="kpi"><div class="n" style="font-size:22px">${d.security.warnings}</div><div class="l">Warnings</div></div>
        <div class="kpi"><div class="n" style="font-size:22px">${d.security.redacted}</div><div class="l">Redacted</div></div>
        <div class="kpi"><div class="n" style="font-size:22px">${d.security.blocked}</div><div class="l">Blocked</div></div>
      </div>
      ${d.risks.length ? d.risks.map(r => `<div class="rowbar" style="margin-bottom:9px"><div class="lb">${esc(r.label)}</div>
        <div class="bar risk" style="flex:1"><i style="width:${pct(r.value, maxRisk)}%"></i></div><div class="vl mono">${r.value}</div></div>`).join('')
        : '<div class="muted">No security findings in this window.</div>'}
    </div>

    <div class="card">
      <h2>D · Recommendations &amp; personal AI coach</h2>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${d.recommendations.map(r => `<div class="rec"><div style="display:flex;align-items:center;gap:8px"><span class="tag">${esc(r.tag)}</span><b style="font-size:13.5px">${esc(r.title)}</b></div>
          <div class="muted">${esc(r.body)}</div><div style="font-size:13px"><b>Try:</b> ${esc(r.action)}</div></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Prompt history — what changed and why</h2>
    <div class="muted" style="margin-bottom:12px">PMI components: coaching acceptance ${d.pmi.components.coaching_acceptance}% · sustained gain ${d.pmi.components.sustained_gain}% · repeat-mistake decay ${d.pmi.components.repeat_mistake_decay}% · security-clean rate ${d.pmi.components.security_clean_rate}%</div>
    <table><thead><tr><th>When</th><th>Platform</th><th>Prompt</th><th class="r">Quality</th><th class="r">Action</th></tr></thead>
    <tbody>${d.recent.map(e => `<tr>
      <td class="mono" style="color:var(--muted);font-size:12px">${when(e.when)}</td>
      <td>${esc(e.application)}</td>
      <td>${e.preview ? esc(e.preview) : '<span class="muted">stored as metadata only</span>'}${e.revised ? '<div class="muted" style="margin-top:4px">→ ' + esc(e.revised) + '</div>' : ''}</td>
      <td class="r mono">${e.quality_before}${e.quality_after ? ' → ' + e.quality_after : ''}</td>
      <td class="r mono" style="font-size:11.5px;font-weight:700;color:${e.action === 'block' ? 'var(--bad)' : e.action === 'redact' ? 'var(--good)' : e.action === 'warn' ? 'var(--warn)' : 'var(--muted)'}">${esc(e.action)}${e.coaching_applied ? ' · applied' : ''}</td>
    </tr>`).join('')}</tbody></table>
  </div>`;
}

winSel.onchange = load;
load();
setInterval(load, 15000);
