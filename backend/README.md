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

Also set `JWT_SECRET_KEY` to a private random value of at least 32 bytes before
starting Flask or using its CLI (see the JWT configuration below).

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

## Aurora Express / AWS IAM authentication

Install the updated requirements, then configure `backend/.env` with a URL that
contains the database username but no password or manually generated token:

```dotenv
DATABASE_AUTH_MODE=iam
DATABASE_URL="postgresql+psycopg://postgres@YOUR_RDS_ENDPOINT:5432/clinician?sslmode=verify-full"
AWS_REGION=ap-southeast-2
# Optional: a configured local AWS profile (including SSO profiles).
# AWS_PROFILE=clinician
```

The SDK uses its standard AWS credential chain: environment credentials, a local
AWS profile, or an IAM role attached to your deployed service. An AWS console
browser login alone does not supply credentials to Python. For an IAM Identity
Center profile, configure it with `aws configure sso --profile clinician`, sign in
with `aws sso login --profile clinician`, and set `AWS_PROFILE=clinician` in `.env`.
Temporary environment credentials require `AWS_SESSION_TOKEN` as well as the
access key and secret key. Keep credentials out of application source control.

The IAM identity must have `rds-db:connect` permission for this cluster and database
user. Its policy resource has the form
`arn:aws:rds-db:ap-southeast-2:ACCOUNT_ID:dbuser:CLUSTER_RESOURCE_ID/postgres`.
Use the cluster **resource ID** (starting with `cluster-`), not its display name.
Aurora Express sets up `rds_iam` membership for the admin user automatically;
do not revoke that role on an Express cluster.

Each new physical SQLAlchemy connection obtains a fresh IAM token through
`generate_db_auth_token`. Tokens are passed directly to psycopg as the connection
password and are never saved in `.env`, the SQLAlchemy URL, or application logs.
Existing pooled connections remain usable after their authentication token's
15-minute validity period. `pool_pre_ping` handles stale pooled connections; a
replacement connection gets a new token. AWS refreshable credential providers
also refresh their credentials through the SDK.

IAM connections enforce `sslmode=verify-full`. Aurora Express internet gateways
use public AWS root certificates, supplied by `certifi`. For a standard RDS
endpoint using an RDS certificate authority, download the official RDS CA bundle
and set `DATABASE_SSL_ROOT_CERT=certs/global-bundle.pem`; relative paths resolve
from `backend`. An explicit `sslrootcert` in the URL is also supported.

The same IAM connection hook applies to `python -m flask --app app db upgrade`
and `python scripts/create_database.py`. Once AWS credentials are available,
create `clinician` if necessary, apply migrations, and start `python app.py`.
Database credential-provider failures return the normal generic database `503`,
not an application-session `401`. For local PostgreSQL, keep
`DATABASE_AUTH_MODE=password` (the default).

