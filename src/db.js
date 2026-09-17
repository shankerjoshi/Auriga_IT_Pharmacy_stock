const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'pharmacy.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function initialize() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS medicines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          generic_name TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          medicine_id INTEGER NOT NULL,
          batch_code TEXT NOT NULL,
          expiry_date TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity >= 0),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS dispenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          medicine_id INTEGER NOT NULL,
          batch_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          dispensed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (medicine_id) REFERENCES medicines(id),
          FOREIGN KEY (batch_id) REFERENCES batches(id)
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_batches_expiry
        ON batches(expiry_date)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_batches_medicine
        ON batches(medicine_id)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_medicines_name
        ON medicines(name)
      `);

      db.run(`
        INSERT OR IGNORE INTO medicines (id, name, generic_name)
        VALUES (1, 'Paracetamol', 'Acetaminophen')
      `);

      db.run(`
        INSERT OR IGNORE INTO batches (id, medicine_id, batch_code, expiry_date, quantity)
        VALUES
          (1, 1, 'PAR-2025-01', '2025-12-31', 120),
          (2, 1, 'PAR-2026-02', '2026-06-30', 80),
          (3, 1, 'PAR-2026-03', '2027-01-15', 50)
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

module.exports = { db, initialize, run, get, all };
