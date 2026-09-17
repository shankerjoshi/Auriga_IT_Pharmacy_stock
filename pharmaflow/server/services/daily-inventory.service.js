const { transaction } = require('../config/database');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function runDailyInventoryJob() {
  const today = todayISO();
  const nextSevenDays = `date(?, '+7 days')`;

  return transaction(async ({ run, all }) => {
    const expired = await all(
      `SELECT id, batch_number, medicine_id, quantity, expiry_date
       FROM batches
       WHERE expiry_date < ?
         AND status <> 'QUARANTINED'
       ORDER BY expiry_date ASC, id ASC`,
      [today]
    );

    if (expired.length > 0) {
      await run(
        "UPDATE batches SET status = 'QUARANTINED', updated_at = datetime('now') WHERE expiry_date < ? AND status <> 'QUARANTINED'",
        [today]
      );
    }

    await run(
      `UPDATE batches
       SET status = 'ACTIVE', updated_at = datetime('now')
       WHERE status = 'EXPIRING_SOON'
         AND expiry_date > ${nextSevenDays}`,
      [today]
    );

    const expiringSoon = await all(
      `SELECT id, batch_number, medicine_id, quantity, expiry_date
       FROM batches
       WHERE status = 'ACTIVE'
         AND expiry_date >= ?
         AND expiry_date <= ${nextSevenDays}
       ORDER BY expiry_date ASC, id ASC`,
      [today, today]
    );

    if (expiringSoon.length > 0) {
      await run(
        `UPDATE batches
         SET status = 'EXPIRING_SOON', updated_at = datetime('now')
         WHERE status = 'ACTIVE'
           AND expiry_date >= ?
           AND expiry_date <= ${nextSevenDays}`,
        [today, today]
      );
    }

    return {
      success: true,
      today,
      expired_quarantined: expired.length,
      expiring_soon_flagged: expiringSoon.length,
      quarantined_batches: expired,
      expiring_soon_batches: expiringSoon
    };
  });
}

module.exports = { runDailyInventoryJob, todayISO };
