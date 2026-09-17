const bcrypt = require('bcryptjs');
const { run, get } = require('../config/database');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!emailPattern.test(cleanEmail)) {
    throw new Error('A valid email address is required.');
  }
  return cleanEmail;
}

async function registerUser({ name, email, password }) {
  if (!name || !String(name).trim() || !email || !password) {
    throw new Error('Name, email, and password are required.');
  }
  if (String(password).length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const cleanEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(String(password), 10);

  const result = await run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [String(name).trim(), cleanEmail, passwordHash]
  );

  return get('SELECT id, name, email, created_at FROM users WHERE id = ?', [result.id]);
}

async function loginUser({ email, password }) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const cleanEmail = normalizeEmail(email);
  const user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
  if (!user) {
    throw new Error('Invalid email or password.');
  }

  const valid = await bcrypt.compare(String(password), user.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password.');
  }

  return { id: user.id, name: user.name, email: user.email, created_at: user.created_at };
}

module.exports = { registerUser, loginUser };
