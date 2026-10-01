# Homely

Homely is the persistent operating memory for a home.

This foundation deliberately starts below the AI layer: local SQLite state, deterministic health rules, realistic household history, and a desktop-first operating interface. Optional agent, voice, and cloud integrations will sit on top of this substrate rather than own it.

## Run

Requires Node.js 22.13+.

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
Browser UI             OpenAI Agent             MCP hosts
   |                         |                       |
HTTP API              Homely tool layer       Homely MCP server
   |                         |                       |
   +-------------------------+-----------+-----------+
                                         |
                         Homely domain logic + guarded transactions
                                         |
                                       SQLite
```

SQLite owns truth. OpenAI is optional and sits behind an AgentProvider boundary. Mutations are committed only through Homely's transaction service; model-created proposals are inert until explicitly approved in Homely.

Current domain surface: Home, Systems, Assets, Issues, Maintenance Rules, Timeline Events, Documents, and auditable Transactions. Mutating home state follows propose → preview → commit → audit → undo.

Homely also exposes the same domain through a local stdio MCP server. The OpenAI agent uses the same provider-neutral Homely tool executor for grounded reads and proposals. Google Drive, ElevenLabs, and richer project workflows remain later layers.

The default database is `./data/homely.db`; override it with `HOMELY_DB_PATH`. Optional integration variables are documented in `.env.example` and disabled by default.


## MCP

Homely uses the official MCP TypeScript v2 server package and exposes a local stdio server.

```bash
npm run mcp
```

Initial tools:

- `get_home_summary`
- `list_assets`
- `get_asset`
- `get_asset_history`
- `search_history`
- `list_maintenance_due`
- `preview_action`
- `commit_action`
- `reject_action`
- `undo_action`
- `get_transaction`

Read tools query the same SQLite/domain state as the web application. Mutation tools route through Homely transactions; `preview_action` is inert, while commit and undo require an explicit `userApproved: true` argument and remain audited.


## Optional OpenAI agent

The web application runs normally with AI disabled. To enable the reasoning layer, provide server-side environment configuration:

```bash
AI_ENABLED=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.5
npm run dev
```

The API key is never sent to the browser. The OpenAI provider uses the Responses API and can read Homely state or create an inert transaction proposal. It is not given commit or undo tools. Approval remains a Homely UI/API action, so a model response cannot silently mutate SQLite.

If the provider is disabled, unconfigured, or temporarily unavailable, the structured property application remains operational.
