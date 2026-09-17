const { all } = require('../config/database');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseDays(days) {
  const parsed = Number(days);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    const error = new Error('days must be a positive integer no greater than 3650.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return parsed;
}

async function getExpiringAlerts(days = 30) {
  const threshold = parseDays(days);
  const today = todayISO();
  const expiryWindow = `date(?, '+' || ? || ' days')`;

  const expiring = await all(
    `
      SELECT
        b.id,
        b.medicine_id,
        m.name,
        b.batch_number,
        b.quantity,
        b.expiry_date,
        CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) AS days_until_expiry,
        CASE
          WHEN julianday(b.expiry_date) - julianday(?) <= 7 THEN 'expiring_7_days'
          ELSE 'expiring_30_days'
        END AS category
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      WHERE b.quantity > 0
        AND b.expiry_date >= ?
        AND b.status IN ('ACTIVE', 'EXPIRING_SOON')
        AND b.expiry_date <= ${expiryWindow}
      ORDER BY b.expiry_date ASC
    `,
    [today, today, today, today, threshold]
  );

  const expired = await all(
    `
      SELECT
        b.id,
        b.medicine_id,
        m.name,
        b.batch_number,
        b.quantity,
        b.expiry_date,
        CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) AS days_until_expiry,
        'expired' AS category
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      WHERE b.quantity > 0
        AND b.expiry_date < ?
      ORDER BY b.expiry_date ASC
    `,
    [today, today]
  );

  const categoryRows = await all(
    `
      SELECT
        CASE
          WHEN b.status = 'QUARANTINED' OR b.expiry_date < ? THEN 'expired'
          WHEN b.expiry_date <= ${expiryWindow.replace('?', '?')} AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN
            CASE WHEN julianday(b.expiry_date) - julianday(?) <= 7 THEN 'expiring_7_days' ELSE 'expiring_30_days' END
          ELSE 'healthy'
        END AS category,
        COUNT(*) AS batch_count,
        COALESCE(SUM(b.quantity), 0) AS quantity
      FROM batches b
      WHERE b.quantity > 0
      GROUP BY category
    `,
    [today, today, threshold, today]
  );

  const summary = {
    expired: { batch_count: 0, quantity: 0 },
    expiring_7_days: { batch_count: 0, quantity: 0 },
    expiring_30_days: { batch_count: 0, quantity: 0 },
    healthy: { batch_count: 0, quantity: 0 }
  };
  for (const row of categoryRows) {
    if (summary[row.category]) {
      summary[row.category] = { batch_count: Number(row.batch_count), quantity: Number(row.quantity) };
    }
  }

  return { today, days: threshold, expiring, expired, summary };
}

async function getSummaryStatus() {
  const rows = await all(
    `
      SELECT
        m.id,
        m.name,
        COALESCE(SUM(CASE WHEN b.expiry_date >= date('now') AND b.quantity > 0 AND b.status IN ('ACTIVE', 'EXPIRING_SOON') THEN b.quantity ELSE 0 END), 0) AS sellable_stock,
        COALESCE(SUM(CASE WHEN b.quantity > 0 AND (b.expiry_date < date('now') OR b.status = 'QUARANTINED') THEN b.quantity ELSE 0 END), 0) AS expired_stock,
        COUNT(b.id) AS batch_count
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.id
      GROUP BY m.id, m.name
      ORDER BY m.name ASC
    `
  );

  return rows;
}

module.exports = { getExpiringAlerts, getSummaryStatus };
