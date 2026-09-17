const { run, get, all } = require('../config/database');

const SORT_FIELDS = ['name', 'category', 'created_at', 'next_expiry'];

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  return error;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw validationError(`${field} is required.`);
  return value.trim();
}

function requireQuantity(value, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw validationError(`Quantity must be an integer ${allowZero ? 'greater than or equal to 0' : 'greater than 0'}.`);
  }
  return value;
}

function clampPage(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampLimit(value, fallback = 10) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

function buildSort(sort = 'name', order = 'asc') {
  const allowed = ['name', 'category', 'created_at', 'next_expiry'];
  const safeSort = allowed.includes(sort) ? sort : 'name';
  const safeOrder = order === 'desc' ? 'desc' : 'asc';
  return { safeSort, safeOrder };
}

async function getMedicines({ search = '', page = 1, limit = 10, sort = 'name', order = 'asc' }) {
  const { safeSort, safeOrder } = buildSort(sort, order);
  const cleanSearch = String(search || '').trim();
  const safePage = clampPage(page);
  const safeLimit = clampLimit(limit);
  const offset = (safePage - 1) * safeLimit;

  const query = `
    SELECT
      m.id,
      m.name,
      m.generic_name,
      m.category,
      m.description,
      m.created_at,
      m.updated_at,
          COALESCE(SUM(CASE WHEN b.quantity > 0 AND b.expiry_date >= date('now') AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN b.quantity ELSE 0 END), 0) AS sellable_stock,
          MIN(CASE WHEN b.quantity > 0 AND b.expiry_date >= date('now') AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN b.expiry_date END) AS next_expiry,
      COUNT(b.id) AS batch_count
    FROM medicines m
    LEFT JOIN batches b ON b.medicine_id = m.id
    WHERE (? = '' OR m.name LIKE '%' || ? || '%' OR m.generic_name LIKE '%' || ? || '%')
    GROUP BY m.id, m.name, m.generic_name, m.category, m.description, m.created_at, m.updated_at
    ORDER BY ${safeSort === 'next_expiry' ? 'next_expiry' : 'm.' + safeSort} ${safeOrder}
    LIMIT ? OFFSET ?
  `;

  const rows = await all(query, [cleanSearch, cleanSearch, cleanSearch, safeLimit, offset]);

  const totalResult = await get(
    `SELECT COUNT(*) AS total FROM medicines WHERE (? = '' OR name LIKE '%' || ? || '%' OR generic_name LIKE '%' || ? || '%')`,
    [cleanSearch, cleanSearch, cleanSearch]
  );

  return {
    items: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: Number(totalResult?.total || 0),
      totalPages: Math.max(1, Math.ceil((Number(totalResult?.total || 0) || 1) / safeLimit))
    }
  };
}

async function getMedicineById(id) {
  return get(
    `SELECT m.*,
        COALESCE(SUM(CASE WHEN b.quantity > 0 AND b.expiry_date >= date('now') AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN b.quantity ELSE 0 END), 0) AS sellable_stock,
        MIN(CASE WHEN b.quantity > 0 AND b.expiry_date >= date('now') AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN b.expiry_date END) AS next_expiry,
      COUNT(b.id) AS batch_count
     FROM medicines m
     LEFT JOIN batches b ON b.medicine_id = m.id
     WHERE m.id = ?
     GROUP BY m.id`,
    [id]
  );
}

async function createMedicine({ name, generic_name, category, description }) {
  const cleanName = requireText(name, 'Medicine name');
  const cleanGenericName = generic_name == null || generic_name === '' ? null : requireText(generic_name, 'Generic name');
  const cleanCategory = category == null || category === '' ? null : requireText(category, 'Category');
  const cleanDescription = description == null || description === '' ? null : requireText(description, 'Description');

  const result = await run(
    'INSERT INTO medicines (name, generic_name, category, description, updated_at) VALUES (?, ?, ?, ?, datetime("now"))',
    [cleanName, cleanGenericName, cleanCategory, cleanDescription]
  );

  return getMedicineById(result.id);
}

async function updateMedicine(id, payload) {
  const existing = await getMedicineById(id);
  if (!existing) throw notFoundError('Medicine not found.');

  const next = {
    name: payload.name === undefined ? existing.name : requireText(payload.name, 'Medicine name'),
    generic_name: payload.generic_name === undefined || payload.generic_name === '' ? existing.generic_name : requireText(payload.generic_name, 'Generic name'),
    category: payload.category === undefined || payload.category === '' ? existing.category : requireText(payload.category, 'Category'),
    description: payload.description === undefined || payload.description === '' ? existing.description : requireText(payload.description, 'Description')
  };

  await run(
    'UPDATE medicines SET name = ?, generic_name = ?, category = ?, description = ?, updated_at = datetime("now") WHERE id = ?',
    [String(next.name).trim(), next.generic_name, next.category, next.description, id]
  );

  return getMedicineById(id);
}

async function deleteMedicine(id) {
  const existing = await getMedicineById(id);
  if (!existing) throw notFoundError('Medicine not found.');
  await run('DELETE FROM medicines WHERE id = ?', [id]);
  return { deleted: true, id };
}

async function getMedicineBatches(id) {
  const medicine = await getMedicineById(id);
  if (!medicine) throw notFoundError('Medicine not found.');

  return all(
    'SELECT * FROM batches WHERE medicine_id = ? ORDER BY expiry_date ASC, created_at ASC',
    [id]
  );
}

async function createBatch(medicineId, payload) {
  if (!medicineId) throw validationError('Medicine ID is required.');
  const batchNumber = requireText(payload.batch_number, 'Batch number');
  if (!isValidDate(payload.expiry_date)) throw validationError('Expiry date must be a valid YYYY-MM-DD date.');
  const quantity = requireQuantity(payload.quantity);

  const existingMedicine = await getMedicineById(medicineId);
  if (!existingMedicine) throw notFoundError('Medicine not found.');

  const result = await run(
    'INSERT INTO batches (medicine_id, batch_number, quantity, expiry_date, updated_at) VALUES (?, ?, ?, ?, datetime("now"))',
    [medicineId, batchNumber, quantity, payload.expiry_date]
  );

  return get('SELECT * FROM batches WHERE id = ?', [result.id]);
}

async function updateBatch(id, payload) {
  const existing = await get('SELECT * FROM batches WHERE id = ?', [id]);
  if (!existing) throw notFoundError('Batch not found.');

  const next = {
    batch_number: payload.batch_number === undefined ? existing.batch_number : requireText(payload.batch_number, 'Batch number'),
    quantity: payload.quantity === undefined ? existing.quantity : requireQuantity(payload.quantity, true),
    expiry_date: payload.expiry_date === undefined ? existing.expiry_date : payload.expiry_date
  };
  if (!isValidDate(next.expiry_date)) throw validationError('Expiry date must be a valid YYYY-MM-DD date.');

  await run(
    'UPDATE batches SET batch_number = ?, quantity = ?, expiry_date = ?, updated_at = datetime("now") WHERE id = ?',
    [next.batch_number, next.quantity, next.expiry_date, id]
  );

  return get('SELECT * FROM batches WHERE id = ?', [id]);
}

async function deleteBatch(id) {
  const existing = await get('SELECT * FROM batches WHERE id = ?', [id]);
  if (!existing) throw notFoundError('Batch not found.');
  await run('DELETE FROM batches WHERE id = ?', [id]);
  return { deleted: true, id };
}

module.exports = {
  getMedicines,
  getMedicineById,
  createMedicine,
  updateMedicine,
  deleteMedicine,
  getMedicineBatches,
  createBatch,
  updateBatch,
  deleteBatch
};
