# Homely

Homely is the persistent operating memory for one physical home. Issues, repairs, appliances/furniture, evidence, recurring charges and saved purchases remain structured records. The assistant explains those records and proposes changes.

## Setup

Node.js 24.x is pinned in `.node-version`. Copy `.env.example` to `.env` and set the four application credentials:

```text
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
GROQ_API_KEY=...
EXA_API_KEY=...
GOOGLE_CLIENT_ID=... 
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-homely-host.example/auth/google/callback
GOOGLE_ALLOWED_EMAIL=your-google-account@example.com
```

```bash
npm ci
npm run dev
```

Open http://localhost:4173. Google Sign-In is required to access household records. For local development, register `http://localhost:4173/auth/google/callback` as an additional OAuth redirect URI and use it for `GOOGLE_REDIRECT_URI`.

## Storage

**Turso is required.** Missing credentials or a failed initial synchronization stop startup. There is no standalone SQLite fallback and no configurable local database path.

The libSQL replica is a disposable cache managed by the app. Reads use the replica and writes go to Turso. Migrations run after synchronization; an empty database receives the fictional demo home. Existing local SQLite records are not automatically imported into a new Turso database.

Issues and repairs keep permanent history. Mutations follow **proposal → preview → approval → commit → audit**; the assistant cannot commit changes. Reversible changes can be undone from Home's History view.

## Interface

The five pages follow the notes: **Home, Issues, Repairs, Appliances, Files**. Chat stays alongside normal pages and opens as a drawer on smaller screens. The dedicated file viewer contains only the selected evidence.

Charges, saved purchases and history open from Home. Issues and repairs open their own details and evidence. The brand and browser tab use the stick-house shape.

## Services

One Node/TypeScript server serves the existing HTML/CSS/JavaScript frontend and the household API. Groq is enabled when its key is present and uses the fixed `openai/gpt-oss-120b` model. The `openai` package is the compatible transport to Groq. Exa provides search and page content; local-service searches require a location supplied by the user.

Voice input uses the browser and needs no service key. Stop listening ends capture; dictation does not submit automatically.

There is **no Google Drive integration**. Google is used solely for login (scopes: `openid email profile`); Turso stores hashed server-side sessions and binds the existing home to the approved Google subject. The Google email configured in `GOOGLE_ALLOWED_EMAIL` must match a verified Google account; other Google accounts cannot access the demo home's records. To support independent or shared households, the domain layer requires tenant-aware queries and membership roles before enabling open registration. No Google refresh tokens are stored.

There are no external MCP, Firecrawl or backup integrations to configure. Evidence metadata and associations stay in Turso; existing source links remain viewable. Supported media open in the viewer and ordinary web pages retain an Open source link.

## Evidence and file limits

- Uploads are stored **in Turso**, including MP4/WebM video. The app accepts **50 MB per file** (50,000,000 bytes).
- The browser sends ordered 1 MB chunks; the server persists them in the database, checks declared length, and only permits linking after completion and explicit transaction approval. Neither Render's local filesystem nor another storage provider is required.
- Browser media playback uses HTTP byte ranges, allowing audio/video seeking without downloading the entire file. Turso's actual per-account quotas and remote sync performance still apply; large-video behavior requires a live Turso test.
- Previously visited tabs retain their DOM and data for two minutes, preserving filters and avoiding repeated loads. Changes through Homely invalidate the cache; use the header refresh action to pull external changes.
- Optional **Analyze** on stored evidence uses Groq Qwen 3.8 27B for supported images up to 12 MB and Whisper Turbo for speech in MP3/WAV/WebM/MP4 up to 25 MB. Video visual frames and PDF/DOCX parsing are not implemented yet. The 50 MB storage limit is separate from AI processing limits.
- Analysis is on demand, cached in Turso, and never changes the authoritative record. Text files can be read without using Groq.
- **Security:** The POC currently has no login or access controls. Upload only non-sensitive test materials to public deployments. Production use needs authentication, per-home authorization and storage/compute quotas.

## Checks

```bash
npm run build
npm test
node --check public/app.js
```

Tests use an explicit in-memory libSQL dependency, never a production startup flag or fallback. CI checks record approval/history, evidence viewing, navigation, voice stop and layout without calling paid providers or the production database.
