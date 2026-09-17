const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth.routes');
const medicinesRoutes = require('./routes/medicines.routes');
const batchesRoutes = require('./routes/batches.routes');
const dispensingRoutes = require('./routes/dispensing.routes');
const alertsRoutes = require('./routes/alerts.routes');
const clockRoutes = require('./routes/clock.routes');
const importRoutes = require('./routes/import.routes');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'pharmaflow-dev-secret',
    name: 'pharmaflow.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.get('/api/health', (_, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/clock', clockRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicinesRoutes);
app.use('/api', batchesRoutes);
app.use('/api', dispensingRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/import', importRoutes);

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.get('*', (req, res) => {
  const distIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  res.sendFile(distIndex, (err) => {
    if (err) {
      res.status(404).json({ error: 'Frontend build not found. Run npm run build.' });
    }
  });
});

module.exports = app;
