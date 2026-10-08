// Usage: npm run create-admin
// Creates (or promotes) an admin account. The password is hashed with bcrypt.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const pool = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

(async () => {
  try {
    const name = (await ask('Admin name: ')).trim();
    const email = (await ask('Admin email: ')).trim().toLowerCase();
    const password = await ask('Admin password (min 8 chars): ');
    rl.close();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 72) {
      console.error('Invalid input. Name >= 2 chars, valid email, password 8-72 chars.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE name = VALUES(name), password = VALUES(password), role = 'admin'`,
      [name, email, hash]
    );
    console.log(`Admin ready: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
})();
