const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getExpiringAlerts, getSummaryStatus } = require('../services/alert.service');

const router = express.Router();

function sendAlertError(res, error) {
  if (error.code === 'VALIDATION_ERROR') return res.status(400).json({ error: error.message });
  return res.status(500).json({ error: 'Unable to load expiry alerts.' });
}

router.get('/expiring', requireAuth, async (req, res) => {
  try {
    const alerts = await getExpiringAlerts(req.query.days || 30);
    res.json(alerts);
  } catch (error) {
    sendAlertError(res, error);
  }
});

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const data = await getSummaryStatus();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
