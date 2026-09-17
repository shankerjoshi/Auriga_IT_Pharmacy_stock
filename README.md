# PharmaFlow

## 1. Product overview

PharmaFlow is a small pharmacy inventory management app built to keep stock safe, visible, and easy to dispense. The shipped implementation is a full-stack Node.js + Express + SQLite application with a React frontend that focuses on batch-level visibility, FEFO dispense ordering, and expiry risk monitoring.

## 2. Problem statement

Pharmacies must manage medicines across multiple batches, each with different expiry dates and quantities. Without a consistent rule, older stock can be overlooked, expired stock can be dispensed, and staff may not know which inventory is still safe to sell. PharmaFlow addresses this by calculating sellable stock from in-date batches only and ordering dispensing by the earliest expiry date.

## 3. Key features

- User registration and session-based login/logout
- Medicine dashboard with search, sorting, and pagination
- Batch-level inventory tracking
- FEFO dispensing using the earliest valid expiry first
- Sellable-stock calculation excluding expired and quarantined batches
- Expiry alert summaries for batches within a configurable window
- Daily inventory job that quarantines expired batches and marks near-expiry stock as EXPIRING_SOON
- Messy-data batch import with normalization and duplicate detection
- SQLite persistence with audit-style dispensing records

## 4. Target users

- Community pharmacies
- Independent dispensaries
- Small clinical dispensing teams
- Pharmacists and staff needing a simple, auditable view of in-date stock

## 5. Tech stack

- Node.js
- Express
- SQLite3
- React + Vite
- express-session
- bcryptjs
- dotenv

## 6. Architecture

The app follows a simple layered design:

- Frontend: React single-page app in the client directory
- API: Express routes in the server/routes directory
- Service layer: business rules in server/services
- Persistence: SQLite through server/config/database.js and server/db/schema.sql
- Runtime bootstrap: server/server.js and server/app.js

## 7. Project structure

```text
pharmaflow/
  client/
    src/
      main.jsx
      styles.css
  server/
    app.js
    server.js
    config/
      database.js
    db/
      init.js
      schema.sql
    middleware/
      auth.js
    routes/
      alerts.routes.js
      auth.routes.js
      batches.routes.js
      clock.routes.js
      dispensing.routes.js
      import.routes.js
      medicines.routes.js
    services/
      alert.service.js
      auth.service.js
      daily-inventory.service.js
      dispensing.service.js
      import.service.js
      inventory.service.js
  test/
    alerts.test.js
    dispensing.test.js
    t2-clock.test.js
    t4-import.test.js
  data/
    pharmaflow.db
```

## 8. Database/schema overview

The database stores the following core tables:

- users: auth accounts and session-linked user metadata
- medicines: medicine catalog entries
- batches: per-batch quantity, expiry, and status lifecycle
- dispensing_records: audit trail of stock reductions per batch and user

Key schema rules:

- `batches.status` is restricted to `ACTIVE`, `EXPIRING_SOON`, or `QUARANTINED`
- `medicine_id + batch_number` is unique
- batch quantities must be non-negative
- dispensing records are linked to both medicine and batch to preserve an audit trail

## 9. Setup instructions

From the project root:

```bash
cd pharmaflow
npm install
npm run db:init
npm start
```

The API listens on port 3000 by default, and the frontend is served from the built `client/dist` bundle.

## 10. Environment variables

The shipped app uses the following environment conventions:

- `PORT` — optional override for the backend port (default: 3000)
- `SESSION_SECRET` — optional session secret override
- `NODE_ENV` — optional runtime environment flag

Example:

```bash
PORT=3000
SESSION_SECRET=your-secret
```

## 11. How to start backend/frontend

Backend:

```bash
cd pharmaflow
npm start
```

Frontend build:

```bash
cd pharmaflow
npm run build
```

Frontend dev server:

```bash
cd pharmaflow
npm run dev
```

## 12. Authentication

Authentication is session-based and protected by `requireAuth` middleware. The shipped routes are:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Session data stores only a user object with `id`, `name`, and `email`.

## 13. FEFO logic

Dispensing uses the earliest expiry date first, while excluding any batch that is expired or not sellable. In practice, the backend selects batches with:

- `expiry_date >= date('now')`
- `status IN ('ACTIVE', 'EXPIRING_SOON')`
- `quantity > 0`

Then it orders them by `expiry_date ASC, created_at ASC, id ASC` and deducts from the earliest valid batch first.

## 14. Sellable stock definition

Sellable stock is computed only from batches that are currently in date and not quarantined. The backend uses a derived calculation rather than storing a manual total:

- valid batch: `expiry_date >= today`
- valid status: `ACTIVE` or `EXPIRING_SOON`
- positive quantity only

Any expired batch or `QUARANTINED` batch is excluded from sellable stock.

## 15. T2 daily automation

The daily job is triggered by `POST /clock` and runs the inventory automation. It does the following:

- quarantines batches where `expiry_date < today`
- clears `EXPIRING_SOON` back to `ACTIVE` where the batch is now beyond the 7-day window
- flags batches with `expiry_date >= today` and `expiry_date <= today + 7 days` as `EXPIRING_SOON`
- returns a JSON report including counts and affected batches

