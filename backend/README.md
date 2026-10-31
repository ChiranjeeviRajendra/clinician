# Backend

JSON-only Flask API using PostgreSQL 18, SQLAlchemy, psycopg 3, and Alembic migrations.
Authentication starts without Pinecone/OpenAI credentials; the existing chatbot
loads its AI dependencies when first used.

## Local setup (PowerShell)

From the repository root:

```powershell
cd backend
python -m venv .venv # Skip if the environment already exists.
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env # Only for a new setup; preserve an existing .env.
```

Add the new settings from `.env.example` to an existing `.env`. Set
`DATABASE_URL` to a local PostgreSQL role and a dedicated application database:

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/clinician
```

URL-encode special characters in credentials. With PostgreSQL already running,
create the database (requires a role with `CREATEDB`), apply migrations, and start:

```powershell
python scripts/create_database.py
python -m flask --app app db upgrade
python app.py
```

The API runs at `http://localhost:8080`; `/` returns JSON service information.
The Vue UI runs separately at `http://localhost:5173` (see `../frontend/README.md`).
Flask does not serve HTML templates or static UI files.
A database administrator can alternatively
create the database and grant the application role ownership. The application
does not require `CREATEDB` after setup. Tables are created by migrations, never
implicitly at startup. On later schema changes use `flask --app app db migrate`
and review the generated migration before running `db upgrade`.

If you prefer Docker and do not already have PostgreSQL on port 5432:

```powershell
docker compose up -d postgres
python -m flask --app app db upgrade
```

Compose uses the development credentials in `.env.example` and a persistent
volume. Do not start it on the same port as the native PostgreSQL service.

## Structure and schema

