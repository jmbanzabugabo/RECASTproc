const winSel = document.getElementById('win');
const root = document.getElementById('root');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function load() {
  const [o, s, pol, seg] = await Promise.all([
    fetch('/v1/org/overview?window=' + winSel.value).then(r => r.json()),
    fetch('/v1/org/security/events?window=' + winSel.value).then(r => r.json()),
    fetch('/v1/org/policy').then(r => r.json()),
    fetch('/v1/org/segments?window=' + winSel.value).then(r => r.json())
  ]);
  if (!o.prompts) {
    root.innerHTML = '<div class="card empty">No organisation activity yet. Once users install the extension and approve a site, this fills in automatically.</div>';
    return;
  }
  const maxRisk = Math.max(1, ...o.risks.map(r => r.value));
  root.innerHTML = `
  <div class="grid kpis" style="margin-bottom:16px">
    <div class="card kpi"><div class="n">${o.users}</div><div class="l">Users</div></div>
    <div class="card kpi"><div class="n">${o.prompts.toLocaleString()}</div><div class="l">Prompts analysed</div></div>
    <div class="card kpi"><div class="n">${o.platforms}</div><div class="l">AI platforms</div></div>
    <div class="card kpi"><div class="n">${o.quality}</div><div class="l">Avg. prompt quality</div></div>
    <div class="card kpi"><div class="n ${o.improvement >= 0 ? 'good' : 'bad'}">${o.improvement >= 0 ? '+' : ''}${o.improvement}%</div><div class="l">Improvement</div></div>
    <div class="card kpi"><div class="n">${o.security_events.toLocaleString()}</div><div class="l">Security findings</div></div>
  </div>

  <div class="grid cols" style="margin-bottom:16px">
    <div class="card">
      <h2>Quality by department</h2>
      <table><thead><tr><th>Department</th><th class="r">Users</th><th class="r">Quality</th><th class="r">Improvement</th><th class="r">Risk</th></tr></thead>
      <tbody>${o.departments.map(d => `<tr><td><b>${esc(d.name)}</b></td><td class="r mono">${d.users}</td><td class="r mono">${d.quality}</td>
        <td class="r mono ${d.improvement >= 0 ? 'good' : 'bad'}">${d.improvement >= 0 ? '+' : ''}${d.improvement}%</td>
        <td class="r mono" style="font-weight:700;color:${d.risk === 'High' ? 'var(--bad)' : d.risk === 'Medium' ? 'var(--warn)' : 'var(--good)'}">${d.risk}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="card">
      <h2>Security overview</h2>
      ${o.risks.map(r => `<div class="rowbar" style="margin-bottom:10px"><div class="lb">${esc(r.label)}</div>
        <div class="bar risk" style="flex:1"><i style="width:${Math.round((r.value / maxRisk) * 100)}%"></i></div><div class="vl mono">${r.value}</div></div>`).join('')}
      <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);padding-top:12px;margin-top:12px">
        <div><div class="l muted">Warnings</div><b>${o.warnings}</b></div>
        <div><div class="l muted">Redactions</div><b>${o.redactions}</b></div>
        <div><div class="l muted">Blocked</div><b>${o.blocked}</b></div>
      </div>
      ${o.highest_risk_department ? '<div class="muted" style="margin-top:10px">Highest-risk department: <b>' + esc(o.highest_risk_department.name) + '</b>' + (o.top_issue ? ' · most common issue: <b>' + esc(o.top_issue.label) + '</b>' : '') + '</div>' : ''}
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h2>Segments</h2>
    <div class="muted" style="margin-bottom:12px">Rolls up by any user attribute. Category, college and programme fill in when the institution's management system is connected; until then users report their own department.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" id="segtabs">
      ${['category', 'college', 'department', 'program'].map((f, i) => `<button data-seg="${f}" class="${i === 0 ? 'primary' : ''}" style="text-transform:capitalize">${f}</button>`).join('')}
    </div>
    <div id="segbody"></div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h2>Organisation-wide recommendations</h2>
    <div class="grid cols">${o.recommendations.length ? o.recommendations.map(r => `<div class="rec"><b style="font-size:13px">${esc(r.title)}</b><div class="muted">${esc(r.body)}</div></div>`).join('') : '<div class="muted">Not enough data yet.</div>'}</div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h2>Security event log</h2>
    <div class="muted" style="margin-bottom:10px">Detections and actions only — prompt content is never shown here.</div>
    <table><thead><tr><th>When</th><th>Department</th><th>Platform</th><th>Detections</th><th class="r">Action</th></tr></thead>
    <tbody>${s.events.map(e => `<tr><td class="mono" style="font-size:12px;color:var(--muted)">${when(e.when)}</td>
      <td>${esc(e.department)}</td><td>${esc(e.application)}</td><td>${esc(e.detections.join(', '))}</td>
      <td class="r mono" style="font-size:11.5px;font-weight:700;color:${e.action === 'block' ? 'var(--bad)' : e.action === 'redact' ? 'var(--good)' : 'var(--warn)'}">${esc(e.action)}</td></tr>`).join('')}</tbody></table>
  </div>

  <div class="card">
    <h2>Active policy</h2>
    <div class="muted">Storage mode <b>${esc(pol.storage_mode)}</b> · retention <b>${pol.retention_days} days</b> · auto-redact <b>${pol.auto_redact ? 'on' : 'off'}</b> · enforcement <b>${esc(pol.mode)}</b> · rules <span class="mono">${esc(pol.rule_version)}</span></div>
    <div class="muted" style="margin-top:8px">Change it with <span class="mono">PUT /v1/org/policy</span> and the admin key. Clients pick the change up within the hour — no reinstall.</div>
  </div>`;
  const segBody = document.getElementById('segbody');
  const drawSeg = (field) => {
    const rows = (seg.segments && seg.segments[field]) || [];
    const real = rows.filter(r => r.name !== 'Unassigned');
    if (!rows.length || (!real.length && field !== 'department')) {
      segBody.innerHTML = '<div class="muted">No <b>' + field + '</b> values yet. Populate them with <span class="mono">POST /v1/directory/sync</span> or let users set them in extension settings.</div>';
      return;
    }
    segBody.innerHTML = '<table><thead><tr><th style="text-transform:capitalize">' + field + '</th><th class="r">Users</th><th class="r">Prompts</th><th class="r">Quality</th><th class="r">Improvement</th><th class="r">Findings</th><th class="r">Risk</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td><b>' + esc(r.name) + '</b></td><td class="r mono">' + r.users + '</td><td class="r mono">' + r.prompts + '</td><td class="r mono">' + r.quality + '</td>' +
        '<td class="r mono ' + (r.improvement >= 0 ? 'good' : 'bad') + '">' + (r.improvement >= 0 ? '+' : '') + r.improvement + '%</td>' +
        '<td class="r mono">' + r.findings + '</td>' +
        '<td class="r mono" style="font-weight:700;color:' + (r.risk === 'High' ? 'var(--bad)' : r.risk === 'Medium' ? 'var(--warn)' : 'var(--good)') + '">' + r.risk + '</td></tr>').join('') +
      '</tbody></table>';
  };
  document.querySelectorAll('#segtabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#segtabs button').forEach(x => x.classList.remove('primary'));
    b.classList.add('primary');
    drawSeg(b.dataset.seg);
  });
  drawSeg('category');
}

winSel.onchange = load;
load();
setInterval(load, 20000);
