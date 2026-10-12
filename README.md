# Homely

Homely is the persistent operating memory for one physical home. Issues, repairs, appliances/furniture, evidence, recurring charges and saved purchases remain structured records; the assistant explains those records and proposes changes.

## Run

Requires Node.js 24.x.

```bash
npm ci
npm run dev
```

Open http://localhost:4173. Migrations run at startup and an empty database receives the fictional demo home. The functional POC opens directly without a shared password or owner session. It is a public demo, not authenticated household hosting. Real private household hosting requires a separate authentication design.

## Interface

The five main pages follow the original notes: **Home, Issues, Repairs, Appliances, Files**. Chat stays alongside normal pages and opens as a drawer on smaller screens. The file viewer contains only the selected evidence.

Home shows attention items, upcoming work and compact summaries. Charges, saved purchases and history open from Home; full record lists live in their own pages. The brand and browser tab use the same stick-house shape.

## Architecture

One Node/TypeScript server serves the existing HTML/CSS/JavaScript frontend and the household API. Groq uses the same internal domain tools as the UI. Exa supplies search and content extraction. Optional Google Drive selection attaches evidence files; it does not store or recover the database. There is no external MCP server, Firecrawl client or Drive database-backup scheduler.

All mutations follow **proposal → preview → approval → commit → audit**. The agent cannot commit changes. Issues and repairs retain permanent history; reversible changes remain available to undo from Home's History view.

## Storage

Without cloud credentials, SQLite stores records at `HOMELY_DB_PATH` (default `./data/homely.db`). A local database file survives ordinary local restarts.

For durable cloud records, configure both:

```bash
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
```

Homely uses a libSQL embedded replica with reads served locally and writes forwarded to Turso. It syncs before migrations and seeding. The replica uses a separate `.replica` file, preserving any existing local SQLite file. Failure to open or sync Turso stops startup instead of silently switching to a disposable database. The health endpoint identifies `LOCAL` or `TURSO` storage.

Existing local records are not automatically imported into an empty Turso database. `db:reset` applies only to a local demo and refuses to run when Turso is configured. Render's free filesystem is ephemeral; durable cloud history needs Turso credentials before real records are added.

## Assistant and research

```bash
AI_ENABLED=true
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
EXA_API_KEY=...
```

The `openai` package is only the compatible transport to Groq. Credentials stay on the server. The assistant retrieves household state and creates inert proposals with bounded conversation history. Exa searches and reads only HTTPS URLs returned by Homely search. Local-service searches require a location supplied by the user.

Chat accepts browser speech input where available. Press Voice to dictate and Stop listening to end capture; dictation does not submit automatically. ElevenLabs is not required for the POC.

## Evidence

Files retain provenance, dates, reason, status and associations with assets, issues, repairs, charges or purchases. Source links can be saved through preview/approval. Optional Drive file selection uses `drive.file` access; configure the Google credentials in `.env.example` and use a matching callback URL. Drive remains disabled by default. Supported media open inside the file viewer; ordinary web pages retain an Open source link.

## Checks

```bash
npm run build
npm test
node --check public/app.js
```

CI also verifies password-free access, favicon delivery, browser navigation, issue/repair approval, evidence viewing, optional chat and mobile layout without spending model or voice credits.

