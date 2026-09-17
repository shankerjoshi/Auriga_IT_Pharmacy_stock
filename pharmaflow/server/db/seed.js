const bcrypt = require('bcryptjs');
const { db, run, get } = require('../config/database');

async function seed() {
  const schemaSql = require('fs').readFileSync(require('path').join(__dirname, 'schema.sql'), 'utf8');

  await new Promise((resolve, reject) => {
    db.exec(schemaSql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const admin = await get('SELECT id FROM users WHERE email = ?', ['admin@pharmaflow.local']);
  if (!admin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      ['Admin Pharmacist', 'admin@pharmaflow.local', passwordHash]
    );
  }

  const paracetamol = await get('SELECT id FROM medicines WHERE name = ?', ['Paracetamol']);
  if (!paracetamol) {
    const med = await run(
      'INSERT INTO medicines (name, generic_name, category, description) VALUES (?, ?, ?, ?)',
      ['Paracetamol', 'Acetaminophen', 'Analgesic', 'Pain relief and fever control']
    );

    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'B-OLD-01', 20, '2025-01-01']);
    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'B-NEW-01', 20, '2026-09-20']);
    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'B-NEW-02', 50, '2026-11-10']);
    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'B-NEW-03', 30, '2027-01-15']);
  }

  const ibuprofen = await get('SELECT id FROM medicines WHERE name = ?', ['Ibuprofen']);
  if (!ibuprofen) {
    const med = await run(
      'INSERT INTO medicines (name, generic_name, category, description) VALUES (?, ?, ?, ?)',
      ['Ibuprofen', 'Ibuprofen', 'Anti-inflammatory', 'Pain and inflammation relief']
    );

    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'I-001', 15, '2026-10-05']);
    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'I-002', 40, '2026-12-01']);
  }

  const amoxicillin = await get('SELECT id FROM medicines WHERE name = ?', ['Amoxicillin']);
  if (!amoxicillin) {
    const med = await run(
      'INSERT INTO medicines (name, generic_name, category, description) VALUES (?, ?, ?, ?)',
      ['Amoxicillin', 'Amoxicillin', 'Antibiotic', 'Broad-spectrum antibiotic']
    );

    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'A-001', 10, '2026-08-25']);
    await run('INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)', [med.id, 'A-002', 25, '2027-02-15']);
  }
}

module.exports = { seed };
