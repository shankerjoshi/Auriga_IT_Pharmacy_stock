const test = require('node:test');
const assert = require('node:assert/strict');
const { run, get, all } = require('../server/config/database');
const { dispenseMedicine } = require('../server/services/dispensing.service');

const today = new Date().toISOString().slice(0, 10);
const adminEmail = 'admin@pharmaflow.local';
let admin;

function dateOffset(days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createScenario(batchDefinitions) {
  const medicineResult = await run(
    'INSERT INTO medicines (name, generic_name, category) VALUES (?, ?, ?)',
    [`Dispense Test ${Date.now()}-${Math.random()}`, 'Test Generic', 'Test']
  );

  for (const batch of batchDefinitions) {
    await run(
      'INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)',
      [medicineResult.id, batch.batch_number, batch.quantity, batch.expiry_date]
    );
  }

  return medicineResult.id;
}

async function cleanup(medicineId) {
  await run('DELETE FROM dispensing_records WHERE medicine_id = ?', [medicineId]);
  await run('DELETE FROM medicines WHERE id = ?', [medicineId]);
}

async function batchState(medicineId) {
  return all('SELECT batch_number, quantity FROM batches WHERE medicine_id = ? ORDER BY expiry_date ASC', [medicineId]);
}

async function recordCount(medicineId) {
  const row = await get('SELECT COUNT(*) AS count FROM dispensing_records WHERE medicine_id = ?', [medicineId]);
  return Number(row.count);
}

test.before(async () => {
  admin = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);
  assert.ok(admin, 'seed admin user must exist');
});

test('dispenses from a single eligible batch', async () => {
  const medicineId = await createScenario([{ batch_number: 'SINGLE', quantity: 20, expiry_date: dateOffset(10) }]);
  try {
    const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 5 });
    assert.equal(result.dispensed_quantity, 5);
    assert.deepEqual(result.batches_used.map((batch) => [batch.batch_number, batch.deducted]), [['SINGLE', 5]]);
    assert.deepEqual(await batchState(medicineId), [{ batch_number: 'SINGLE', quantity: 15 }]);
    assert.equal(await recordCount(medicineId), 1);
  } finally {
    await cleanup(medicineId);
  }
});

test('continues across multiple batches in FEFO order', async () => {
  const medicineId = await createScenario([
    { batch_number: 'A', quantity: 20, expiry_date: dateOffset(10) },
    { batch_number: 'B', quantity: 50, expiry_date: dateOffset(20) },
    { batch_number: 'C', quantity: 30, expiry_date: dateOffset(40) }
  ]);
  try {
    const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 35 });
    assert.deepEqual(result.batches_used.map((batch) => [batch.batch_number, batch.deducted]), [['A', 20], ['B', 15]]);
    assert.deepEqual(await batchState(medicineId), [
      { batch_number: 'A', quantity: 0 },
      { batch_number: 'B', quantity: 35 },
      { batch_number: 'C', quantity: 30 }
    ]);
  } finally {
    await cleanup(medicineId);
  }
});

test('skips expired batches and dispenses from same-day batches first', async () => {
  const medicineId = await createScenario([
    { batch_number: 'EXPIRED', quantity: 100, expiry_date: dateOffset(-1) },
    { batch_number: 'TODAY', quantity: 100, expiry_date: today },
    { batch_number: 'VALID', quantity: 10, expiry_date: dateOffset(5) }
  ]);
  try {
    const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 6 });
    assert.deepEqual(result.batches_used.map((batch) => batch.batch_number), ['TODAY']);
    assert.deepEqual(await batchState(medicineId), [
      { batch_number: 'EXPIRED', quantity: 100 },
      { batch_number: 'TODAY', quantity: 94 },
      { batch_number: 'VALID', quantity: 10 }
    ]);
  } finally {
    await cleanup(medicineId);
  }
});

test('rejects insufficient sellable stock without changing inventory', async () => {
  const medicineId = await createScenario([
    { batch_number: 'EXPIRED', quantity: 100, expiry_date: dateOffset(-1) },
    { batch_number: 'VALID', quantity: 4, expiry_date: dateOffset(5) }
  ]);
  try {
    await assert.rejects(
      dispenseMedicine({ medicineId, userId: admin.id, quantity: 5 }),
      /Insufficient sellable stock/
    );
    assert.deepEqual(await batchState(medicineId), [
      { batch_number: 'EXPIRED', quantity: 100 },
      { batch_number: 'VALID', quantity: 4 }
    ]);
    assert.equal(await recordCount(medicineId), 0);
  } finally {
    await cleanup(medicineId);
  }
});

test('depletes an exact requested quantity to zero', async () => {
  const medicineId = await createScenario([{ batch_number: 'EXACT', quantity: 7, expiry_date: dateOffset(5) }]);
  try {
    const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 7 });
    assert.equal(result.remaining, 0);
    assert.deepEqual(await batchState(medicineId), [{ batch_number: 'EXACT', quantity: 0 }]);
    assert.equal(await recordCount(medicineId), 1);
  } finally {
    await cleanup(medicineId);
  }
});

test('rejects zero, negative, fractional, and string quantities', async () => {
  const medicineId = await createScenario([{ batch_number: 'VALID', quantity: 10, expiry_date: dateOffset(5) }]);
  try {
    for (const quantity of [0, -1, 1.5, '2']) {
      await assert.rejects(
        dispenseMedicine({ medicineId, userId: admin.id, quantity }),
        /positive integer quantity/
      );
    }
    assert.deepEqual(await batchState(medicineId), [{ batch_number: 'VALID', quantity: 10 }]);
  } finally {
    await cleanup(medicineId);
  }
});

test('rolls back batch deductions when recording fails', async () => {
  const medicineId = await createScenario([{ batch_number: 'ROLLBACK', quantity: 10, expiry_date: dateOffset(5) }]);
  try {
    await assert.rejects(
      dispenseMedicine({ medicineId, userId: 999999999, quantity: 5 }),
      /FOREIGN KEY/
    );
    assert.deepEqual(await batchState(medicineId), [{ batch_number: 'ROLLBACK', quantity: 10 }]);
    assert.equal(await recordCount(medicineId), 0);
  } finally {
    await cleanup(medicineId);
  }
});

test('uses the earliest expiry before later eligible batches', async () => {
  const medicineId = await createScenario([
    { batch_number: 'LATE', quantity: 10, expiry_date: dateOffset(30) },
    { batch_number: 'EARLY', quantity: 10, expiry_date: dateOffset(2) }
  ]);
  try {
    const result = await dispenseMedicine({ medicineId, userId: admin.id, quantity: 3 });
    assert.equal(result.batches_used[0].batch_number, 'EARLY');
    assert.deepEqual(await batchState(medicineId), [
      { batch_number: 'EARLY', quantity: 7 },
      { batch_number: 'LATE', quantity: 10 }
    ]);
  } finally {
    await cleanup(medicineId);
  }
});
