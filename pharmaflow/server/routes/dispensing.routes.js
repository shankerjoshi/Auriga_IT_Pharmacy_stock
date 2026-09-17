const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { dispenseMedicine, getDispensingHistory } = require('../services/dispensing.service');

const router = express.Router();

function sendDispenseError(res, error) {
  if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
  if (error.code === 'VALIDATION_ERROR' || error.code === 'INSUFFICIENT_STOCK') {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: 'Unable to dispense medicine.' });
}

router.post('/medicines/:id/dispense', requireAuth, async (req, res) => {
  try {
    const result = await dispenseMedicine({
      medicineId: req.params.id,
      userId: req.session.user.id,
      quantity: req.body?.quantity
    });
    res.json(result);
  } catch (error) {
    sendDispenseError(res, error);
  }
});

router.get('/medicines/:id/dispensing-history', requireAuth, async (req, res) => {
  try {
    const history = await getDispensingHistory(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
