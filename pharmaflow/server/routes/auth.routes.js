const express = require('express');
const { registerUser, loginUser } = require('../services/auth.service');

const router = express.Router();

function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.user = { id: user.id, name: user.name, email: user.email };
      resolve();
    });
  });
}

router.post('/register', async (req, res) => {
  try {
    const user = await registerUser(req.body || {});
    await establishSession(req, user);
    res.status(201).json({ user: req.session.user });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const user = await loginUser(req.body || {});
    await establishSession(req, user);
    res.json({ user: req.session.user });
  } catch (error) {
    const status = error.message.includes('required') || error.message.includes('valid email') ? 400 : 401;
    res.status(status).json({ error: status === 401 ? 'Invalid email or password.' : error.message });
  }
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json(null);
  }
  res.json(req.session.user);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

module.exports = router;