```text
backend/
|-- app.py                  Flask entry point
|-- src/                    Common parent for the two application layers
|   |-- api/                HTTP API and application services
|   |   |-- __init__.py      Flask application factory and error handlers
|   |   |-- config.py       Environment configuration
|   |   |-- extensions.py   Database, migrations, rate limiter
|   |   |-- auth/           Auth routes, service, validation, errors
|   |   |-- chat/           Chat HTTP routes; calls src.ai.rag
|   |   |-- models/         PostgreSQL models
|   |   `-- services/       Email delivery
|   `-- ai/                 AI orchestration; independent of Flask
|       |-- embeddings.py   Embedding model construction
|       |-- prompts.py      Medical prompt templates
|       |-- rag.py          Cached retrieval and answer generation pipeline
|       `-- ingestion.py    PDF loading, chunking, Pinecone indexing
|-- migrations/versions/    Versioned schema changes
|-- scripts/                Database setup and scaffolding utilities
|-- tests/
|   |-- api/                Auth, migrations, and chat HTTP regression tests
|   `-- ai/                 AI orchestration tests with mocked providers
|-- data/                   Source PDFs
|-- research/               Exploratory notebooks
`-- instance/               Ignored local runtime data and development emails
```

The API layer owns HTTP handling and application services. The AI layer owns
provider integration and document processing; it does not import the API layer.
AI dependencies and models load only when retrieval or ingestion is invoked.
Python module names use `snake_case`; feature packages group related routes,
validation, and service logic. Migrations and runtime data stay outside `src`.

Run ingestion from `backend` with `python -m src.ai.ingestion`. The existing
`python store_index.py` command remains available as a compatibility entry point.
Both populate the `clinician` index from `backend/data` using the same embedding,
chunking, and Pinecone settings. `scripts/scaffold.py` creates missing files using
the current structure; the existing `python template.py` command delegates to it.

| Table | Data |
| --- | --- |
| `users` | UUID, unique normalized email, optional name, password hash, verification time, timestamps |
| `auth_sessions` | UUID, user foreign key, unique hashed session token, expiry and revocation timestamps |
| `auth_tokens` | UUID, user foreign key, unique hashed token, purpose, expiry and consumption timestamps |
| `alembic_version` | Applied migration revision |

Foreign keys cascade when a user is deleted. Indexed token hashes support lookups;
expiry and foreign-key columns are indexed. All timestamps use PostgreSQL
`TIMESTAMP WITH TIME ZONE` and application UTC. Database constraints enforce
unique lowercase emails and valid token purposes.

## API contract

All POST request bodies use `Content-Type: application/json`. Responses are JSON,
except the empty `204` logout response. Errors have the shape
`{"error":{"code":"invalid_input","message":"..."}}`.

| Endpoint | JSON body | Success |
| --- | --- | --- |
| `POST /auth/register` | `{"email":"doctor@example.com","password":"long-secure-password","name":"Doctor"}` (`name` optional) | `201`: user and verification message |
| `POST /auth/login` | `{"email":"doctor@example.com","password":"long-secure-password"}` | `200`: user, `session_token`, `token_type`, `expires_at` |
| `POST /auth/logout` | None; requires Bearer token | `204`: session revoked |
| `GET /auth/me` | None; requires Bearer token | `200`: `{"user":{...}}` |
| `POST /auth/verify-email` | `{"token":"TOKEN_FROM_EMAIL"}` | `200`: email verified |
| `POST /auth/forgot-password` | `{"email":"doctor@example.com"}` | `202`: same message whether an account exists |
| `POST /auth/reset-password` | `{"token":"TOKEN_FROM_EMAIL","password":"new-secure-password"}` | `200`: password updated; all sessions revoked |
| `POST /chat` | `{"message":"What is hypertension?"}`; requires Bearer token | `200`: `{"answer":"..."}` |

Chat messages must contain 1–8000 characters after trimming. Chat uses the same
medical prompt, embeddings, retriever, and model settings as before. AI provider
failures return a generic JSON `503` error. Chat requests are limited to 20 per
minute per client IP. The previous `/get` endpoint remains available for migration:
it requires a Bearer token, accepts `msg` as a GET query parameter, POST form field,
or JSON field, and now returns `{"answer":"..."}`.

During development, Vue sends requests to `/api/*`; Vite proxies these to Flask
and removes `/api` (`/api/auth/login` becomes `/auth/login`). No browser CORS
configuration is needed with this proxy. For production, serve the Vue build
and reverse-proxy `/api/*` to Flask with the same prefix removal. Vite's development
proxy does not run in the production build or preview server.

Login requires a verified email. Passwords must have 12–128 characters and are
hashed with Werkzeug scrypt. Emails are normalized to lowercase. Duplicate
registration returns `409`; invalid credentials/session return `401`; unverified
login returns `403`; invalid, expired, consumed, or wrong-purpose email tokens
return `400`. Excessive requests return `429`.

Use the opaque session token from login for authenticated requests:

```http
Authorization: Bearer SESSION_TOKEN
```

Sessions are stored server-side and expire in 12 hours by default
(`SESSION_TTL_SECONDS=43200`). Authentication also checks session age, so previously
issued sessions cannot exceed the currently configured lifetime. Verification
tokens expire in 24 hours; reset tokens in 30 minutes. Email tokens are single-use.
A new reset request invalidates previous reset tokens. Tokens are cryptographically
random and only SHA-256 hashes are persisted. Password resets and token consumption
use PostgreSQL row locks to prevent token replay and races with login. Tokens and
password hashes are never included in user responses. Use HTTPS outside localhost
and keep Bearer credentials out of URLs. The Vue client stores its session in
the current tab's `sessionStorage` and removes it on logout or expiration.

## Development email

`MAIL_BACKEND=file` saves emails to the Git-ignored `instance/mail/*.eml` directory.
Read the email and copy the value after `#token=` into `/auth/verify-email` or
`/auth/reset-password`, or open the email link while Vue is running. Email links
target `FRONTEND_URL`; Vue implements `/verify-email`, `/forgot-password`, and
`/reset-password` screens. Tokens are in URL fragments to avoid HTTP access
logs/referrers, and the UI removes the fragment after reading the token.

For real email delivery, use `MAIL_BACKEND=smtp` and set `MAIL_FROM`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_STARTTLS=true` for a
STARTTLS-capable provider (usually port 587). Delivery is synchronous. Registration
rolls back on delivery failures. Reset-mail failures are logged while returning
the same generic `202` response to avoid disclosing account existence.

The requested API set has no verification resend endpoint. A future resend flow
is needed to recover from a lost or expired verification email.

Rate limits use in-memory storage locally. Configure a shared supported
`RATELIMIT_STORAGE_URI` and install its client dependency before deployment with
multiple workers. Trust proxy headers only after configuring the actual proxy.

## Tests

Create a separate local test database, owned by your development role, then set:

```dotenv
TEST_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@localhost:5432/clinician_test
```

```powershell
python -m pytest -q
```

Tests run the real migrations in a randomly named, isolated schema and remove
only that schema afterward. The role needs schema creation permission in the
test database. Tests cover the full lifecycle, validation, email uniqueness,
hash storage, expiration, token purpose/reuse, revocation, mail rollback, and
concurrent use of a reset token. Chat and AI regression tests preserve the route
contract, retrieval configuration, prompt wiring, document processing, and lazy
provider initialization. AI provider calls are mocked and do not make network
requests. Without `TEST_DATABASE_URL`, the PostgreSQL API tests skip; the AI tests
still run.
