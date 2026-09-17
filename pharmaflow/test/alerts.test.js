const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../server/config/database');
const { getExpiringAlerts } = require('../server/services/alert.service');

const today = new Date().toISOString().slice(0, 10);

function dateOffset(days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createBatch({ quantity, expiryDate }) {
  const medicine = await run(
    'INSERT INTO medicines (name, generic_name, category) VALUES (?, ?, ?)',
    [`Alert Test ${Date.now()}-${Math.random()}`, 'Alert Generic', 'Test']
  );
  const batch = await run(
    'INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)',
    [medicine.id, `ALERT-${Date.now()}-${Math.random()}`, quantity, expiryDate]
  );
  return { medicineId: medicine.id, batchId: batch.id };
}

async function cleanup(medicineId) {
  await run('DELETE FROM medicines WHERE id = ?', [medicineId]);
}

async function findBatch(collection, batchId) {
  return collection.find((batch) => batch.id === batchId);
}

test('returns already expired stock separately', async () => {
  const fixture = await createBatch({ quantity: 5, expiryDate: dateOffset(-1) });
  try {
    const alerts = await getExpiringAlerts(30);
    assert.equal(await findBatch(alerts.expiring, fixture.batchId), undefined);
    assert.equal((await findBatch(alerts.expired, fixture.batchId)).category, 'expired');
  } finally {
    await cleanup(fixture.medicineId);
  }
});

test('treats a batch expiring today as in-date and not expired', async () => {
  const fixture = await createBatch({ quantity: 5, expiryDate: today });
  try {
    const alerts = await getExpiringAlerts(30);
    assert.equal((await findBatch(alerts.expiring, fixture.batchId)).days_until_expiry, 0);
    assert.equal(await findBatch(alerts.expired, fixture.batchId), undefined);
  } finally {
    await cleanup(fixture.medicineId);
  }
});

test('returns a batch expiring within seven days with the seven-day category', async () => {
  const fixture = await createBatch({ quantity: 5, expiryDate: dateOffset(3) });
  try {
    const alerts = await getExpiringAlerts(30);
    const batch = await findBatch(alerts.expiring, fixture.batchId);
    assert.equal(batch.category, 'expiring_7_days');
    assert.equal(batch.days_until_expiry, 3);
  } finally {
    await cleanup(fixture.medicineId);
  }
});

test('returns a batch expiring within thirty days with the thirty-day category', async () => {
  const fixture = await createBatch({ quantity: 5, expiryDate: dateOffset(20) });
  try {
    const alerts = await getExpiringAlerts(30);
    const batch = await findBatch(alerts.expiring, fixture.batchId);
    assert.equal(batch.category, 'expiring_30_days');
    assert.equal(batch.days_until_expiry, 20);
  } finally {
    await cleanup(fixture.medicineId);
  }
});

test('excludes a batch beyond the requested alert window and counts it as healthy', async () => {
  const fixture = await createBatch({ quantity: 5, expiryDate: dateOffset(45) });
  try {
    const alerts = await getExpiringAlerts(30);
    assert.equal(await findBatch(alerts.expiring, fixture.batchId), undefined);
    assert.ok(alerts.summary.healthy.batch_count >= 1);
  } finally {
    await cleanup(fixture.medicineId);
  }
});

test('excludes zero-quantity batches from every alert collection', async () => {
  const fixture = await createBatch({ quantity: 0, expiryDate: dateOffset(3) });
  try {
    const alerts = await getExpiringAlerts(30);
    assert.equal(await findBatch(alerts.expiring, fixture.batchId), undefined);
    assert.equal(await findBatch(alerts.expired, fixture.batchId), undefined);
  } finally {
    await cleanup(fixture.medicineId);
  }
});
