'use strict';
const $ = (id) => document.getElementById(id);
const VIEWS = ['dashboard', 'create', 'alerts'];

function show(name) {
  VIEWS.forEach((v) => {
    $('view-' + v).classList.toggle('hidden', v !== name);
    $('tab-' + v).setAttribute('aria-selected', v === name);
  });
  if (name === 'dashboard' || name === 'alerts') refresh();
}
VIEWS.forEach((v) => $('tab-' + v).addEventListener('click', () => show(v)));
$('logout').addEventListener('click', logout);

function adminCard(a, withDetails) {
  const lv = LEVELS[a.level];
  const card = el('article', `alert ${a.level}`);
  card.appendChild(el('div', 'head', `${lv.icon} ${lv.label}`));
  const body = el('div', 'body');
  body.appendChild(el('h3', '', a.title));
  body.appendChild(el('p', '', a.message));
  body.appendChild(el('div', 'meta', `${TYPES[a.type]} \u2022 ${fmtDate(a.created_at)}`));

  const counts = el('p', '');
  counts.append(el('span', 'pill safe', `${a.safe_count} safe`), ' ', el('span', 'pill need_help', `${a.help_count} need help`));
  body.appendChild(counts);

  if (withDetails) {
    const btn = el('button', 'btn secondary', 'View responses');
    btn.type = 'button';
    const box = el('div', 'scroll');
    let loaded = false;
    btn.addEventListener('click', async () => {
      if (loaded) { box.classList.toggle('hidden'); return; }
      btn.disabled = true;
      try {
        const data = await api(`/api/admin/alerts/${a.id}/responses`);
        box.replaceChildren(responsesTable(data));
        loaded = true;
      } catch (err) { box.textContent = err.message; }
      btn.disabled = false;
    });
    body.append(btn, box);
  }
  card.appendChild(body);
  return card;
}

function responsesTable({ responses, pending }) {
  const wrap = el('div');
  const table = el('table');
  const head = el('tr');
  ['Resident', 'Email', 'Status', 'Time'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  responses.forEach((r) => {
    const tr = el('tr');
    tr.append(el('td', '', r.name), el('td', '', r.email));
    const st = el('td');
    st.appendChild(el('span', 'pill ' + r.status, r.status === 'safe' ? 'SAFE' : 'NEEDS HELP'));
    tr.append(st, el('td', '', fmtDate(r.created_at)));
    table.appendChild(tr);
  });
  if (!responses.length) wrap.appendChild(el('p', 'muted', 'No responses yet.'));
  else wrap.appendChild(table);
  wrap.appendChild(el('p', 'muted', `Not yet responded: ${pending.length}` + (pending.length ? ' \u2014 ' + pending.map((p) => p.name).join(', ') : '')));
  return wrap;
}

async function refresh() {
  try {
    const [stats, list] = await Promise.all([api('/api/admin/stats'), api('/api/admin/alerts')]);
    $('s-residents').textContent = stats.residents;
    $('s-alerts').textContent = stats.alerts;
    $('s-notified').textContent = stats.notified_residents;
    const latest = list.alerts[0];
    $('latest').replaceChildren(latest ? adminCard(latest, true) : el('p', 'muted', 'No alerts yet. Use "Create Alert" to send the first one.'));
    $('view-alerts').replaceChildren(...(list.alerts.length ? list.alerts.map((a) => adminCard(a, true)) : [el('p', 'muted', 'No alerts yet.')]));
  } catch (err) {
    if (err.status === 401 || err.status === 403) location.href = '/';
  }
}

// ---------- Create alert ----------
function updatePreview() { $('level-preview').className = 'preview ' + $('a-level').value; }
$('a-level').addEventListener('change', updatePreview);
updatePreview();

$('alert-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('create-msg');
  const body = { type: $('a-type').value, level: $('a-level').value, title: $('a-title').value, message: $('a-message').value };
  if (body.title.trim().length < 3 || body.message.trim().length < 5) return showMsg(msg, 'Enter a title and a message.', 'error');
  if (!confirm(`Send this ${body.level.toUpperCase()} alert to all residents now?`)) return;

  const btn = $('send-btn');
  btn.disabled = true;
  try {
    const res = await api('/api/admin/alerts', { method: 'POST', body });
    const p = res.push;
    showMsg(msg, p.enabled
      ? `Alert published. Notifications sent to ${p.sent} device(s)` + (p.failed ? `, ${p.failed} failed.` : '.')
      : 'Alert published. Push notifications are not configured on the server, so residents will only see it when they open the app.', 'ok');
    $('alert-form').reset();
    updatePreview();
  } catch (err) {
    showMsg(msg, err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

(async () => {
  try { $('who').textContent = (await api('/api/auth/me')).user.name; } catch { location.href = '/'; return; }
  refresh();
})();
