const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server/app');
const { initializeDatabase } = require('../server/db/init');
const { run, get, all } = require('../server/config/database');
const { importBatches } = require('../server/services/import.service');
const { getMedicineById } = require('../server/services/inventory.service');
const { dispenseMedicine } = require('../server/services/dispensing.service');
const { runDailyInventoryJob } = require('../server/services/daily-inventory.service');

let admin;
let medicineId;

async function cleanup() {
  if (medicineId) {
    await run('DELETE FROM dispensing_records WHERE medicine_id = ?', [medicineId]);
    await run('DELETE FROM medicines WHERE id = ?', [medicineId]);
    medicineId = null;
  }
}

async function createMedicine() {
  const result = await run(
    'INSERT INTO medicines (name, generic_name, category) VALUES (?, ?, ?)',
    [`T4 Import ${Date.now()}-${Math.random()}`, 'T4 Generic', 'Test']
  );
  medicineId = result.id;
  const medicine = await get('SELECT name FROM medicines WHERE id = ?', [medicineId]);
  return medicine.name;
}

async function batchRows() {
  return all('SELECT batch_number, quantity, expiry_date FROM batches WHERE medicine_id = ? ORDER BY expiry_date, batch_number', [medicineId]);
}

test.before(async () => {
  await initializeDatabase();
  admin = await get('SELECT id FROM users WHERE email = ?', ['admin@pharmaflow.local']);
  assert.ok(admin);
});
test.afterEach(cleanup);

test('imports ISO and dd/mm/yyyy dates with numeric and unit quantities', async () => {
  const medicine = await createMedicine();
  const report = await importBatches([
    { medicine, batch_number: 'ISO', quantity: 20, expiry_date: '2026-11-10' },
    { medicine, batch_number: 'EU', quantity: '10 units', expiry_date: '25/09/2026' }
  ]);
  assert.equal(report.imported, 2);
  assert.equal(report.rejected, 0);
  assert.deepEqual(await batchRows(), [
    { batch_number: 'EU', quantity: 10, expiry_date: '2026-09-25' },
    { batch_number: 'ISO', quantity: 20, expiry_date: '2026-11-10' }
  ]);
});

test('rejects null, invalid, and negative quantities', async () => {
  const medicine = await createMedicine();
  const report = await importBatches([
    { medicine, batch_number: 'NULL', quantity: null, expiry_date: '2026-11-10' },
    { medicine, batch_number: 'BAD', quantity: 'ten units', expiry_date: '2026-11-10' },
    { medicine, batch_number: 'NEG', quantity: -5, expiry_date: '2026-11-10' }
  ]);
  assert.equal(report.imported, 0);
  assert.equal(report.rejected, 3);
});

test('rejects invalid dates and missing required fields', async () => {
  const medicine = await createMedicine();
  const report = await importBatches([
    { medicine, batch_number: 'BAD-DATE', quantity: 1, expiry_date: '31/02/2026' },
    { medicine, batch_number: 'AMBIGUOUS', quantity: 1, expiry_date: '09/10/26' },
    { medicine, quantity: 1, expiry_date: '2026-11-10' },
    { medicine, batch_number: 'MISSING-QTY', expiry_date: '2026-11-10' },
    { batch_number: 'MISSING-MED', quantity: 1, expiry_date: '2026-11-10' }
  ]);
  assert.equal(report.imported, 0);
  assert.equal(report.rejected, 5);
});

test('deduplicates rows within an import and against existing batches', async () => {
  const medicine = await createMedicine();
  const records = [{ medicine, batch_number: 'DUP', quantity: 10, expiry_date: '2026-11-10' }];
  const first = await importBatches(records);
  const second = await importBatches([...records, { ...records[0], quantity: 99 }]);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.deduped, 2);
  assert.deepEqual(await batchRows(), [{ batch_number: 'DUP', quantity: 10, expiry_date: '2026-11-10' }]);
});

test('imports appear in inventory and contribute to sellable stock', async () => {
  const medicine = await createMedicine();
  await importBatches([{ medicine, batch_number: 'STOCK', quantity: '10 units', expiry_date: '2026-11-10' }]);
  const detail = await getMedicineById(medicineId);
  assert.equal(Number(detail.sellable_stock), 10);
});

test('expired imported batches cannot be dispensed and can be quarantined', async () => {
  const medicine = await createMedicine();
  await importBatches([{ medicine, batch_number: 'EXPIRED', quantity: 10, expiry_date: '2026-09-16' }]);
  await assert.rejects(dispenseMedicine({ medicineId, userId: admin.id, quantity: 1 }), /Insufficient sellable stock/);
  const report = await runDailyInventoryJob();
  const batch = await get('SELECT status, quantity FROM batches WHERE medicine_id = ?', [medicineId]);
  assert.equal(batch.status, 'QUARANTINED');
  assert.equal(batch.quantity, 10);
  assert.equal(report.expired_quarantined >= 1, true);
});

test('imported batches participate in FEFO dispensing', async () => {
  const medicine = await createMedicine();
  await importBatches([
    { medicine, batch_number: 'LATE', quantity: 10, expiry_date: '2026-11-10' },
    { medicine, batch_number: 'EARLY', quantity: 4, expiry_date: '2026-10-01' }
  ]);
  const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 6 });
  assert.deepEqual(result.batches_used.map((batch) => [batch.batch_number, batch.deducted]), [['EARLY', 4], ['LATE', 2]]);
});

test('POST /api/import/batches returns a real import report', async () => {
  const medicine = await createMedicine();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    let cookie = '';
    async function request(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, body: await response.json() };
    }
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@pharmaflow.local', password: 'admin123' }) });
    assert.equal(login.status, 200);
    const response = await request('/api/import/batches', { method: 'POST', body: JSON.stringify({ records: [{ medicine, batch_number: 'HTTP', quantity: '10 units', expiry_date: '2026-11-10' }] }) });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.imported, 1);
    assert.deepEqual(response.body.deduped, 0);
    assert.deepEqual(response.body.rejected, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
