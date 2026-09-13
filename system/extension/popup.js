chrome.runtime.sendMessage({ type: 'settings' }, async (r) => {
  if (!r || !r.ok) return;
  const s = r.settings;
  document.getElementById('state').textContent = s.enabled ? 'monitoring' : 'paused';
  try {
    const res = await fetch(s.apiBase.replace(/\/$/, '') + '/v1/me/dashboard?user_id=' + encodeURIComponent(s.userId));
    const d = await res.json();
    document.getElementById('q').textContent = d.quality_score || '—';
    document.getElementById('s').textContent = d.security_score || '—';
    document.getElementById('p').textContent = (d.pmi && d.pmi.value) || '—';
    document.getElementById('n').textContent = d.prompts || 0;
  } catch (e) {
    document.getElementById('msg').textContent = 'Server unreachable — check Settings.';
  }
});
document.getElementById('dash').onclick = () => chrome.runtime.sendMessage({ type: 'openDashboard' });
document.getElementById('opts').onclick = () => chrome.runtime.openOptionsPage();
