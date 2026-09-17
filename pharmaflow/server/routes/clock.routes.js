const express = require('express');
const { runDailyInventoryJob } = require('../services/daily-inventory.service');

const router = express.Router();

router.post('/', async (_req, res) => {
  try {
    res.json(await runDailyInventoryJob());
  } catch (error) {
    res.status(500).json({ success: false, error: 'Daily inventory job failed.' });
  }
});

module.exports = router;
