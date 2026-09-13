'use strict';
(() => {
  if (window.__castmirLoaded) return;
  window.__castmirLoaded = true;

  const HOST = location.hostname;
  const SITES = {
    'chatgpt.com': { name: 'ChatGPT', editor: '#prompt-textarea, div[contenteditable="true"]', send: 'button[data-testid="send-button"], button[aria-label*="Send"]' },
    'chat.openai.com': { name: 'ChatGPT', editor: '#prompt-textarea, div[contenteditable="true"]', send: 'button[data-testid="send-button"]' },
    'claude.ai': { name: 'Claude', editor: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]', send: 'button[aria-label*="Send"]' },
    'gemini.google.com': { name: 'Gemini', editor: 'rich-textarea div[contenteditable="true"], div[contenteditable="true"]', send: 'button[aria-label*="Send"], button.send-button' },
    'copilot.microsoft.com': { name: 'Copilot', editor: 'textarea#userInput, textarea, div[contenteditable="true"]', send: 'button[aria-label*="Submit"], button[title*="Submit"]' },
    'www.perplexity.ai': { name: 'Perplexity', editor: 'textarea, div[contenteditable="true"]', send: 'button[aria-label*="Submit"]' },
    'perplexity.ai': { name: 'Perplexity', editor: 'textarea, div[contenteditable="true"]', send: 'button[aria-label*="Submit"]' }
  };
  const SITE = SITES[HOST] || { name: HOST, editor: 'textarea, div[contenteditable="true"]', send: 'button[type="submit"]' };

  let settings = null;
  let allowNext = false;
  let busy = false;

  const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, r));

  (async () => {
    const r = await send({ type: 'settings' });
    settings = r && r.ok ? r.settings : null;
    if (!settings || !settings.enabled) return;
    const key = 'castmir-consent:' + HOST;
    if (localStorage.getItem(key) !== 'granted') showConsent(key);
    install();
  })();

  function getEditor(from) {
    if (from && (from.isContentEditable || from.tagName === 'TEXTAREA')) return from;
    const el = document.querySelector(SITE.editor);
    return el || null;
  }
  function getText(el) { return el ? (el.tagName === 'TEXTAREA' ? el.value : el.innerText) : ''; }
  function setText(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  }
  function doSend(el) {
    allowNext = true;
    const btn = document.querySelector(SITE.send);
    if (btn && !btn.disabled) { btn.click(); setTimeout(() => { allowNext = false; }, 1500); return; }
    el.focus();
    const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', ev));
    el.dispatchEvent(new KeyboardEvent('keyup', ev));
    setTimeout(() => { allowNext = false; }, 1500);
  }

  function install() {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
  }
  function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || allowNext || busy) return;
    const el = getEditor(e.target);
    if (!el || !el.contains(e.target) && el !== e.target) return;
    const text = getText(el).trim();
    if (text.length < 3) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    run(el, text);
  }
  function onClick(e) {
    if (allowNext || busy) return;
    const btn = e.target.closest && e.target.closest(SITE.send);
    if (!btn) return;
    const el = getEditor(null);
    const text = getText(el).trim();
    if (!el || text.length < 3) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    run(el, text);
  }

  async function run(el, text) {
    busy = true;
    const panel = openPanel();
    panel.setLoading();
    const r = await send({ type: 'analyze', prompt: text, host: HOST, model: detectModel() });
    busy = false;
    if (!r || !r.ok) { panel.setError(r && r.error || 'CASTmir server unreachable'); return; }
    panel.setResult(r.data, el, text);
  }

  function detectModel() {
    const sel = document.querySelector('[data-testid*="model"], [aria-label*="model"], .model-name');
    const t = sel && sel.textContent ? sel.textContent.trim().slice(0, 40) : '';
    return t || null;
  }

  // ---------- UI ----------
  const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; right: 18px; bottom: 18px; width: 380px; max-width: calc(100vw - 36px);
    background: #fff; color: #15181c; border: 1px solid #E0D6D8; border-radius: 14px;
    box-shadow: 0 18px 48px rgba(50,20,26,.22); font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    z-index: 2147483647; overflow: hidden; }
  .hd { background: #5C222D; color: #F6ECEE; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .hd b { font-size: 13px; letter-spacing: .01em; }
  .x { cursor: pointer; opacity: .8; font-size: 16px; line-height: 1; }
  .bd { padding: 14px; display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow: auto; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
  .score { font-size: 26px; font-weight: 700; letter-spacing: -.5px; }
  .muted { color: #6b727b; font-size: 12px; }
  .box { border: 1px solid #EADFE1; border-radius: 10px; padding: 11px; font-size: 13px; line-height: 1.55; }
  .risk { border-color: #E7CDC8; background: #FDF7F6; }
  .sugg { border-color: #E6CFD4; background: #FCF6F7; }
  .tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; color: #782F40; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; font-size: 13px; font-weight: 600; border-radius: 8px; padding: 9px 13px; cursor: pointer; min-height: 40px; border: 1px solid #CFC5C7; background: #fff; color: #15181c; }
  button.primary { background: #782F40; border-color: #782F40; color: #fff; }
  button.ghost { color: #6b727b; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { font-size: 12.5px; line-height: 1.6; }
  .bar { height: 6px; background: #EFEAEB; border-radius: 3px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #782F40; }
  `;

  function shadow() {
    const hostEl = document.createElement('div');
    document.documentElement.appendChild(hostEl);
    const root = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    return { hostEl, root };
  }

  function openPanel() {
    const { hostEl, root } = shadow();
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.appendChild(wrap);
    const close = () => hostEl.remove();
    const head = (title) => `<div class="hd"><b>${title}</b><span class="x">✕</span></div>`;
    const bind = () => { const x = root.querySelector('.x'); if (x) x.onclick = close; };

    return {
      close,
      setLoading() { wrap.innerHTML = head('CASTmir — checking your prompt') + '<div class="bd"><div class="muted">Scoring quality and scanning for sensitive content…</div></div>'; bind(); },
      setError(msg) {
        wrap.innerHTML = head('CASTmir — offline') +
          '<div class="bd"><div class="box">' + msg + '. Your prompt was not sent to CASTmir.</div><div class="btns"><button class="primary" id="go">Send anyway</button><button class="ghost" id="no">Cancel</button></div></div>';
        bind();
        root.getElementById('no').onclick = close;
        root.getElementById('go').onclick = () => { const el = getEditor(null); close(); doSend(el); };
      },
      setResult(data, el, original) {
        const q = data.quality, s = data.security;
        const blocked = s.action === 'block';
        const revision = data.revision;
        const gaps = (q.gaps || []).slice(0, 4);
        wrap.innerHTML = head(blocked ? 'CASTmir — blocked by policy' : 'CASTmir — before you send') + '<div class="bd">' +
          '<div class="row"><div><div class="tag">Prompt quality</div><div class="score">' + q.score + '<span class="muted">/100</span></div></div>' +
          '<div style="text-align:right"><div class="tag">Security</div><div class="score">' + s.score + '<span class="muted">/100</span></div></div></div>' +
          '<div class="bar"><i style="width:' + q.score + '%"></i></div>' +
          (s.findings.length ? '<div class="box risk"><div class="tag">Security agent · ' + s.findings.length + ' finding(s)</div><ul>' +
            s.findings.map(f => '<li>' + f.label + ' — <span class="muted">' + f.class + ' · ' + f.severity + '</span></li>').join('') + '</ul></div>' : '') +
          (gaps.length ? '<div class="box sugg"><div class="tag">Prompt coach</div><ul>' + gaps.map(g => '<li>' + g.text + '</li>').join('') + '</ul></div>' : '') +
          (revision && !blocked ? '<div class="box"><div class="tag">Suggested revision' + (data.revised_quality_score ? ' · ' + data.revised_quality_score + '/100' : '') + '</div><div style="margin-top:6px">' + escapeHtml(revision) + '</div></div>' : '') +
          '<div class="btns">' +
          (blocked ? '<button class="primary" id="cancel">Edit my prompt</button>'
                   : (revision ? '<button class="primary" id="apply">Apply &amp; send</button>' : '') +
                     (s.security_redacted || s.redacted ? '<button id="redact">Send redacted</button>' : '<button id="asis">Send as is</button>') +
                     '<button class="ghost" id="dismiss">Dismiss</button>') +
          '</div>' +
          '<div class="muted">Storage: ' + data.policy.storage_mode + ' · ' + data.model.application + '</div></div>';
        bind();
        const byId = (i) => root.getElementById(i);
        if (byId('cancel')) byId('cancel').onclick = close;
        if (byId('dismiss')) byId('dismiss').onclick = close;
        if (byId('asis')) byId('asis').onclick = () => { close(); doSend(el); };
        if (byId('redact')) byId('redact').onclick = () => { setText(el, s.redacted); close(); setTimeout(() => doSend(el), 120); };
        if (byId('apply')) byId('apply').onclick = async () => {
          setText(el, revision);
          send({ type: 'accept', promptId: data.prompt_id, kind: 'revision', qualityScore: data.revised_quality_score });
          close();
          setTimeout(() => doSend(el), 140);
        };
      }
    };
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function showConsent(key) {
    const { hostEl, root } = shadow();
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = '<div class="hd"><b>CASTmir would like to monitor this site</b><span class="x">✕</span></div>' +
      '<div class="bd"><div class="box">Nothing is captured until you approve this site. CASTmir reads the prompt you are about to send on <b>' + HOST + '</b>, scores it, scans it for sensitive content, and stores the result under your organisation policy. It does not read the page or the AI response.</div>' +
      '<div class="btns"><button class="primary" id="ok">Approve this site</button><button class="ghost" id="not">Not now</button></div></div>';
    root.appendChild(wrap);
    root.querySelector('.x').onclick = () => hostEl.remove();
    root.getElementById('not').onclick = () => hostEl.remove();
    root.getElementById('ok').onclick = () => { localStorage.setItem(key, 'granted'); hostEl.remove(); };
  }
})();
