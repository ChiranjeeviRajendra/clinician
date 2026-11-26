# Clinician

A Vue interface backed by a Flask JSON API, PostgreSQL authentication, and a
separate AI orchestration layer for medical reference retrieval.

## Backend

See [backend setup and API contracts](backend/README.md) for database configuration
and migrations. From the repository root:

```powershell
cd backend
python -m venv .venv # Skip if already created.
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

For a new setup, copy `backend/.env.example` to `backend/.env`. Preserve an existing
`.env` and add the new settings instead. Configure `DATABASE_URL` and, for chat,
`PINECONE_API_KEY` and `OPENAI_API_KEY`, then run from `backend`:

```powershell
python scripts/create_database.py
python -m flask --app app db upgrade
python app.py
```

Flask serves only JSON APIs at **http://localhost:8080**.

## Frontend

In a second terminal, from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** for sign in, account registration, email verification,
password recovery, and chat. Vue sends API requests through Vite's `/api` proxy.
Local verification emails are saved under `backend/instance/mail/` by default.
See [frontend documentation](frontend/README.md) for session behavior and deployment.

## Checks

```powershell
# From backend (database-free tests):
python -m ruff check .
python -m ruff format --check .
python -m pytest -q
# From frontend:
npm run check
```

The default backend test run includes unit tests and mocked AI tests. Unit tests
block PostgreSQL connections. Database integration tests are separate and must be
run manually as described in [backend tests](backend/README.md#tests).

## Code conventions

- Vue pages describe the interface; composables own form and request state.
  Services own HTTP contracts, stores own shared session/notification state, and
  utilities contain pure transformations. Use PascalCase for Vue components and
  `useX` names for composables.
- Python feature packages group routes, services, and validation. Routes handle
  HTTP, services handle application operations, and models describe persistence.
  Shared API errors and request validation live directly under `src/api`.
  Use `snake_case` for Python modules and functions.
- Keep public API URLs, payload fields, stable choice IDs, and storage keys
  compatible when reorganizing internal code. Keep AI provider construction lazy.
- Format JavaScript, Vue, and CSS with Prettier; check JavaScript and Vue with
  ESLint/Oxlint. Format and lint Python with Ruff. The repository configurations
  define the rules; checks do not rewrite files.
- Database setup, migrations, and ingestion are manual operations. Startup,
  builds, and routine checks do not apply them. Existing migrations and research
  notebooks are excluded from bulk Python formatting.
