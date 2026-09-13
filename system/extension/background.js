'use strict';
try { importScripts('config.js'); } catch (e) { /* optional */ }
const DEFAULTS = {
  apiBase: globalThis.CASTMIR_DEFAULT_API || 'http://localhost:8080',
  userId: '', department: 'Unassigned', category: 'Unassigned', college: 'Unassigned',
  enabled: true
};

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  if (!s.userId) {
    s.userId = 'user-' + Math.random().toString(36).slice(2, 10);
    await chrome.storage.sync.set({ userId: s.userId });
  }
  return s;
}

async function post(pathname, body) {
  const s = await settings();
  const res = await fetch(s.apiBase.replace(/\/$/, '') + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CASTmir-Key': s.userId },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const s = await settings();
      if (msg.type === 'settings') return sendResponse({ ok: true, settings: s });
      if (msg.type === 'analyze') {
        const data = await post('/v1/prompts/analyze', {
          prompt: msg.prompt, user_id: s.userId,
          department: s.department, category: s.category, college: s.college,
          host: msg.host, model: msg.model
        });
        bumpBadge();
        return sendResponse({ ok: true, data });
      }
      if (msg.type === 'accept') {
        await post('/v1/coaching/' + encodeURIComponent(msg.promptId) + '/accept', { kind: msg.kind, quality_score: msg.qualityScore });
        return sendResponse({ ok: true });
      }
      if (msg.type === 'openDashboard') {
        chrome.tabs.create({ url: s.apiBase.replace(/\/$/, '') + '/dashboard.html?user_id=' + encodeURIComponent(s.userId) });
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: 'unknown message' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;
});

let count = 0;
function bumpBadge() {
  count++;
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: '#782F40' });
}

// Silent patch/rule updates — no reinstall required.
async function checkPatches() {
  try {
    const s = await settings();
    const res = await fetch(s.apiBase.replace(/\/$/, '') + '/v1/patches/check');
    if (!res.ok) return;
    const bundle = await res.json();
    await chrome.storage.local.set({ bundle, bundleCheckedAt: Date.now() });
  } catch (e) { /* offline: keep the last good bundle */ }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('castmir-patch', { periodInMinutes: 60 });
  checkPatches();
});
chrome.runtime.onStartup.addListener(checkPatches);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'castmir-patch') checkPatches(); });
