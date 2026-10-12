# Homely

Homely is a private, Google-authenticated operating memory for each household. Issues, repairs, appliances/furniture, evidence, recurring charges and saved purchases remain structured records. The assistant explains those records and proposes changes.

## Setup

Node.js 24.x is pinned in `.node-version`. Copy `.env.example` to `.env` and set the application credentials:

```text
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
GROQ_API_KEY=...
EXA_API_KEY=...
GOOGLE_CLIENT_ID=... 
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-homely-host.example/auth/google/callback
GOOGLE_ALLOWED_EMAIL= # OPTIONAL: email authorized to claim a pre-existing unowned demo home
```

```bash
npm ci
npm run dev
```

Open http://localhost:4173. Google Sign-In is required to access household records. For local development, register `http://localhost:4173/auth/google/callback` as an additional OAuth redirect URI and use it for `GOOGLE_REDIRECT_URI`.

## Storage

**Turso is required.** Missing credentials or a failed initial synchronization stop startup. There is no standalone SQLite fallback and no configurable local database path.

The libSQL replica is a disposable cache managed by the app. Reads use the replica and writes go to Turso. Migrations run after synchronization. A real new Google account creates an empty private home, not a fictional demo. Set `HOMELY_SEED_DEMO=true` only to explicitly provision demonstration content in an empty database. Existing local SQLite records are not automatically imported into a new Turso database.

Issues and repairs keep permanent history. Mutations follow **proposal → preview → approval → commit → audit**; the assistant cannot commit changes. Reversible changes can be undone from Home's History view.

## Interface

The five pages follow the notes: **Home, Issues, Repairs, Appliances, Files**. Chat stays alongside normal pages and opens as a drawer on smaller screens. The dedicated file viewer contains only the selected evidence.

Charges, saved purchases and history open from Home. Issues and repairs open their own details and evidence. The brand and browser tab use the stick-house shape.

## Services

One Node/TypeScript server serves the existing HTML/CSS/JavaScript frontend and the household API. Groq is enabled when its key is present and uses the fixed `openai/gpt-oss-120b` model. The `openai` package is the compatible transport to Groq. Exa provides search and page content; local-service searches require a location supplied by the user.

Voice input uses the browser and needs no service key. Stop listening ends capture; dictation does not submit automatically.

There is **no Google Drive integration**. Google is used only for authentication (scopes: `openid email profile`). **Self-registration is enabled**: every new Google identity receives its own private home, initialized with empty household systems. Turso stores hashed server-side sessions and membership records; the backend restricts API reads, mutations, audit history, files, staged uploads and agent tools to the authenticated home. Existing demo/home data can be claimed only by its existing owner or the email explicitly configured with optional `GOOGLE_ALLOWED_EMAIL` if the home is unowned. No Google Drive scope or refresh tokens are used.

There are no external MCP, Firecrawl or Google Drive integrations to configure. A full owner-controlled TAR export is available; automated off-database backups are not yet configured. Evidence metadata and associations stay in Turso; existing source links remain viewable. Supported media open in the viewer and ordinary web pages retain an Open source link.

## Evidence and file limits

- Uploads are stored **in Turso**, including MP4/WebM video. The app accepts **50 MB per file** (50,000,000 bytes), with an atomic **500 MB reserved-storage quota per home** that includes unfinished uploads.
- The browser sends ordered 1 MB chunks; the server persists them in the database, checks declared length, and only permits linking after completion and explicit transaction approval. Neither Render's local filesystem nor another storage provider is required.
- Browser media playback uses HTTP byte ranges, allowing audio/video seeking without downloading the entire file. Turso's actual per-account quotas and remote sync performance still apply; large-video behavior requires a live Turso test.
- Previously visited tabs retain their DOM and data for two minutes, preserving filters and avoiding repeated loads. Changes through Homely invalidate the cache; use the header refresh action to pull external changes.
- Optional **Analyze** on stored evidence uses Groq Qwen 3.8 27B for supported images up to 12 MB and Whisper Turbo for speech in MP3/WAV/WebM/MP4 up to 25 MB. Video visual frames and PDF/DOCX parsing are not implemented yet. The 50 MB storage limit is separate from AI processing limits.
- Analysis is on demand, cached in Turso, and never changes the authoritative record. Text files can be read without using Groq.
- **Security:** Google authentication, server-enforced per-home authorization, rate limits and storage quotas are in place. Before a public launch, configure off-database backup/recovery, account-abuse controls across instances, privacy/legal requirements, live provider testing, and a security review.

