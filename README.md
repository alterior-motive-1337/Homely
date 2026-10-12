# Homely

Homely is the persistent operating memory for one physical home. Issues, repairs, appliances/furniture, evidence, recurring charges and saved purchases remain structured records. The assistant explains those records and proposes changes.

## Setup

Node.js 24.x is pinned in `.node-version`. Copy `.env.example` to `.env` and set the four application credentials:

```text
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
GROQ_API_KEY=...
EXA_API_KEY=...
```

```bash
npm ci
npm run dev
```

Open http://localhost:4173. The POC opens without a password gate.

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

There are no Google Drive, external MCP, Firecrawl, password/session or backup integrations to configure. Evidence metadata and associations stay in Turso; existing source links remain viewable. Supported media open in the viewer and ordinary web pages retain an Open source link.

## Checks

```bash
npm run build
npm test
node --check public/app.js
```

Tests use an explicit in-memory libSQL dependency, never a production startup flag or fallback. CI checks record approval/history, evidence viewing, navigation, voice stop and layout without calling paid providers or the production database.
