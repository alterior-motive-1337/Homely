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
Browser UI
   |
HTTP API
   |
Homely domain queries + deterministic health
   |
SQLite
```

SQLite owns truth. The current build has no LLM dependency.

Current domain surface: Home, Systems, Assets, Issues, Maintenance Rules, Timeline Events, and Documents. Projects, transactions, MCP, OpenAI, Google Drive, and ElevenLabs will be layered on after the state model is trustworthy.

The default database is `./data/homely.db`; override it with `HOMELY_DB_PATH`. Optional integration variables are documented in `.env.example` and disabled by default.