## Checks

```bash
npm run build
npm test
node --check public/app.js
```

Tests use an explicit in-memory libSQL dependency, never a production startup flag or fallback. CI checks record approval/history, evidence viewing, navigation, voice stop and layout without calling paid providers or the production database.

## Google Sign-In configuration

Create an OAuth Client ID of type **Web application** in Google Cloud Console, with the **Google Auth Platform** consent screen configured. Add your app's exact HTTPS redirect URI:

```
https://YOUR-HOMELY-HOST/auth/google/callback
```

In Render set **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**, and **`GOOGLE_REDIRECT_URI`**. The optional `GOOGLE_ALLOWED_EMAIL` is used only if you want one specific Google identity to reclaim a previously unowned legacy demo/home. No Google Drive API, Google Drive permission, Google refresh token, email-sending service or password recovery configuration is used.

`GOOGLE_REDIRECT_URI` must exactly match the URI in Google Cloud. The app fails closed if a required Google setting is absent, displaying a setup message instead of allowing anonymous household access. The sign-in flow uses authorization code + PKCE + nonce, verifies Google's ID-token signature/audience/issuer/expiry, and stores a hashed, seven-day revocable session in Turso. The verified Google subject determines account identity. Household memberships determine which home data can be accessed, and new users receive a separate home. An already claimed home cannot be taken over by registering with the same email address.

For local testing, also register `http://localhost:4173/auth/google/callback`. Google OAuth consent screens in Testing may require adding the owner email as a test user.

## Household sharing and privacy

- Every new Google account receives its own private home. Household settings let owners rename their home, manage members and create time-limited, single-use invitation links. Invitations are bound to the recipient's verified Google email. Copy and send the link directly: Homely does **not** send mail.
- Invited **Members** can read and edit the shared home; **Viewers** can only read. Members can switch between their personal home and any home they joined. Memberships are checked server-side, including downloads and agent tools.
- The owner can download a complete **TAR archive** from Household settings. It contains a `homely.json` manifest of records and audit history, plus original uploaded media in `files/`. This is a user-initiated export, not a scheduled offsite backup.
- Account deletion is available with an explicit `DELETE MY ACCOUNT` confirmation and a Google sign-in within the last 15 minutes. Users who own a home must first remove other members to avoid erasing someone else's household. This irreversibly deletes the owner's home data and uploaded files.

## Operational controls

- Per-instance throttling limits expensive authenticated calls: agent (12/min), multimedia analysis (5/min), upload creation (20/hour), upload chunks (240/min), general mutations (90/min) and full exports (3/hour). OAuth initiation and callbacks are also rate-limited.
- Upload quota reservations use an immediate database transaction; abandoned staged uploads are cleaned up automatically on subsequent new uploads after 24 hours. A separate scheduled cleanup job is not installed.
- JSON request logs include generated request IDs, method, normalized route, status and duration. Query strings, OAuth codes and invitation tokens are never logged. Responses have CSP, no-sniff, frame protections, and HTTPS HSTS on Render.
- `GET /api/health` checks database access; `GET /api/ready` additionally reports whether Google OAuth has been configured. Production health checks may use the readiness endpoint **after** OAuth settings are installed.
- Throttling uses bounded **in-process memory**. A scaled deployment must use a shared limiter (e.g. Redis or Turso-backed counters) to enforce global limits and protect against sign-up abuse. The 500 MB quota is per home, **not** a global free-tier budget. Automated offsite backups, monitoring alerts, billing, data-retention policy and live load/security testing remain open before a public production launch. Passing CI isn't production certification.