References: [Aurora Express](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html),
[Boto3 IAM database connections](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.Connecting.Python.html),
[SQLAlchemy connection token hook](https://docs.sqlalchemy.org/en/20/core/engines.html#generating-dynamic-authentication-tokens).

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
| `users` | UUID, unique normalized email, password hash, verification time, timestamps |
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
| `GET /authenticate` | None; requires Bearer JWT | `200`: `status: "valid"`, `expires_at`; `401`: `status: "invalid"` or `"expired"` with the normal error object |
| `GET /appInfo` | None; requires Bearer token | `200`: `name`, `service`, `status`, authenticated `user`, and JWT `expires_at`; fetched once per page load after authentication |
| `POST /auth/register` | `{"email":"doctor@example.com","password":"long-secure-password"}` | `201`: user and verification message |
| `POST /auth/login` | `{"email":"doctor@example.com","password":"long-secure-password"}` | `200`: user, signed JWT in `session_token`, `token_type`, `expires_at` |
| `POST /auth/logout` | None; requires Bearer token | `204`: valid JWT acknowledged; client discards the token |
| `GET /auth/me` | None; requires Bearer token | `200`: `{"user":{...}}` |
| `POST /auth/verify-email` | `{"token":"TOKEN_FROM_EMAIL"}` | `200`: email verified |
| `POST /auth/forgot-password` | `{"email":"doctor@example.com"}` | `202`: same message whether an account exists |
| `POST /auth/reset-password` | `{"token":"TOKEN_FROM_EMAIL","password":"new-secure-password"}` | `200`: password updated; existing JWTs remain valid until expiry |
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

Login requires a verified email. New passwords must have 8–128 characters and are
hashed with Werkzeug scrypt. Emails are normalized to lowercase. Duplicate
registration returns `409`; invalid credentials/session return `401`; unverified
login returns `403`; invalid, expired, consumed, or wrong-purpose email tokens
return `400`. Excessive requests return `429`.

Registration and password reset return `400 weak_password` with
"Password is too weak. Use at least 8 characters." for passwords below the
minimum length. Email-bearing auth endpoints return `400 invalid_email` with
"Enter a valid email address." for missing, malformed, or oversized addresses.
Email validation checks syntax without DNS or mailbox-existence lookups;
verification emails establish ownership. Forms display the server's error
message. Login verifies existing credentials without applying new-password rules.

Use the signed access JWT from login for authenticated requests:

```http
Authorization: Bearer SIGNED_JWT
```

Authentication is stateless: login issues an HS256-signed JWT, and protected APIs
validate the signature, fixed algorithm, issuer, audience, token purpose, subject,
and required time claims. No login sessions or access tokens are stored in the
database. `GET /authenticate` performs no database queries. `/appInfo` and `/auth/me`
still read account data from `users`; login checks the stored password hash.
Every protected API validates its own JWT independently of frontend route checks.

JWTs expire in 12 hours by default (`SESSION_TTL_SECONDS=43200`); reducing this
setting also limits tokens already issued. Expired tokens return `401` with
`session_expired`; malformed tokens, bad signatures, and old opaque session tokens
return `401 unauthorized`. `/authenticate` additionally returns `status: "expired"`
or `status: "invalid"`; a valid token returns `200` with `status: "valid"` and
`expires_at`. These responses and app/account responses use `Cache-Control: no-store`.

Set `JWT_SECRET_KEY` in `backend/.env` to a private, persistent random secret of
at least 32 bytes. Generate a value manually with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Use the same secret and `JWT_ISSUER` / `JWT_AUDIENCE` settings on all backend workers.
Never put the secret in frontend configuration or commit it. Startup fails if the
secret is missing or too short. Changing the secret invalidates all existing JWTs.
JWT payloads are signed, not encrypted, and contain no password or account profile.

Logout clears the browser's JWT locally, including when offline. The compatibility
`POST /auth/logout` endpoint validates the JWT and returns `204`, without revocation.
Copied JWTs remain valid until expiry after logout, password reset, or account
changes. There is no per-token revocation or automatic refresh in this architecture.
Shorter token lifetimes reduce that window. A fresh login is required after expiry.

Email verification and password-reset links keep their separate `auth_tokens`
records so they can expire and be consumed exactly once. Only SHA-256 hashes of
those random email tokens are persisted. Verification links expire in 24 hours,
reset links in 30 minutes. New reset requests invalidate previous reset links;
row locks protect consumption and password updates from races. Use HTTPS outside
localhost and keep Bearer credentials out of URLs. The frontend keeps its JWT and
cached user in the current tab's `sessionStorage` and clears both on logout/expiry.

### Manually migrate existing installations to JWT authentication

Migration `0003_stateless_jwt` is prepared, not automatically applied. It drops
`auth_sessions` and its stored sessions. Existing opaque tokens will no longer
work; users must sign in again. No database change runs at application startup.
From `backend`, after installing the updated requirements and configuring the
signing secret, run this yourself when ready:

```powershell
python -m flask --app app db upgrade
```

To inspect the change without connecting to or updating a database:

```powershell
python -m flask --app app db upgrade 0002_remove_user_name:0003_stateless_jwt --sql
```

Downgrading recreates an empty session table; deleted sessions cannot be restored.

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

For agents and routine verification under `AGENTS.md`, run only the database-free
unit and mocked AI suites:

```powershell
python -m pytest tests/unit tests/ai -q
```

The PostgreSQL integration suite below changes database objects and data; it must
be run manually by the user. It has been updated for JWTs but is not part of the
agent's allowed checks.


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
email-token hash storage, JWT expiry/signatures, token purpose/reuse, mail rollback, and
concurrent use of a reset token. Chat and AI regression tests preserve the route
contract, retrieval configuration, prompt wiring, document processing, and lazy
provider initialization. AI provider calls are mocked and do not make network
requests. Without `TEST_DATABASE_URL`, the PostgreSQL API tests skip; the AI tests
still run.
