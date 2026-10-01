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
Browser UI                 MCP hosts
   |                           |
HTTP API                 Homely MCP server
   |                           |
   +------------+--------------+
                |
Homely domain logic + guarded transactions
                |
              SQLite
```

SQLite owns truth. The current build has no LLM dependency. Mutations are committed only through Homely's transaction service; proposals are inert until explicitly approved.

Current domain surface: Home, Systems, Assets, Issues, Maintenance Rules, Timeline Events, Documents, and auditable Transactions. Mutating home state follows propose → preview → commit → audit → undo.

Homely also exposes the same domain through a local stdio MCP server. OpenAI, Google Drive, ElevenLabs, and richer project workflows remain later layers.

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
