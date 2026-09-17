const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { importBatches } = require('../services/import.service');

const router = express.Router();

router.post('/batches', requireAuth, async (req, res) => {
  try {
    const report = await importBatches(req.body);
    res.status(200).json(report);
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Unable to import batch records.' });
  }
});

module.exports = router;
