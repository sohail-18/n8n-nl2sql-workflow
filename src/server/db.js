const mysql = require('mysql2/promise');

let pool = null;

function requireEnv(key, fallback = null) {
  const value = process.env[key];
  if (value && value.trim() !== '') {
    return value.trim();
  }
  if (fallback !== null) {
    return fallback;
  }
  throw new Error(`Missing required environment variable ${key}`);
}

function resolvePort(raw, defaultPort = 3306) {
  if (!raw) return defaultPort;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  throw new Error(`Invalid MYSQL_PORT value "${raw}"`);
}

async function createTables(activePool) {
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      client_id VARCHAR(128) NOT NULL DEFAULT 'global',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sessions_client_updated (client_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      role VARCHAR(16) NOT NULL,
      text MEDIUMTEXT NOT NULL,
      time BIGINT NOT NULL,
      table_summary JSON NULL,
      table_data JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_messages_session_time (session_id, time),
      CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureSessionsClientId(activePool);
}

async function ensureSessionsClientId(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM sessions LIKE 'client_id'");
  if (!columns || !columns.length) {
    await pool.query(`
      ALTER TABLE sessions
      ADD COLUMN client_id VARCHAR(128) NOT NULL DEFAULT 'global' AFTER title
    `);
  }

  const [indexes] = await pool.query("SHOW INDEX FROM sessions WHERE Key_name = 'idx_sessions_client_updated'");
  if (!indexes || !indexes.length) {
    await pool.query(`
      ALTER TABLE sessions
      ADD KEY idx_sessions_client_updated (client_id, updated_at)
    `);
  }
}

async function initDatabase() {
  if (pool) {
    return pool;
  }

  const host = requireEnv('MYSQL_HOST');
  const port = resolvePort(process.env.MYSQL_PORT, 3306);
  const user = requireEnv('MYSQL_USER');
  const password = process.env.MYSQL_PASSWORD || '';
  const database = requireEnv('MYSQL_DATABASE');

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z'
  });

  await createTables(pool);
  return pool;
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool has not been initialised. Call initDatabase() first.');
  }
  return pool;
}

module.exports = {
  initDatabase,
  getPool
};
