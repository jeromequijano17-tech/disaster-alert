require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const pool = require('./db');

// ---------- Config ----------
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
const CURRENT_HOURS = parseInt(process.env.CURRENT_ALERT_HOURS, 10) || 24; // integer, safe to inline in SQL

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is missing or too short (min 32 chars). See .env.example');
  process.exit(1);
}

const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('VAPID keys not set: push notifications are disabled (run "npm run vapid").');
}

const TYPES = ['typhoon', 'flood', 'earthquake', 'landslide', 'fire', 'other'];
const LEVELS = ['advisory', 'warning', 'emergency'];
const STATUSES = ['safe', 'need_help'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strLen = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

// ---------- App ----------
const app = express();
if (IS_PROD) app.set('trust proxy', 1); // when behind an HTTPS reverse proxy

app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } }
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth helpers ----------
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }); // never includes password

function issueToken(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, {
    httpOnly: true,          // JavaScript cannot read it (XSS protection)
    sameSite: 'strict',      // not sent on cross-site requests (CSRF protection)
    secure: IS_PROD,         // HTTPS only in production
    maxAge: 8 * 60 * 60 * 1000
  });
}

function auth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies.token || '', JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Please log in.' });
  }
}
const requireRole = (role) => (req, res, next) =>
  req.user && req.user.role === role ? next() : res.status(403).json({ error: 'Not allowed.' });

function pageGuard(role) {
  return (req, res, next) => {
    try {
      const u = jwt.verify(req.cookies.token || '', JWT_SECRET);
      if (u.role !== role) return res.redirect(u.role === 'admin' ? '/admin' : '/resident');
      next();
    } catch {
      res.redirect('/');
    }
  };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,   // only failed logins/registrations count
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' }
});

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // keeps login timing similar for unknown emails

// ---------- Auth routes ----------
app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!strLen(name, 2, 100)) return res.status(400).json({ error: 'Name must be 2-100 characters.' });
  if (!strLen(email, 3, 255) || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'Enter a valid email.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 72)
    return res.status(400).json({ error: 'Password must be 8-72 characters.' });

  const em = email.trim().toLowerCase();
  const hash = await bcrypt.hash(password, 12);
  // Role is always 'resident' here. Admins can only be created with scripts/create-admin.js
  const [result] = await pool.execute(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'resident')",
    [name.trim(), em, hash]
  );
  const user = { id: result.insertId, name: name.trim(), email: em, role: 'resident' };
  issueToken(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!strLen(email, 3, 255) || typeof password !== 'string' || password.length > 72)
    return res.status(400).json({ error: 'Enter your email and password.' });

  const [rows] = await pool.execute(
    'SELECT id, name, email, password, role FROM users WHERE email = ?',
    [email.trim().toLowerCase()]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Wrong email or password.' });

  issueToken(res, user);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict', secure: IS_PROD });
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email, role FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Account not found.' });
  res.json({ user: rows[0] });
}));

// ---------- Alerts (any logged-in user) ----------
app.get('/api/alerts', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT a.id, a.type, a.level, a.title, a.message, a.created_at,
            (a.created_at >= NOW() - INTERVAL ${CURRENT_HOURS} HOUR) AS is_current,
            r.status AS my_status
       FROM alerts a
       LEFT JOIN responses r ON r.alert_id = a.id AND r.user_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 100`,
    [req.user.id]
  );
  res.json({ alerts: rows.map((r) => ({ ...r, is_current: !!r.is_current })) });
}));

// ---------- Resident: respond ----------
app.post('/api/alerts/:id/respond', auth, requireRole('resident'), wrap(async (req, res) => {
  const alertId = Number(req.params.id);
  const { status } = req.body || {};
  if (!Number.isInteger(alertId) || alertId < 1) return res.status(400).json({ error: 'Invalid alert.' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid response.' });

  const [found] = await pool.execute('SELECT id FROM alerts WHERE id = ?', [alertId]);
  if (!found[0]) return res.status(404).json({ error: 'Alert not found.' });

  // One response per resident per alert; answering again updates it.
  await pool.execute(
    `INSERT INTO responses (alert_id, user_id, status) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), created_at = CURRENT_TIMESTAMP`,
    [alertId, req.user.id, status]
  );
  res.json({ ok: true, status });
}));

// ---------- Push subscriptions (resident) ----------
app.get('/api/push/key', auth, (req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: 'Push notifications are not configured on the server.' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', auth, requireRole('resident'), wrap(async (req, res) => {
  const sub = req.body && req.body.subscription;
  const endpoint = sub && sub.endpoint;
  const p256dh = sub && sub.keys && sub.keys.p256dh;
  const authKey = sub && sub.keys && sub.keys.auth;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 2048 ||
      !strLen(p256dh, 10, 255) || !strLen(authKey, 10, 255))
    return res.status(400).json({ error: 'Invalid subscription.' });

  const hash = crypto.createHash('sha256').update(endpoint).digest('hex');
  await pool.execute(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [req.user.id, endpoint, hash, p256dh, authKey]
  );
  res.status(201).json({ ok: true });
}));

// ---------- Admin ----------
async function sendPush(alert) {
  if (!PUSH_ENABLED) return { sent: 0, failed: 0, enabled: false };
  const [subs] = await pool.execute(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
      WHERE u.role = 'resident'`
  );
  const icon = { advisory: 'ADVISORY', warning: 'WARNING', emergency: 'EMERGENCY' }[alert.level];
  const payload = JSON.stringify({
    title: `${icon}: ${alert.title}`,
    body: alert.message.length > 140 ? alert.message.slice(0, 137) + '...' : alert.message,
    alertId: alert.id,
    level: alert.level,
    url: `/resident?alert=${alert.id}`
  });
  const options = { TTL: 86400, urgency: alert.level === 'emergency' ? 'high' : 'normal' };

  let sent = 0, failed = 0;
  for (let i = 0; i < subs.length; i += 50) {          // small batches
    await Promise.all(subs.slice(i, i + 50).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) {   // subscription expired/unsubscribed
          await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
        } else {
          console.error('Push failed:', err.statusCode || err.message);
        }
      }
    }));
  }
  return { sent, failed, enabled: true };
}

