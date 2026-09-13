const F = { api: 'apiBase', user: 'userId', dept: 'department' };
chrome.storage.sync.get({ apiBase: globalThis.CASTMIR_DEFAULT_API || 'http://localhost:8080', userId: '', department: 'Unassigned', category: 'Unassigned', college: '', enabled: true }, (s) => {
  document.getElementById('api').value = s.apiBase;
  document.getElementById('user').value = s.userId;
  document.getElementById('dept').value = s.department;
  document.getElementById('cat').value = s.category || 'Unassigned';
  document.getElementById('college').value = s.college || '';
  document.getElementById('enabled').checked = !!s.enabled;
});
document.getElementById('save').onclick = () => {
  chrome.storage.sync.set({
    apiBase: document.getElementById('api').value.trim().replace(/\/$/, ''),
    userId: document.getElementById('user').value.trim() || ('user-' + Math.random().toString(36).slice(2, 10)),
    department: document.getElementById('dept').value.trim() || 'Unassigned',
    category: document.getElementById('cat').value,
    college: document.getElementById('college').value.trim() || 'Unassigned',
    enabled: document.getElementById('enabled').checked
  }, () => { document.getElementById('ok').textContent = 'Saved'; setTimeout(() => document.getElementById('ok').textContent = '', 1800); });
};
