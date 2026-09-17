# Reasoning and implementation notes

The backend was built first because the pharmacy requirement is not just CRUD. The critical business rule is FEFO dispensing with expiry enforcement.

The reasoning path was:

1. Model the domain as medicines, batches, users and dispensing_records.
2. Make the database enforce uniqueness and auditability.
3. Build services that apply the FEFO logic server-side, not in the frontend.
4. Add authentication and protected routes.
5. Expose the operations through REST endpoints.
6. Then add a light UI shell to exercise the API in a usable way.

The FEFO algorithm is enforced in the dispensing service:

- the medicine is looked up
- only batches where expiry_date > today and quantity > 0 are included
- batches are ordered by expiry_date ASC
- the requested quantity is consumed across batches from oldest to newest
- dispensing_records are created for each deduction
- a request fails if the medicine does not have enough valid stock

This is important because a frontend check alone is not enough. The server must independently enforce the rules to prevent direct API bypasses.

The project was implemented in this order to reduce risk:

- schema and persistence
- auth service
- inventory service
- dispensing service
- alerts service
- routes
- app wiring
- simple client UI

This keeps the core business logic isolated and easier to validate.
