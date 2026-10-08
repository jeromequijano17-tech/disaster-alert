require('dotenv').config();
const mysql = require('mysql2/promise');

// A pool of connections. Every query in this project uses pool.execute(sql, [params]),
// i.e. prepared statements with placeholders (?) -> protection against SQL injection.
module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'disaster_alert',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});
