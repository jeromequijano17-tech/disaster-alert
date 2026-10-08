'use strict';
const $ = (id) => document.getElementById(id);
const msg = $('auth-msg');

function go(user) { location.href = user.role === 'admin' ? '/admin' : '/resident'; }

// Already logged in? Skip the form.
api('/api/auth/me').then((d) => go(d.user)).catch(() => {});

if (!navigator.onLine) $('offline').classList.remove('hidden');
window.addEventListener('offline', () => $('offline').classList.remove('hidden'));
window.addEventListener('online', () => $('offline').classList.add('hidden'));

function selectTab(which) {
  const login = which === 'login';
  $('tab-login').setAttribute('aria-selected', login);
  $('tab-register').setAttribute('aria-selected', !login);
  $('login-form').classList.toggle('hidden', !login);
  $('register-form').classList.toggle('hidden', login);
  showMsg(msg, '');
}
$('tab-login').addEventListener('click', () => selectTab('login'));
$('tab-register').addEventListener('click', () => selectTab('register'));

async function submit(form, path, body) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await api(path, { method: 'POST', body });
    go(data.user);
  } catch (err) {
    showMsg(msg, err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submit(e.target, '/api/auth/login', { email: $('l-email').value, password: $('l-pass').value });
});

$('register-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('r-pass').value.length < 8) return showMsg(msg, 'Password must be at least 8 characters.', 'error');
  submit(e.target, '/api/auth/register', { name: $('r-name').value, email: $('r-email').value, password: $('r-pass').value });
});
