# Project Instructions

## Database changes are performed manually by the user

These rules apply throughout this repository, to both local and remote databases.

- Never automatically execute database migrations or modify database schema or data.
- Do not run migration upgrades, downgrades, schema creation, database creation, seed scripts, or INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP, or other database-changing commands.
- Do not add automatic database updates to application startup, builds, or deployment workflows.
- You may prepare or edit models, migration files, SQL scripts, and application code.
- When database changes are needed, explain their purpose and provide the exact commands for the user to execute manually.
- Clearly distinguish between a migration being prepared and being applied. Never report a database change as applied unless the user performed it and its state was verified.
- Read-only database queries, schema inspection, and migration-status checks are allowed.
- Offline SQL generation and tests using mocked database operations are allowed.
- Do not run tests or fixtures that create, modify, or delete database objects or data.
- A request to implement or fix a feature does not authorize executing database changes.
- Keep this policy in effect unless the user explicitly changes it.
