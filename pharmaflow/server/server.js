require('dotenv').config();
const app = require('./app');
const { initializeDatabase, db } = require('./db/init');

const port = Number(process.env.PORT || 3000);

initializeDatabase()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`PharmaFlow running on http://0.0.0.0:${port}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    db.close(() => process.exit(1));
  });
