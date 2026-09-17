const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMedicineBatches, createBatch, updateBatch, deleteBatch } = require('../services/inventory.service');

const router = express.Router();

function sendError(res, error) {
  if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
  if (error.code === 'VALIDATION_ERROR') return res.status(400).json({ error: error.message });
  if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'That batch number already exists for this medicine.' });
  if (error.message.includes('FOREIGN KEY')) return res.status(409).json({ error: 'The related medicine does not exist.' });
  return res.status(500).json({ error: 'Unable to process batch request.' });
}

router.get('/medicines/:id/batches', requireAuth, async (req, res) => {
  try {
    const batches = await getMedicineBatches(req.params.id);
    res.json(batches);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/medicines/:id/batches', requireAuth, async (req, res) => {
  try {
    const batch = await createBatch(req.params.id, req.body || {});
    res.status(201).json(batch);
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/batches/:id', requireAuth, async (req, res) => {
  try {
    const batch = await updateBatch(req.params.id, req.body || {});
    res.json(batch);
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/batches/:id', requireAuth, async (req, res) => {
  try {
    const result = await deleteBatch(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
