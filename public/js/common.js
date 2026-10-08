'use strict';

// JSON fetch helper. Throws Error(message) when the server answers with an error.
async function api(path, options = {}) {
  const opts = { credentials: 'same-origin', headers: {}, ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Safe DOM builder: text always goes through textContent (no HTML injection).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const LEVELS = {
  advisory:  { label: 'ADVISORY',  icon: '\u2139\uFE0F' },
  warning:   { label: 'WARNING',   icon: '\u26A0\uFE0F' },
  emergency: { label: 'EMERGENCY ALERT', icon: '\uD83D\uDEA8' }
};
const TYPES = { typhoon: 'Typhoon', flood: 'Flood', earthquake: 'Earthquake', landslide: 'Landslide', fire: 'Fire', other: 'Other' };
const fmtDate = (s) => new Date(s).toLocaleString();

function showMsg(node, text, kind) {
  node.textContent = text || '';
  node.className = 'msg' + (text ? ' ' + kind : '');
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  if ('caches' in window) { try { await caches.delete('mda-api-v1'); } catch { /* ignore */ } }
  location.href = '/';
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}
