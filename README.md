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
# From backend, with TEST_DATABASE_URL configured:
python -m pytest -q
# From frontend:
npm test
npm run build
```
