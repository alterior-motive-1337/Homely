# Homely

Homely is the persistent operating memory for one physical home.

The application keeps structured household state in SQLite, preserves important history, and layers an optional home-aware agent on top. The AI layer is not the source of truth: Issues, Repairs, Assets, Files, Charges, Potential Purchases, Maintenance, Projects, Timeline Events and Transactions remain explicit domain records.

## Run locally

Requires Node.js 24.x.

```bash
npm install
npm run db:reset
npm run dev
```

Open http://localhost:4173.

The server applies migrations automatically and seeds the demo property only when the database is empty.

## Commands

```bash
npm run dev
npm run build
npm test
npm run db:migrate
npm run db:seed
npm run db:reset
npm run mcp
npm run mcp:smoke
```

## Architecture

```text
Browser UI             Groq agent             MCP hosts
    |                    |                       |
HTTP API          Homely tool layer         Homely MCP
    |                    |                       |
    +--------------------+-----------+-----------+
                                     |
                     guarded Homely transactions
                                     |
                                   SQLite
                                     |
                         optional Google Drive backup
```

SQLite owns authoritative state. The agent and MCP layer can read that state and create inert proposals, but they are not given commit/undo authority.

Mutations follow:

```text
propose → preview → human approval → commit → audit
```

Reversible record types may later be undone through Homely. Committed Issues and Repairs are historical records and are intentionally not deletable through transaction undo; corrections are recorded as additional history.

## Primary product surface

The main interface is intentionally small:

- **Home** — current state, attention items, recent repairs, charges, purchases and timeline memory.
- **Issues** — active and resolved problem history.
- **Repairs** — permanent repair history including date, cost, contractor, outcome and linked issue.
- **Appliances** — household assets/furniture with acquisition, condition, warranty and history.
- **Files** — household evidence with provenance, evidence date, reason, status and associations.

Maintenance, Projects, Timeline and Transactions remain available in the underlying domain/tooling without dominating primary navigation.

## Files and evidence

Evidence can be associated with any combination of:

- asset
- issue
- repair
- recurring charge
- potential purchase

Google Drive files can be selected and attached through the approval flow. Direct source/product/manual URLs can also be saved as evidence from the Files tab.

Evidence metadata includes type, provenance, evidence date, reason and status. The built-in viewer opens local demo files, Drive links and saved source URLs. Photos and videos from supported file sources are treated as normal evidence records.

## Agent

Set `AI_ENABLED=true` and configure Groq:

```bash
AI_ENABLED=true
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
```

The Groq credential stays server-side. Homely sends Responses-compatible requests to Groq's API endpoint. The `openai` npm package is retained only as the compatible client transport; inference is provided by Groq.

Homely carries bounded multi-turn conversation history inside the application and gives Groq the same provider-neutral Homely tools and proposal-only mutation boundary.

If Groq is not configured, the structured home application continues to work without AI.

## Web research

Optional research tools can be enabled with:

```bash
EXA_API_KEY=...
FIRECRAWL_API_KEY=...
```

Exa provides current search results for products, prices, suppliers and local services. Firecrawl can read a page that came from a Homely search result.

Local-service research requires a location explicitly supplied by the user; Homely does not infer a precise home location.

## Voice input

The chat includes browser speech input when the browser exposes the Web Speech recognition API. This path does not require a separate paid voice API key.

Unsupported browsers simply hide the Voice control. Microphone permission remains user-controlled by the browser.

## MCP

Homely runs an official MCP v2 stdio server:

```bash
npm run mcp
```

Current read/proposal tools include:

- `get_home_summary`
- `list_assets`
- `get_asset`
- `list_issues`
- `list_repairs`
- `list_charges`
- `list_purchases`
- `list_documents`
- `get_asset_history`
- `search_history`
- `list_maintenance_due`
- `list_projects`
- `preview_action`
- `get_transaction`

MCP intentionally does **not** expose commit, reject or undo operations. Models may investigate the home and prepare a proposal; the human approves or rejects it inside Homely.

## Google Drive

Drive has two roles:

1. off-site SQLite backup/recovery for the cloud-primary deployment;
2. optional household evidence import.

Interactive file access uses the `drive.file` scope rather than unrestricted Drive access.

Relevant configuration is documented in `.env.example` and `docs/render-deployment.md`.

## Render deployment

The supported low-infrastructure deployment is:

```text
Browser → Render → Homely / ephemeral SQLite → Google Drive backup
```

The Render Blueprint in `render.yaml` configures owner authentication, Groq-first AI settings, optional web research, Google Drive recovery and the free-service SQLite path.

On startup, Homely restores the newest valid Drive snapshot before opening/migrating SQLite. Important committed transactions trigger durability backups, and periodic backups run while the service is awake.

See [docs/render-deployment.md](docs/render-deployment.md) for setup and recovery verification.

## Validation

CI currently runs:

- TypeScript build
- unit tests
- JavaScript syntax validation
- fresh database reset/migrations
- MCP smoke test
- desktop/mobile browser regression
- browser voice-input regression

The canonical October 2026 product model is documented in [docs/canonical-product-model.md](docs/canonical-product-model.md).