This is intentionally idempotent for a daily run: repeated runs do not create duplicate outbox events or re-apply conflicting logic in the same state.

## 16. POST /clock documentation

Method: `POST`
Path: `/clock`
Purpose: run the daily inventory automation job
Authentication: not required in the shipped app
Parameters/body: none
Response behavior: returns `{ success, today, expired_quarantined, expiring_soon_flagged, quarantined_batches, expiring_soon_batches }`

## 17. T4 messy-data import

Batch import is handled by `POST /api/import/batches` and is designed to accept messy arrays or `{ records: [...] }` payloads. It normalizes dates and quantities, then rejects unusable rows.

## 18. Import normalization rules

The import service accepts:

- ISO dates like `2026-01-15`
- European dates like `15/01/2026`
- quantities written as integers or strings like `10 units` or `10qty`

It rejects rows that are missing:

- medicine name
- batch number
- positive quantity
- valid expiry date

It also rejects rows when the medicine does not exist in the DB.

## 19. imported/deduped/rejected response

The import response includes:

```json
{
  "imported": 3,
  "deduped": 1,
  "rejected": 2,
  "rejected_details": [],
  "deduped_details": [],
  "imported_batches": []
}
```

Meaning:

- `imported`: newly inserted valid batches
- `deduped`: rows skipped because they already existed in the same import or in the database
- `rejected`: rows with invalid or incomplete data

## 20. T1 reorder threshold

This shipped app does not implement a persisted reorder threshold or outbox notification system. There is no actual `T1` reorder route or notification store in the current codebase. The implementation therefore does not claim a reorder-threshold workflow beyond the alerting and stock visibility already present.

## 21. Notification outbox

No notification outbox table or route exists in the current implementation. The shipped project includes expiry alert logic and summary endpoints, but not a persisted outbox for reorder or other notifications.

## 22. GET /outbox documentation

Method: `GET`
Path: `/outbox`
Purpose: not implemented in the current codebase
Authentication: not applicable
Parameters/body: none
Response behavior: no route is exposed in the shipped application

## 23. Search

The medicine list supports a free-text search parameter on `GET /api/medicines`:

- `search` — optional text query matched against medicine name and generic name

## 24. Pagination

The medicine list supports:

- `page` — page number, default 1
- `limit` — records per page, default 10

The response includes `pagination` with `page`, `limit`, `total`, and `totalPages`.

## 25. Sorting

`GET /api/medicines` supports:

- `sort=name|category|next_expiry|created_at`
- `order=asc|desc`

## 26. Testing instructions

From the project root:

```bash
cd pharmaflow
npm run db:init
npm test
npm run test:t2
npm run test:t4
npm run build
```

## 27. Complete REST API endpoint table

| Method | Path | Purpose | Auth | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Health check | No | Returns ok status |
| POST | `/api/auth/register` | Register user | No | Returns session user |
| POST | `/api/auth/login` | Log in | No | Returns session user |
| GET | `/api/auth/me` | Current session user | No (returns null if unauthenticated) | Used by frontend |
| POST | `/api/auth/logout` | Log out | Yes | Destroys session |
| GET | `/api/medicines` | List medicines | Yes | Search, pagination, sorting |
| GET | `/api/medicines/:id` | Get medicine by id | Yes | Includes sellable stock and next expiry |
| POST | `/api/medicines` | Create medicine | Yes | Validates required fields |
| PUT | `/api/medicines/:id` | Update medicine | Yes | Validates required fields |
| DELETE | `/api/medicines/:id` | Delete medicine | Yes | Only allowed if not tied to foreign key data |
| GET | `/api/medicines/:id/batches` | List batches for medicine | Yes | Ordered by expiry |
| POST | `/api/medicines/:id/batches` | Create batch | Yes | Validates expiry and quantity |
| PUT | `/api/batches/:id` | Update batch | Yes | Requires valid expiry and quantity |
| DELETE | `/api/batches/:id` | Delete batch | Yes | Removes batch record |
| POST | `/api/medicines/:id/dispense` | Dispense stock | Yes | Enforces FEFO against valid in-date stock |
| GET | `/api/medicines/:id/dispensing-history` | Dispensing history | Yes | Lists records for medicine |
| GET | `/api/alerts/expiring` | Expiring batches | Yes | Can take `days` query param |
| GET | `/api/alerts/summary` | Inventory summary | Yes | Returns sellable and expired totals |
| POST | `/clock` | Daily inventory automation | No | Quarantines expired and flags expiring batches |
| POST | `/api/import/batches` | Messy-data import | Yes | Accepts arrays or `{records}` payload |

## 28. Known limitations

- The shipped app does not implement a reorder threshold or persisted outbox notification workflow.
- There is no email/SMS notification delivery layer.
- The frontend is a lightweight operational UI rather than a full ERP dashboard.
- The app intentionally keeps its scope narrow to the core pharmacy inventory problem.

## 29. Three future features

1. Reorder recommendation engine with stock thresholds and a persisted outbox
2. Multi-site pharmacy consolidation and transfer logic
3. Email/SMS expiry and stock alerts for staff

## Final note

The current repository reflects the actual implementation that was validated in the project environment. It intentionally does not claim features that are not present in the codebase, especially the T1 outbox and reorder threshold flow.
