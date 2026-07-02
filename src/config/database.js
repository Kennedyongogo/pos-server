const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'pos-local.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    client_code TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id),
    UNIQUE(client_id, username)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    cost REAL,
    stock INTEGER DEFAULT 0,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    total REAL NOT NULL,
    tax REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'completed',
    cashier_name TEXT,
    cashier_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT NOT NULL,
    client_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS client_mpesa_settings (
    client_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    env TEXT DEFAULT 'sandbox',
    shortcode TEXT,
    consumer_key_enc TEXT,
    consumer_secret_enc TEXT,
    passkey_enc TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
`);

function seedSystemOwner() {
  const ownerExists = db.prepare("SELECT id FROM users WHERE role = 'system_owner'").get();
  if (ownerExists) return;

  const systemClientId = uuidv4();
  db.prepare(`
    INSERT OR IGNORE INTO clients (id, client_code, business_name, owner_name)
    VALUES (?, ?, ?, ?)
  `).run(systemClientId, 'CARLYVNE', 'Carlynve POS System', 'System Owner');

  db.prepare(`
    INSERT INTO users (id, client_id, username, password, full_name, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), systemClientId, 'carlyvne_admin', 'Carlyvne@2026', 'Carlynve Owner', 'system_owner');
}

async function testConnections() {
  db.prepare('SELECT 1').get();
  seedSystemOwner();
  return true;
}

module.exports = { db, testConnections };
