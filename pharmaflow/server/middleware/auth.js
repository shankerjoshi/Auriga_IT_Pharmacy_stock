const { get } = require('../config/database');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

async function getCurrentUser(req, res, next) {
  if (!req.session || !req.session.user) {
    return next();
  }

  try {
    const user = await get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.session.user.id]);
    req.user = user || null;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Unable to load user.' });
  }
}

module.exports = { requireAuth, getCurrentUser };
