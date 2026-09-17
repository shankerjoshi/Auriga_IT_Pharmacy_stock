const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initialize, run, get, all } = require('./src/db');

const app = express();
const port = process.env.PORT || 3000;
const todayIso = new Date().toISOString().slice(0, 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'pharmacy-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
};

function clampPage(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeSort(sortValue, fallback) {
  const allowed = ['name', 'stock', 'next_expiry', 'created_at'];
  return allowed.includes(sortValue) ? sortValue : fallback;
}

function sanitizeOrder(orderValue, fallback) {
  return orderValue === 'desc' ? 'desc' : fallback;
}

async function getMedicineList({ search, sortField, sortDir, offset, limit }) {
  const likeTerm = `%${String(search || '').trim()}%`;
  const sortColumnMap = {
    name: 'm.name',
    stock: 'in_date_stock',
    next_expiry: 'next_expiry',
    created_at: 'm.created_at'
  };

  const orderBy = sortColumnMap[sortField] || 'm.name';
  const countResult = await get(
    `SELECT COUNT(*) AS total FROM medicines WHERE name LIKE ? OR generic_name LIKE ?`,
    [likeTerm, likeTerm]
  );

  const rows = await all(
    `
      SELECT
        m.id,
        m.name,
        m.generic_name,
        m.created_at,
        COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity ELSE 0 END), 0) AS in_date_stock,
        COALESCE(SUM(CASE WHEN b.expiry_date < ? THEN b.quantity ELSE 0 END), 0) AS expired_stock,
        MIN(CASE WHEN b.expiry_date >= ? THEN b.expiry_date END) AS next_expiry
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.id
      WHERE m.name LIKE ? OR m.generic_name LIKE ?
      GROUP BY m.id, m.name, m.generic_name, m.created_at
      ORDER BY ${orderBy} ${sortDir}
      LIMIT ? OFFSET ?
    `,
    [todayIso, todayIso, todayIso, likeTerm, likeTerm, limit, offset]
  );

  return {
    total: Number(countResult.total || 0),
    data: rows.map((row) => ({
      ...row,
      in_date_stock: Number(row.in_date_stock || 0),
      expired_stock: Number(row.expired_stock || 0)
    }))
  };
}

async function findMedicineByName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  return get(
    `SELECT * FROM medicines WHERE LOWER(name) = LOWER(?) OR LOWER(generic_name) = LOWER(?) LIMIT 1`,
    [normalized, normalized]
  );
}

async function createMedicineIfNeeded(name, genericName) {
  const medicine = await findMedicineByName(name);
  if (medicine) return medicine;

  const result = await run(
    `INSERT INTO medicines (name, generic_name) VALUES (?, ?)`,
    [String(name).trim(), (genericName || '').trim() || null]
  );

  return get('SELECT * FROM medicines WHERE id = ?', [result.id]);
}

async function getBatchesForMedicine(medicineId) {
  return all(
    `SELECT * FROM batches WHERE medicine_id = ? ORDER BY expiry_date ASC, created_at ASC`,
    [medicineId]
  );
}

async function dispenseOldestFirst(medicineId, qty) {
  const parsedQty = Number(qty);
  if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
    throw new Error('Dispense quantity must be a positive integer.');
  }

  const availableBatches = await all(
    `
      SELECT *
      FROM batches
      WHERE medicine_id = ? AND expiry_date >= ? AND quantity > 0
      ORDER BY expiry_date ASC, created_at ASC
    `,
    [medicineId, todayIso]
  );

  const totalInDate = availableBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  if (totalInDate < parsedQty) {
    throw new Error('Not enough sellable stock in date to dispense that amount.');
  }

  let remaining = parsedQty;
  for (const batch of availableBatches) {
    if (remaining <= 0) break;
    const toTake = Math.min(batch.quantity, remaining);
    await run(`UPDATE batches SET quantity = quantity - ? WHERE id = ? AND quantity >= ?`, [toTake, batch.id, toTake]);
    await run(`INSERT INTO dispenses (medicine_id, batch_id, quantity) VALUES (?, ?, ?)`, [medicineId, batch.id, toTake]);
    remaining -= toTake;
  }

  return { dispensed: parsedQty, remaining };
}

