# Municipal Disaster Alert (PWA)

Node.js + Express + MySQL + vanilla HTML/CSS/JS. Installable in Google Chrome. Web Push for notifications.

## 1. Setup

```bash
npm install
mysql -u root -p < schema.sql        # creates database + tables
cp .env.example .env                 # then edit .env (DB password, JWT_SECRET)
npm run vapid                        # prints a public/private key pair -> paste into .env
npm run create-admin                 # creates the first admin account (password is bcrypt-hashed)
npm start                            # http://localhost:3000
```

Residents sign up themselves on the home page. Admins can only be created with `npm run create-admin`
(public registration always creates a `resident`).

## 2. HTTPS is required (except on localhost)

Service workers, installation and push notifications only work on **HTTPS** or `http://localhost`.
To test on a real phone, deploy behind HTTPS (Nginx/Caddy + Let's Encrypt, or a host that gives you HTTPS)
and set `NODE_ENV=production` so cookies are marked `Secure`.

## 3. Installing as an app in Chrome

- Android Chrome: open the site -> menu -> **Install app** / **Add to Home screen** (or tap the in-page "Install app" button).
- Desktop Chrome: install icon in the address bar.

## 4. Notifications: what the app can and cannot do

- Notifications are **opt-in**. The resident must tap "Turn on alert notifications" and then tap **Allow** in Chrome's permission prompt.
  A website cannot grant itself this permission.
- A normal web app **cannot override the phone's system settings**. If the resident blocked notifications for Chrome or for the
  installed app, enabled Do Not Disturb / battery restrictions, or turned off the app's notification channel in Android settings,
  alerts may be silent, delayed or not shown. The app can only detect "denied" and tell the resident how to fix it.
- It also cannot force a loud alarm sound or bypass silent mode. For life-critical use, combine this system with official channels
  (SMS blasts, sirens, radio, government cell broadcast).
- Delivery is "best effort" through the browser vendor's push service (Google FCM for Chrome). The app also refreshes alerts every
  30 seconds while open.
- iPhone/iPad: web push only works after the app is added to the Home Screen (iOS 16.4+).

## 5. Security implemented

| Requirement | Where |
|---|---|
| bcrypt password hashing (cost 12) | `server.js` register/login, `scripts/create-admin.js` |
| JWT auth in an `httpOnly`, `SameSite=Strict` cookie (8h) | `server.js` `issueToken`, `auth` |
| Protected admin routes | `/admin`, `/admin/app.js` (page guard) and `/api/admin/*` (`requireRole('admin')`) |
| Residents cannot open admin pages | page guard redirects; API returns 403 |
| Input validation | allow-lists for type/level/status, length and email checks |
| SQL injection protection | only `pool.execute(sql, [params])` (prepared statements) |
| Passwords never exposed | `publicUser()` strips them; admin queries never select `password` |
| XSS | all user text is inserted with `textContent`; Helmet CSP blocks inline scripts |
| Brute force | rate limit on login/register |

## 6. Project structure

```
server.js            Express app and API
db.js                MySQL pool
schema.sql           users, alerts, responses (+ push_subscriptions for Web Push)
scripts/create-admin.js
views/               protected pages (resident.*, admin.*)
public/              login page, css, manifest.json, service-worker.js, offline.html, icons
```

## 7. Notes / limits

- "Current alerts" = published within the last `CURRENT_ALERT_HOURS` (default 24h); older ones appear under history.
- A resident has one response per alert; tapping the other button changes it.
- Replace the placeholder icons in `public/icons/` with the municipality's logo (192px, 512px, and a 512px maskable version).
- Role changes take effect after the user logs in again (the role is stored in the signed token).
- Sending is done in batches of 50 inside the request; for very large populations move `sendPush` to a background job.
