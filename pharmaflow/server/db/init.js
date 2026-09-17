const fs = require('fs');
const path = require('path');
const { db, run, get } = require('../config/database');
const { seed } = require('./seed');

async function initializeDatabase() {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  await new Promise((resolve, reject) => {
    db.exec(schemaSql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const batchColumns = await new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(batches)', (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
  if (!batchColumns.some((column) => column.name === 'status')) {
    await run("ALTER TABLE batches ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'EXPIRING_SOON', 'QUARANTINED'))");
  }
  await run('CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status, expiry_date)');

  await seed();
  console.log('Database initialized successfully.');
}

module.exports = { initializeDatabase, db, run, get };

if (require.main === module) {
  initializeDatabase()
    .then(() => db.close())
    .catch((error) => {
      console.error('Database initialization failed:', error);
      db.close(() => process.exit(1));
    });
}
