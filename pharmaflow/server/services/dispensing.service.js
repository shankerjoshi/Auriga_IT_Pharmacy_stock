const { run, get, all, transaction } = require('../config/database');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function getMedicineWithAvailableBatches(medicineId) {
  const medicine = await get('SELECT * FROM medicines WHERE id = ?', [medicineId]);
  if (!medicine) throw new Error('Medicine not found.');

  const batches = await all(
    `SELECT *
     FROM batches
     WHERE medicine_id = ?
      AND expiry_date >= ?
      AND status IN ('ACTIVE', 'EXPIRING_SOON')
       AND quantity > 0
     ORDER BY expiry_date ASC, created_at ASC`,
    [medicineId, todayISO()]
  );

  return { medicine, batches };
}

async function dispenseMedicine({ medicineId, userId, quantity }) {
  if (!medicineId || !userId || !Number.isInteger(quantity) || quantity <= 0) {
    const error = new Error('Valid medicine ID, user ID and positive integer quantity are required.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  return transaction(async ({ run: transactionRun, get: transactionGet, all: transactionAll }) => {
    const medicine = await transactionGet('SELECT * FROM medicines WHERE id = ?', [medicineId]);
    if (!medicine) {
      const error = new Error('Medicine not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const batches = await transactionAll(
      `SELECT *
       FROM batches
       WHERE medicine_id = ?
         AND quantity > 0
         AND expiry_date >= date('now')
         AND status IN ('ACTIVE', 'EXPIRING_SOON')
       ORDER BY expiry_date ASC, created_at ASC, id ASC`,
      [medicineId]
    );
    const totalAvailable = batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);

    if (totalAvailable < quantity) {
      const error = new Error('Insufficient sellable stock available for this dispense request.');
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }

    let remaining = quantity;
    const batchesUsed = [];

    for (const batch of batches) {
      if (remaining === 0) break;
      const deducted = Math.min(Number(batch.quantity), remaining);
      const update = await transactionRun(
        'UPDATE batches SET quantity = quantity - ?, updated_at = datetime("now") WHERE id = ? AND quantity >= ?',
        [deducted, batch.id, deducted]
      );
      if (update.changes !== 1) {
        throw new Error('Inventory changed before it could be dispensed.');
      }

      await transactionRun(
        'INSERT INTO dispensing_records (medicine_id, batch_id, quantity, user_id) VALUES (?, ?, ?, ?)',
        [medicineId, batch.id, deducted, userId]
      );

      batchesUsed.push({
        batch_id: batch.id,
        batch_number: batch.batch_number,
        deducted,
        expiry_date: batch.expiry_date
      });
      remaining -= deducted;
    }

    return {
      medicine,
      requested_quantity: quantity,
      dispensed_quantity: quantity,
      remaining,
      batches_used: batchesUsed
    };
  });
}

async function getDispensingHistory(medicineId) {
  return all(
    `SELECT dr.*, b.batch_number, b.expiry_date, u.name AS user_name
     FROM dispensing_records dr
     JOIN batches b ON b.id = dr.batch_id
     JOIN users u ON u.id = dr.user_id
     WHERE dr.medicine_id = ?
     ORDER BY dr.dispensed_at DESC`,
    [medicineId]
  );
}

module.exports = { dispenseMedicine, getMedicineWithAvailableBatches, getDispensingHistory };
