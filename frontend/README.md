# Clinician UI

Vue 3, Vue Router, and Pinia. Flask runs separately as a JSON API.

## Run locally

Use two terminals from the repository root. Configure the PostgreSQL database
first using [the backend instructions](../backend/README.md).

Terminal 1:

```powershell
cd backend
.venv\Scripts\Activate.ps1
python app.py
```

Terminal 2:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Flask listens on **http://localhost:8080**.
Vite requires port 5173 so it matches the backend's default email-link URL.
`/api/*` requests are proxied to Flask with the `/api` prefix removed.

## Screens and authentication

- `/login`: sign in or switch to the create-account form. These call
  `POST /auth/login` and `POST /auth/register` respectively.
  Forms validate required fields and email format before sending requests.
  Registration and password reset require a matching confirm-password field
  and passwords of 8–128 characters. Confirmation is checked only in the UI
  and is not sent to the backend or stored. Field errors appear on blur or submit
  and update while the user corrects them.
  The server also validates new passwords and email syntax. API failures with
  `weak_password` or `invalid_email` display the server's message in the form.
- `/home`: default landing page when no previous page is saved, with links to Chat with AI,
  Profile, and Faxes. The Clinician logo returns to this page.
- `/profile` and `/faxes`: empty authenticated pages reserved for future work.
- `/verify-email#token=...`: confirm the verification link sent after registration.
  Accounts must verify their email before login.
- `/forgot-password` and `/reset-password#token=...`: request and complete a reset.
- `/chat`: authenticated medical chat; calls `POST /chat` with JSON.
- Sign out discards the JWT locally, including when offline.

In local file-mail mode, verification/reset emails are in
`backend/instance/mail/*.eml`. Open the complete link while Vite is running.
SMTP can be configured in `backend/.env` for real email delivery.

The signed JWT and cached user are kept in Pinia and the current tab's
`sessionStorage`. Before every route navigation (including query/fragment changes),
`GET /authenticate` validates the saved token before app metadata or page requests.
No authentication or app-info request is made without a token in tab storage.
Known local expiry clears the token immediately. A successful initial authentication
is followed by `GET /appInfo`, once per page lifetime. App metadata is cached in
memory across routes and logout/login; refreshing the browser loads it again.
Failed or canceled bootstrap calls can be retried and are never cached as success.

The loading overlay covers only the routed content; the navbar stays clickable.
Selecting another navbar item aborts the pending authentication/bootstrap check and
page requests, then authenticates the latest selection. Clicking the selected or
pending item does nothing. Late canceled responses are ignored. Account actions
run independently of navigation cancellation. The current page stays mounted
while later navigation is checked, and new pages wait for authentication.

Invalid tokens redirect to login with "You do not have access to the app. Please
login to continue." Expired tokens show "Your login session expired. Please login
to continue." The backend uses `401 unauthorized` and `401 session_expired`, with
`status: "invalid"` / `"expired"` on `/authenticate`. Valid tokens return
`status: "valid"` and their expiry. Network or service failures show a retry screen
and preserve credentials. Public account and recovery pages work without a token.

JWTs expire 12 hours after login by default, or sooner if configured by the server;
validation never extends the saved expiry. The expiry timer redirects protected
pages to login. Signing out clears the JWT and cached user without a server request.
With stateless authentication, a copied JWT remains usable until expiry, including
after logout or password reset. Expiry requires another login. Credentials are
never stored in `localStorage`.

The last protected page, including its query and fragment, is saved separately in
tab storage and survives logout, expiry, and login-page refreshes. Login returns
to that page, with `/home` as the fallback. Return destinations must resolve to
known protected routes. Flask also validates the JWT on each protected API call;
route checks alone never authorize an API request. Existing opaque session tokens
are rejected after switching to JWTs, so existing users must sign in again.

Conversations are held in the current page's memory and are not saved to the database.
New conversation clears the visible messages. The model continues to answer each
question independently using the existing reference retrieval pipeline.

## Structure

```text
src/
|-- assets/main.css       Shared responsive styles
|-- components/          Branding and account navigation
|-- pages/               Login, account recovery, and chat screens
|-- router/              Routes and authentication guards
|-- services/            JSON HTTP client and API contracts
`-- stores/auth.js       Tab-scoped session storage and authenticated state
```

## Verify and build

```powershell
npm test
npm run build
```

Tests use Node's built-in test runner and mock the HTTP boundary to verify API
payloads, failures, timeouts, JWT authentication before metadata/page loading, one metadata load per page lifetime,
route cancellation, local logout, and token expiration.
The production build is written to `dist/`.

## Deployment

Serve `dist/` with SPA fallback to `index.html`. Reverse-proxy `/api/*` to Flask,
removing `/api` before forwarding. The Vite proxy applies only to `npm run dev`;
`npm run preview` does not proxy API requests.

`.env.example` documents the optional `VITE_API_BASE_URL` prefix (default `/api`).
Vite environment variables are embedded in the browser build and must not contain
secrets. If using a different API origin, configure the server's allowed CORS
origins explicitly before changing the base URL.
