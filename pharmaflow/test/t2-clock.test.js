const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server/app');
const { initializeDatabase } = require('../server/db/init');
const { run, get } = require('../server/config/database');
const { runDailyInventoryJob } = require('../server/services/daily-inventory.service');
const { getMedicineById } = require('../server/services/inventory.service');
const { dispenseMedicine } = require('../server/services/dispensing.service');

const today = new Date().toISOString().slice(0, 10);

function dateOffset(days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createScenario(batches) {
  const medicine = await run(
    'INSERT INTO medicines (name, generic_name, category) VALUES (?, ?, ?)',
    [`Clock Test ${Date.now()}-${Math.random()}`, 'Clock Generic', 'Test']
  );
  for (const batch of batches) {
    await run(
      'INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date, status) VALUES (?, ?, ?, ?, ?)',
      [medicine.id, batch.batch_number, batch.quantity, batch.expiry_date, batch.status || 'ACTIVE']
    );
  }
  return medicine.id;
}

async function cleanup(medicineId) {
  await run('DELETE FROM dispensing_records WHERE medicine_id = ?', [medicineId]);
  await run('DELETE FROM medicines WHERE id = ?', [medicineId]);
}

test.before(async () => {
  await initializeDatabase();
});

test('quarantines expired batches and is idempotent', async () => {
  const medicineId = await createScenario([{ batch_number: 'EXPIRED', quantity: 12, expiry_date: dateOffset(-1) }]);
  try {
    const first = await runDailyInventoryJob();
    const batch = await get('SELECT status, quantity FROM batches WHERE medicine_id = ?', [medicineId]);
    const second = await runDailyInventoryJob();
    assert.equal(batch.status, 'QUARANTINED');
    assert.equal(batch.quantity, 12);
    assert.ok(first.expired_quarantined >= 1);
    assert.equal(second.expired_quarantined, 0);
  } finally {
    await cleanup(medicineId);
  }
});

test('keeps today active and sellable', async () => {
  const medicineId = await createScenario([{ batch_number: 'TODAY', quantity: 8, expiry_date: today }]);
  try {
    await runDailyInventoryJob();
    const batch = await get('SELECT status FROM batches WHERE medicine_id = ?', [medicineId]);
    const medicine = await getMedicineById(medicineId);
    assert.equal(batch.status, 'EXPIRING_SOON');
    assert.equal(Number(medicine.sellable_stock), 8);
  } finally {
    await cleanup(medicineId);
  }
});

test('flags seven-day batches and leaves later batches active', async () => {
  const medicineId = await createScenario([
    { batch_number: 'SOON', quantity: 5, expiry_date: dateOffset(7) },
    { batch_number: 'LATER', quantity: 6, expiry_date: dateOffset(8) }
  ]);
  try {
    const report = await runDailyInventoryJob();
    const rows = await require('../server/config/database').all('SELECT batch_number, status FROM batches WHERE medicine_id = ? ORDER BY batch_number', [medicineId]);
    assert.equal(rows.find((row) => row.batch_number === 'SOON').status, 'EXPIRING_SOON');
    assert.equal(rows.find((row) => row.batch_number === 'LATER').status, 'ACTIVE');
    assert.ok(report.expiring_soon_flagged >= 1);
  } finally {
    await cleanup(medicineId);
  }
});

test('quarantined stock is excluded from sellable stock and dispensing', async () => {
  const medicineId = await createScenario([{ batch_number: 'QUARANTINED', quantity: 20, expiry_date: dateOffset(20), status: 'QUARANTINED' }]);
  try {
    const medicine = await getMedicineById(medicineId);
    assert.equal(Number(medicine.sellable_stock), 0);
    await assert.rejects(
      dispenseMedicine({ medicineId, userId: 1, quantity: 1 }),
      /Insufficient sellable stock/
    );
  } finally {
    await cleanup(medicineId);
  }
});

test('POST /clock returns a successful report with counts', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/clock`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.expired_quarantined, 'number');
    assert.equal(typeof body.expiring_soon_flagged, 'number');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
