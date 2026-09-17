# PharmaFlow

PharmaFlow is a full-stack pharmacy inventory system built around FEFO dispensing rules and audited stock movement tracking.

## Project purpose

- User registration and login
- Medicine records with search, pagination and sorting
- Batch tracking by medicine and expiry date
- FEFO dispensing: oldest valid batch is used first
- Expiry alerts and safe stock calculations
- Database persistence with SQLite

## Files and structure

- server/app.js: Express app setup
- server/config/database.js: SQLite connection
- server/db/schema.sql: database schema
- server/db/seed.js: seed data initialization
- server/middleware/auth.js: authentication guard
- server/routes/*.js: REST endpoints
- server/services/*.js: business logic
- client/index.html: simple landing page and dashboard UI

## Setup

```bash
cd pharmaflow
npm install
cp .env.example .env
npm start
```

## Database design

The application uses four core tables:

- users
- medicines
- batches
- dispensing_records

Key constraints:

- users.email is unique
- batches has a unique pair (medicine_id, batch_number)
- dispensing_records stores an audit trail for each dispense event

## API endpoints

### Authentication

- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- POST /api/auth/logout

### Medicines

- GET /api/medicines
- GET /api/medicines/:id
- POST /api/medicines
- PUT /api/medicines/:id
- DELETE /api/medicines/:id

### Batches

- GET /api/medicines/:id/batches
- POST /api/medicines/:id/batches
- PUT /api/batches/:id
- DELETE /api/batches/:id

### Dispensing

- POST /api/medicines/:id/dispense
- GET /api/medicines/:id/dispensing-history

### Alerts

- GET /api/alerts/expiring?days=30
- GET /api/alerts/summary

## FEFO rules

The backend enforces the critical logic:

1. get medicine and valid batches
2. filter to expiry_date > today and quantity > 0
3. sort by expiry_date ASC
4. check available stock
5. deduct stock across matching batches
6. write dispensing_records for audit
7. never dispense expired stock

## Example dispense flow

If Paracetamol has:

- B001: 20 units, 2026-09-20
- B002: 50 units, 2026-11-10
- B003: 30 units, 2027-01-15

and a request asks for 35 units, the server will use:

- B001 -> 20
- B002 -> 15

and never touch expired stock.

## Notes

This app is structured for backend-first development, with a simple frontend shell added after the core business logic was implemented.
