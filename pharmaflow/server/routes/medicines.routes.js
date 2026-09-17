const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getMedicines,
  getMedicineById,
  createMedicine,
  updateMedicine,
  deleteMedicine
} = require('../services/inventory.service');

const router = express.Router();

function sendError(res, error) {
  if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
  if (error.code === 'VALIDATION_ERROR') return res.status(400).json({ error: error.message });
  if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'A medicine with that name already exists.' });
  if (error.message.includes('FOREIGN KEY')) return res.status(409).json({ error: 'Medicine cannot be deleted while it has dispensing records.' });
  return res.status(500).json({ error: 'Unable to process medicine request.' });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10, sort = 'name', order = 'asc' } = req.query;
    const result = await getMedicines({ search, page, limit, sort, order });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const medicine = await getMedicineById(req.params.id);
    if (!medicine) return res.status(404).json({ error: 'Medicine not found.' });
    res.json(medicine);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const medicine = await createMedicine(req.body || {});
    res.status(201).json(medicine);
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const medicine = await updateMedicine(req.params.id, req.body || {});
    res.json(medicine);
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await deleteMedicine(req.params.id);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
