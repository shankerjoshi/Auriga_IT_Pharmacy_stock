const { transaction } = require('../config/database');

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function normalizeQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+)\s*(?:units?|qty)?$/i);
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const date = new Date(`${input}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input ? input : null;
  }
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const normalized = `${year}-${month}-${day}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}

function getRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.records)) return payload.records;
  throw validationError('Request body must be an array or an object containing a records array.');
}

async function importBatches(payload) {
  const records = getRecords(payload);
  const report = { imported: 0, deduped: 0, rejected: 0, rejected_details: [], deduped_details: [], imported_batches: [] };
  const seen = new Set();

  return transaction(async ({ run, get }) => {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] || {};
      const medicineName = typeof record.medicine === 'string' ? record.medicine.trim() : '';
      const batchNumber = typeof record.batch_number === 'string' ? record.batch_number.trim() : '';
      const quantity = normalizeQuantity(record.quantity);
      const expiryDate = normalizeDate(record.expiry_date);
      const row = index + 1;

      if (!medicineName || !batchNumber || !quantity || !expiryDate) {
        report.rejected += 1;
        report.rejected_details.push({ row, reason: 'Required medicine, batch_number, positive quantity, and valid expiry_date are required.' });
        continue;
      }

      const medicine = await get(
        'SELECT id, name FROM medicines WHERE LOWER(name) = LOWER(?) LIMIT 1',
        [medicineName]
      );
      if (!medicine) {
        report.rejected += 1;
        report.rejected_details.push({ row, reason: `Medicine not found: ${medicineName}.` });
        continue;
      }

      const key = `${medicine.id}:${batchNumber}`.toLowerCase();
      if (seen.has(key)) {
        report.deduped += 1;
        report.deduped_details.push({ row, reason: 'Duplicate batch row in import.', batch_number: batchNumber });
        continue;
      }
      seen.add(key);

      const existing = await get(
        'SELECT id FROM batches WHERE medicine_id = ? AND batch_number = ?',
        [medicine.id, batchNumber]
      );
      if (existing) {
        report.deduped += 1;
        report.deduped_details.push({ row, reason: 'Batch already exists for this medicine.', batch_number: batchNumber });
        continue;
      }

      const result = await run(
        'INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date) VALUES (?, ?, ?, ?)',
        [medicine.id, batchNumber, quantity, expiryDate]
      );
      report.imported += 1;
      report.imported_batches.push({ id: result.id, medicine: medicine.name, batch_number: batchNumber, quantity, expiry_date: expiryDate });
    }

    return report;
  });
}

module.exports = { importBatches, normalizeQuantity, normalizeDate };
