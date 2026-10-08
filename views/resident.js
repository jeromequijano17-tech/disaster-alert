'use strict';
const $ = (id) => document.getElementById(id);
const highlightId = Number(new URLSearchParams(location.search).get('alert')) || null;

function alertCard(a) {
  const lv = LEVELS[a.level];
  const card = el('article', `alert ${a.level}` + (a.id === highlightId ? ' highlight' : ''));
  card.id = 'alert-' + a.id;
  card.appendChild(el('div', 'head', `${lv.icon} ${lv.label}`));

  const body = el('div', 'body');
  body.appendChild(el('h3', '', a.title));
  body.appendChild(el('p', '', a.message));
  body.appendChild(el('div', 'meta', `${TYPES[a.type]} \u2022 ${fmtDate(a.created_at)}`));

  const row = el('div', 'respond');
  const safe = el('button', 'safe', "I'M SAFE");
  const help = el('button', 'help', 'I NEED HELP');
  safe.type = help.type = 'button';
  safe.setAttribute('aria-pressed', a.my_status === 'safe');
  help.setAttribute('aria-pressed', a.my_status === 'need_help');
  safe.addEventListener('click', () => respond(a.id, 'safe', row));
  help.addEventListener('click', () => respond(a.id, 'need_help', row));
  row.append(safe, help);
  body.appendChild(row);

  if (a.my_status) {
    body.appendChild(el('div', 'myresp ' + a.my_status,
      a.my_status === 'safe' ? 'You reported: SAFE' : 'You reported: NEED HELP (sent to the municipality)'));
  }
  card.appendChild(body);
  return card;
}

function normalCard() {
  const card = el('article', 'alert normal');
  card.appendChild(el('div', 'head', '\u2705 NORMAL'));
  const body = el('div', 'body');
  body.appendChild(el('p', '', 'No active alerts. You will be notified if the municipality publishes one.'));
  card.appendChild(body);
  return card;
}

async function respond(alertId, status, row) {
  if (status === 'need_help' && !confirm('Send "I NEED HELP" to the municipality?')) return;
  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await api(`/api/alerts/${alertId}/respond`, { method: 'POST', body: { status } });
    await loadAlerts();
  } catch (err) {
    alert(err.message + (navigator.onLine ? '' : ' (You are offline.)'));
    row.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}

async function loadAlerts() {
  try {
    const { alerts } = await api('/api/alerts');
    const current = alerts.filter((a) => a.is_current);
    const history = alerts.filter((a) => !a.is_current);
    $('current').replaceChildren(...(current.length ? current.map(alertCard) : [normalCard()]));
    $('history').replaceChildren(...(history.length ? history.map(alertCard) : [el('p', 'muted', 'No older alerts.')]));
    const target = highlightId && $('alert-' + highlightId);
    if (target && !loadAlerts.scrolled) { target.scrollIntoView({ block: 'center' }); loadAlerts.scrolled = true; }
  } catch (err) {
    if (err.status === 401) return (location.href = '/');
    $('current').replaceChildren(el('p', 'muted', 'Could not load alerts. Check your connection.'));
  }
}

// ---------- Notifications ----------
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function setupNotifications() {
  const box = $('notif-box'), text = $('notif-text'), btn = $('notif-btn');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    box.classList.remove('hidden');
    text.textContent = 'This browser does not support alert notifications. Open the app regularly to check for alerts.';
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    try { await subscribePush(); } catch { /* server push not configured or offline */ }
    return; // all good, nothing to show
  }
  box.classList.remove('hidden');
  if (perm === 'denied') {
    text.textContent = 'Notifications are blocked for this app. To receive alerts, allow notifications for this site in Chrome (site settings) and in your phone\u2019s system settings.';
    return;
  }
  text.textContent = 'Allow notifications to be warned immediately when an alert is published. Your phone will ask for permission.';
  btn.classList.remove('hidden');
  btn.addEventListener('click', async () => {
    const result = await Notification.requestPermission();   // must be triggered by a tap
    if (result === 'granted') {
      try { await subscribePush(); box.classList.add('hidden'); }
      catch (err) { text.textContent = 'Notifications were allowed, but setup failed: ' + err.message; }
    } else {
      text.textContent = 'Permission was not granted. You can allow it later in Chrome and phone settings.';
      btn.classList.add('hidden');
    }
  });
}

// ---------- Install ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('install-btn').classList.remove('hidden');
});
$('install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('install-btn').classList.add('hidden');
});
window.addEventListener('appinstalled', () => $('install-btn').classList.add('hidden'));

// ---------- Start ----------
const updateOnline = () => $('offline').classList.toggle('hidden', navigator.onLine);
window.addEventListener('online', () => { updateOnline(); loadAlerts(); });
window.addEventListener('offline', updateOnline);
$('logout').addEventListener('click', logout);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'alert-received') loadAlerts(); });
}

(async () => {
  updateOnline();
  try {
    const { user } = await api('/api/auth/me');
    $('who').textContent = user.name;
  } catch (err) { if (err.status === 401) return (location.href = '/'); }
  await loadAlerts();
  setInterval(loadAlerts, 30000);   // fallback if a push is missed
  setupNotifications();
})();
