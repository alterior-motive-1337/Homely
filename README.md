# Homely

Homely is the persistent operating memory for a home.

This foundation deliberately starts below the AI layer: local SQLite state, deterministic health rules, realistic household history, and a desktop-first operating interface. Optional agent, voice, and cloud integrations will sit on top of this substrate rather than own it.

## Run

Requires Node.js 24.x.

```bash
npm install
npm run db:reset
npm run dev
```

Open http://localhost:4173.

The server automatically applies migrations and only seeds the demo property when the database is empty.

## Commands

```bash
npm run dev
npm run build
npm test
npm run db:migrate
npm run db:seed
npm run db:reset
```

## Current architecture

```text
Browser UI             Groq Agent             MCP hosts
   |                         |                       |
HTTP API              Homely tool layer       Homely MCP server
   |                         |                       |
   +-------------------------+-----------+-----------+
                                         |
                         Homely domain logic + guarded transactions
                                         |
                                       SQLite
```

SQLite owns truth. Groq is optional and sits behind an AgentProvider boundary. Mutations are committed only through Homely's transaction service; model-created proposals are inert until explicitly approved in Homely.

Current domain surface: Home, Systems, Assets, Issues, Maintenance Rules, Projects, Timeline Events, Documents, and auditable Transactions. Mutating home state follows propose → preview → commit → audit → undo.

Homely also exposes the same domain through a local stdio MCP server. The Groq agent uses the same provider-neutral Homely tool executor for grounded reads and proposals. Google Drive and optional voice remain integration layers; Projects are now part of the core structured domain.

The default local database is `./data/homely.db`; override it with `HOMELY_DB_PATH`. The supported cloud-primary deployment runs Homely on Render with an ephemeral SQLite working copy, single-owner authentication, and verified Google Drive database recovery. Optional integration variables are documented in `.env.example`.


## MCP

Homely uses the official MCP TypeScript v2 server package and exposes a local stdio server.

```bash
npm run mcp
```

Initial tools:

- `get_home_summary`
- `list_assets`
- `get_asset`
- `list_issues`
- `list_documents`
- `get_asset_history`
- `search_history`
- `list_maintenance_due`
- `list_projects`
- `preview_action`
- `get_transaction`

Read tools query the same SQLite/domain state as the web application and advertise explicit MCP read-only/closed-world annotations. `preview_action` may create an audited transaction proposal but cannot change home state.

Homely intentionally does **not** expose commit, reject, or undo operations through MCP. An MCP host/model can investigate the property and propose a structured action; the human approves or rejects that proposal inside Homely, and only Homely's own transaction interface can commit or reverse state. This preserves the core rule: **AI proposes. Homely commits.**


## Optional Groq agent

The web application runs normally with AI disabled. To enable the reasoning layer, provide server-side environment configuration:

```bash
AI_ENABLED=true
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
npm run dev
```

The API key is never sent to the browser. Homely sends Responses API requests to Groq's OpenAI-compatible endpoint and can read Homely state or create an inert transaction proposal. The `openai` npm package is used only as the compatible HTTP client; inference is provided by Groq. It is not given commit or undo tools. Approval remains a Homely UI/API action, so a model response cannot silently mutate SQLite.

If the provider is disabled, unconfigured, or temporarily unavailable, the structured property application remains operational.


## Optional Google Drive

Drive remains off unless explicitly enabled and configured. Homely requests only the non-sensitive per-file scope:

```text
https://www.googleapis.com/auth/drive.file
```

Configure a Google OAuth web client with the callback URI shown in `.env.example`, enable the Google Drive API, and use the dedicated Homely Google account:

```bash
GOOGLE_DRIVE_ENABLED=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:4173/api/google-drive/callback
```

The connect flow invokes Google's file picker authorization flow. Homely receives only file IDs the user selected. OAuth credentials are stored locally under `./data/google-drive-token.json` by default, which is gitignored.

Selecting a Drive file does **not** silently attach it. The user chooses a Homely asset and document type, previews an `ATTACH_DOCUMENT` transaction, and explicitly approves it. The document association and timeline event are reversible while the audit record remains.


## Cloud-primary Render deployment

The repository includes a root `render.yaml` for the low-infrastructure deployment path:

```text
Browser → Render → Homely/SQLite → Google Drive backups
```

The Render service binds to `0.0.0.0:$PORT`, requires the owner password before exposing property data, throttles repeated failed logins, and invalidates prior sessions when the owner password changes. Long-lived Google credentials remain in Render's secret environment variables. Important transaction commits, rejections, and reversals trigger a Drive backup; periodic backups run while the service is awake.

On a fresh ephemeral boot, Homely attempts to restore the newest Drive snapshot **before** it opens/migrates SQLite. Restored databases must pass SQLite integrity checking. If no backup exists yet, the demo home is seeded and backed up before the server starts accepting traffic.

See [docs/render-deployment.md](docs/render-deployment.md) for the Google OAuth refresh-token and Blueprint setup procedure.

A paid persistent disk can be added later without replacing this design: point `HOMELY_DB_PATH` at the mounted disk and retain Drive as off-site recovery.