async function getExpiringAlerts(daysThreshold = 30) {
  return all(
    `
      SELECT
        b.id,
        b.batch_code,
        b.expiry_date,
        b.quantity,
        m.name,
        (julianday(b.expiry_date) - julianday(?)) AS days_until_expiry
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      WHERE b.expiry_date >= ?
        AND b.expiry_date <= date(?, '+' || ? || ' days')
        AND b.quantity > 0
      ORDER BY b.expiry_date ASC
    `,
    [todayIso, todayIso, todayIso, daysThreshold]
  );
}

initialize().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

app.get('/api/health', (_, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  try {
    const result = await run(
      `INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)`,
      [String(name).trim(), cleanEmail, await bcrypt.hash(password, 10)]
    );
    req.session.user = { id: result.id, name: String(name).trim(), email: cleanEmail };
    res.status(201).json({ message: 'User registered successfully.', user: req.session.user });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    res.status(500).json({ error: 'Unable to create user.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(String(password), user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.user = { id: user.id, name: user.name, email: user.email };
  return res.json({ message: 'Login successful.', user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

app.get('/api/medicines', requireAuth, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const page = clampPage(req.query.page, 1);
  const limit = clampPage(req.query.limit, 10);
  const sortField = sanitizeSort(String(req.query.sort || 'name'), 'name');
  const sortDir = sanitizeOrder(String(req.query.order || 'asc'), 'asc');

  try {
    const result = await getMedicineList({
      search,
      sortField,
      sortDir,
      offset: (page - 1) * limit,
      limit
    });

    const totalPages = Math.max(1, Math.ceil(result.total / limit || 1));
    res.json({
      data: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      sort: { field: sortField, order: sortDir }
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch medicines.', details: error.message });
  }
});

app.get('/api/medicines/:id/batches', requireAuth, async (req, res) => {
  try {
    const batches = await getBatchesForMedicine(req.params.id);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load batches.', details: error.message });
  }
});

app.post('/api/medicines/:id/batches', requireAuth, async (req, res) => {
  const { batch_code, expiry_date, quantity } = req.body || {};
  const medicineId = Number(req.params.id);

  if (!batch_code || !expiry_date || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'Batch code, expiry date and a positive quantity are required.' });
  }

  try {
    const result = await run(
      `INSERT INTO batches (medicine_id, batch_code, expiry_date, quantity) VALUES (?, ?, ?, ?)`,
      [medicineId, String(batch_code).trim(), expiry_date, Number(quantity)]
    );
    const created = await get('SELECT * FROM batches WHERE id = ?', [result.id]);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Unable to create batch.', details: error.message });
  }
});

app.post('/api/medicines/:id/dispense', requireAuth, async (req, res) => {
  const medicineId = Number(req.params.id);
  try {
    const result = await dispenseOldestFirst(medicineId, Number(req.body?.quantity));
    res.json({ message: 'Dispense recorded.', result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/medicines/lookup', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Medicine name is required.' });
  }

  try {
    const medicine = await createMedicineIfNeeded(name, req.body?.generic_name || '');
    res.status(201).json(medicine);
  } catch (error) {
    res.status(500).json({ error: 'Unable to create medicine.', details: error.message });
  }
});

app.get('/api/stock/summary', requireAuth, async (_, res) => {
  try {
    const rows = await all(
      `
        SELECT
          m.id,
          m.name,
          m.generic_name,
          COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity ELSE 0 END), 0) AS in_date_stock,
          COALESCE(SUM(CASE WHEN b.expiry_date < ? THEN b.quantity ELSE 0 END), 0) AS expired_stock,
          MIN(CASE WHEN b.expiry_date >= ? THEN b.expiry_date END) AS next_expiry
        FROM medicines m
        LEFT JOIN batches b ON b.medicine_id = m.id
        GROUP BY m.id, m.name, m.generic_name
        ORDER BY m.name ASC
      `,
      [todayIso, todayIso, todayIso]
    );
    res.json(rows.map((row) => ({ ...row, in_date_stock: Number(row.in_date_stock || 0), expired_stock: Number(row.expired_stock || 0) })));
  } catch (error) {
    res.status(500).json({ error: 'Unable to load stock summary.', details: error.message });
  }
});

app.get('/api/alerts/expiring', requireAuth, async (req, res) => {
  const threshold = Number(req.query.days || 30);
  try {
    const rows = await getExpiringAlerts(Number.isFinite(threshold) ? threshold : 30);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch expiry alerts.', details: error.message });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Pharmacy FEFO app listening on http://localhost:${port}`);
});
