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
- `/home`: default landing page when no previous page is saved, with links to Chat with AI,
  Profile, and Faxes. The Clinician logo returns to this page.
- `/profile` and `/faxes`: empty authenticated pages reserved for future work.
- `/verify-email#token=...`: confirm the verification link sent after registration.
  Accounts must verify their email before login.
- `/forgot-password` and `/reset-password#token=...`: request and complete a reset.
- `/chat`: authenticated medical chat; calls `POST /chat` with JSON.
- Sign out calls `POST /auth/logout` to invalidate the server session.

In local file-mail mode, verification/reset emails are in
`backend/instance/mail/*.eml`. Open the complete link while Vite is running.
SMTP can be configured in `backend/.env` for real email delivery.

Session credentials and the user profile are kept in Pinia and the current tab's
`sessionStorage`. On page load and every route navigation, `GET /appInfo` runs
only when tab storage contains a token that has not already expired locally.
Without a token, no app-info request is made. Route navigation waits for the
server check, including query and fragment changes. Concurrent navigations share
an in-flight check. A loading overlay is visible while app-info requests run,
and background controls are disabled. The current page stays mounted while a
later route is checked.
New protected page components wait for server validation. A valid response supplies application
information, the current user, and expiration without extending the saved session.
Invalid or revoked tokens redirect directly to login with "You do not have access
to the app. Please login to continue." Expired sessions show "Your login session
expired. Please login to continue." The backend returns `401 session_expired` for
expiration and `401 unauthorized` for invalid/revoked sessions. Public login,
registration, and email/password recovery pages remain accessible without a
session. Network and database failures show a retry screen and preserve saved
credentials.
Sessions expire 12 hours after login (or sooner if the server sets an earlier
expiration); closing the tab ends browser storage persistence. Credentials are
never written to `localStorage`. Expired or malformed saved sessions are removed,
and signing out clears the stored session after the server confirms revocation.
The expiration timer redirects protected pages directly to login with the expired
session message. The last protected page (including query and fragment) is saved
separately in tab storage and survives session removal and login-page refreshes.
After login, the app returns to that page; `/home` is the fallback for a first
login. Return destinations must resolve to known protected routes in this app.
Route guards protect the chat page; Flask also authenticates every chat request.
A server `401` clears the client session and returns the user to sign in.

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
payloads, failures, timeouts, login/profile loading, logout, and session expiration.
The production build is written to `dist/`.

## Deployment

Serve `dist/` with SPA fallback to `index.html`. Reverse-proxy `/api/*` to Flask,
removing `/api` before forwarding. The Vite proxy applies only to `npm run dev`;
`npm run preview` does not proxy API requests.

`.env.example` documents the optional `VITE_API_BASE_URL` prefix (default `/api`).
Vite environment variables are embedded in the browser build and must not contain
secrets. If using a different API origin, configure the server's allowed CORS
origins explicitly before changing the base URL.
