# Render deployment

Use the existing Homely Node web service and the repository's `main` branch.

- Build: `npm ci && npm run build`
- Start: `npm start`
- Health: `/api/health`
- Host: `0.0.0.0`
- Node: 24.x

The POC has no password gate. The obsolete `AUTH_ENABLED`, owner-password/session and backup settings are ignored by the current application. Google Drive is disabled by default and is optional evidence selection only.

For chat, set `AI_ENABLED=true`, `GROQ_API_KEY`, and optionally `GROQ_MODEL` (default `openai/gpt-oss-120b`). Set `EXA_API_KEY` for web search and page reading. There is no Firecrawl setup and no external MCP service.

For durable records on the free service, set **both** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. `/api/health` must report `durability: "TURSO"`. Homely syncs its embedded replica before migrations; remote failures stop startup. Existing local records need an explicit migration before changing database mode.

With neither Turso variable configured, the app runs a disposable local POC. Render's ephemeral filesystem does not preserve it across redeploys. Do not describe that mode as durable household storage.

After a deployment, verify the actual deployed commit, open all five pages, check the house favicon response, and confirm `/api/integrations/status` identifies Groq. A healthy old deployment can still show the wrong architecture: readiness alone does not prove that the requested commit is live.