app.post('/api/admin/alerts', auth, requireRole('admin'), wrap(async (req, res) => {
  const { type, level, title, message } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Choose a disaster type.' });
  if (!LEVELS.includes(level)) return res.status(400).json({ error: 'Choose an alert level.' });
  if (!strLen(title, 3, 150)) return res.status(400).json({ error: 'Title must be 3-150 characters.' });
  if (!strLen(message, 5, 2000)) return res.status(400).json({ error: 'Message must be 5-2000 characters.' });

  const clean = { type, level, title: title.trim(), message: message.trim() };
  const [result] = await pool.execute(
    'INSERT INTO alerts (type, level, title, message) VALUES (?, ?, ?, ?)',
    [clean.type, clean.level, clean.title, clean.message]
  );
  const push = await sendPush({ id: result.insertId, ...clean });
  res.status(201).json({ id: result.insertId, push });
}));

app.get('/api/admin/stats', auth, requireRole('admin'), wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'resident') AS residents,
            (SELECT COUNT(*) FROM alerts) AS alerts,
            (SELECT COUNT(DISTINCT user_id) FROM push_subscriptions) AS notified_residents`
  );
  const r = rows[0];
  res.json({ residents: Number(r.residents), alerts: Number(r.alerts), notified_residents: Number(r.notified_residents) });
}));

app.get('/api/admin/alerts', auth, requireRole('admin'), wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT a.id, a.type, a.level, a.title, a.message, a.created_at,
            COALESCE(SUM(r.status = 'safe'), 0) AS safe_count,
            COALESCE(SUM(r.status = 'need_help'), 0) AS help_count
       FROM alerts a LEFT JOIN responses r ON r.alert_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 100`
  );
  res.json({ alerts: rows.map((r) => ({ ...r, safe_count: Number(r.safe_count), help_count: Number(r.help_count) })) });
}));

app.get('/api/admin/alerts/:id/responses', auth, requireRole('admin'), wrap(async (req, res) => {
  const alertId = Number(req.params.id);
  if (!Number.isInteger(alertId) || alertId < 1) return res.status(400).json({ error: 'Invalid alert.' });
  // Only name/email/status are selected: password hashes are never read here.
  const [responses] = await pool.execute(
    `SELECT u.name, u.email, r.status, r.created_at
       FROM responses r JOIN users u ON u.id = r.user_id
      WHERE r.alert_id = ?
      ORDER BY (r.status = 'need_help') DESC, r.created_at DESC`,
    [alertId]
  );
  const [pending] = await pool.execute(
    `SELECT name, email FROM users
      WHERE role = 'resident' AND id NOT IN (SELECT user_id FROM responses WHERE alert_id = ?)
      ORDER BY name`,
    [alertId]
  );
  res.json({ responses, pending });
}));

// ---------- Pages ----------
const view = (name) => (req, res) => res.sendFile(path.join(__dirname, 'views', name));
app.get('/resident', pageGuard('resident'), view('resident.html'));
app.get('/resident/app.js', pageGuard('resident'), view('resident.js'));
app.get('/admin', pageGuard('admin'), view('admin.html'));
app.get('/admin/app.js', pageGuard('admin'), view('admin.js'));

// Public files: login page, CSS, manifest, service worker, icons
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Errors ----------
app.use((err, req, res, next) => {
  if (err && err.status >= 400 && err.status < 500)
    return res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Request too large.' : 'Invalid request.' });
  if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email is already registered.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => console.log(`Municipal Disaster Alert running on http://localhost:${PORT}`));
