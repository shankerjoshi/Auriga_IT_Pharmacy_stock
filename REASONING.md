# PharmaFlow reasoning and implementation notes

## 1. Problem interpretation

The business problem is an inventory control problem, not just a CRUD problem. The critical domain rule is that a medicine is only safe to dispense if it is still in date and has not been quarantined. Because stock is managed by batch, the implementation has to reason over each batch's expiry date and quantity, not just a total quantity field.

## 2. Why FEFO was selected

FEFO is the correct model for a pharmacy because it reflects the real operational requirement: older stock must be consumed before newer stock when both are valid. This prevents medications from lingering beyond their safe use period and reduces risk from stale inventory. The backend enforces the rule at dispense time by selecting only eligible batches and ordering them by earliest expiry first.

## 3. Why expired stock is excluded

The backend explicitly excludes any batch with `expiry_date < today` from sellable stock. This is not a UI preference; it is structural domain logic. Expired batches are not sellable, not dispensable, and must not contribute to the available quantity used for dispensing decisions.

## 4. Sellable stock calculation

Sellable stock is derived as a query-time calculation, not manually maintained. The inventory service sums only the quantity of batches where:

- `expiry_date >= date('now')`
- `quantity > 0`
- `status IN ('ACTIVE', 'EXPIRING_SOON')`

This makes the output consistent with the live database state and avoids stale totals drifting away from actual batch status.

## 5. Database design decisions

SQLite was chosen because the project is a compact pharmacy appraisal app with durable local state and no need for a large distributed system. The schema is intentionally simple but captures the real constraints:

- users for authentication
- medicines for catalog and grouping
- batches for stock quantity and expiry state
- dispensing_records for audit and traceability

The unique constraint `(medicine_id, batch_number)` prevents duplicate batch records for the same medicine, while the foreign keys retain an auditable record of stock deductions.

## 6. Authentication design

Authentication is session-based and uses bcrypt for password hashing. The server keeps a minimal session object with `id`, `name`, and `email` so that the frontend can render a user-aware navigation bar without exposing sensitive information beyond the current account identity.

## 7. Backend/service architecture

The application follows a route/service split:

- routes validate HTTP concerns and map request errors to response codes
- services hold the actual domain logic
- database access is centralized in a thin adapter

This keeps the logic easier to test and prevents business rules from being embedded directly into request handlers.

## 8. FEFO transaction/atomicity approach

The dispense flow wraps all relevant inventory deductions in a single transactional step. It performs the following in one transaction:

1. confirm the medicine exists
2. fetch eligible batches in expiry order
3. ensure the total available quantity satisfies the request
4. deduct from each batch in sequence
5. insert a dispensing record for each batch used

This ensures the inventory change and the audit records happen atomically. If something fails, the transaction is not committed.

## 9. T2 automation design

The daily inventory job runs via `POST /clock`. It is intended as a scheduled operational check rather than a user action. The automation flips expired stock to `QUARANTINED`, resets batches that are no longer in the 7-day window, and flags in-range batches as `EXPIRING_SOON`.

## 10. Why POST /clock is idempotent

The automation checks current state before updating. It only changes batches with the relevant conditions:

- expired and not already quarantined
- `EXPIRING_SOON` batches outside the 7-day window
- `ACTIVE` batches within the 7-day window

Repeated execution continues to produce the same state because the update criteria are tied to current expiry and status values, not to a growing event log.

## 11. T4 messy-data normalization

The import service accepts arrays or `{ records: [...] }` payloads and normalizes values before validation. It accepts either ISO or `dd/mm/yyyy` date strings and normalizes quantities like `10 units` or `10qty` into integer counts. It rejects missing or invalid values before they reach the database.

## 12. Duplicate handling

The importer deduplicates both within the same payload and against existing database rows. This is critical for operational data quality: repeated rows or rows already stored should not create duplicate batch records. The response contains a `deduped` count and details to surface the skipped items to the client.

## 13. Rejected-record handling

Rejected records are those with missing required fields, invalid dates, invalid quantities, or unrecognized medicine names. They are not inserted and are returned in `rejected_details` so the user can understand what failed and fix it without guessing.

## 14. T1 reorder threshold logic

The shipped app does not include a reorder threshold flow or outbox integration. There is no persisted reorder rule in the current codebase, and no actual `/outbox` endpoint. The project’s implemented operational logic is therefore focused on stock visibility, expiry alerts, and daily automation rather than threshold-triggered reorder tasks.

## 15. Outbox integration

No outbox table or notification pipeline exists in this shipped implementation. The project intentionally does not claim any persistable outbox behavior because the existing code does not contain it.

## 16. Search/pagination/sorting

The medicine listing route provides free-text search, pagination, and sorting. The query is built to match by medicine name and generic name and to order by name, category, created_at, or next_expiry. This keeps the dashboard usable even when the catalogue grows.

## 17. Testing strategy

The project uses Node’s built-in test runner. The implementation validates the core rules directly in the service layer rather than through mocks. The tests cover:

- dispensing across multiple batches
- expiry exclusion rules
- daily clock logic
- import normalization and duplicate handling

This keeps the tests aligned with real backend behavior.

## 18. Bugs/issues encountered during development

The project encountered several practical issues during the assessment flow, including:

- duplicated app roots and confusion over which implementation was canonical
- stale startup listeners and port conflicts
- DB initialization racing app startup
- schema mismatch around the `status` column when running the app against an older database
- UI wording that mis-described the actual expiry rule

## 19. How those issues were diagnosed and fixed

These were diagnosed by checking the actual runtime state, the database schema, and the server startup path. The fix strategy was deliberately conservative: keep the existing service logic intact, correct startup order, migrate schema safely, and align the frontend copy with the actual backend rules.

## 20. Trade-offs made because of the 2.5-hour constraint

The project intentionally focused on the essential inventory engine, auth flow, and operational UI. It avoided broader ERP features such as reorder outbox workflows, SMS/email integrations, and multi-warehouse logic because those would expand scope beyond the shipped, proven implementation.

## 21. Remaining limitations

- no persisted reorder/outbox flow
- no email or SMS alert delivery
- no multi-site or transfer history
- small-scope operational UI rather than a larger enterprise system

## 22. Potential future improvements

1. Add reorder thresholds and a queue/outbox notification layer
2. Add inventory adjustment and transfer workflows
3. Add richer alert delivery and reporting for pharmacy managers
