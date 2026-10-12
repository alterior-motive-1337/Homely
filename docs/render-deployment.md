# Render deployment

Use the existing Homely Node web service and `main` branch. Build with `npm ci && npm run build`, start with `npm start`, and use `/api/health` for readiness. Node 24.x is pinned in `.node-version`; Render supplies the runtime port and the app selects its host automatically.

Only four application variables are configured:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GROQ_API_KEY`
- `EXA_API_KEY`

Turso is mandatory. Missing credentials, an invalid local/file database URL or a failed initial synchronization stop startup. There is no disposable database fallback. Health reports `durability: "TURSO"` after the database is ready. The replica cache location is managed by the application.

Groq uses `openai/gpt-oss-120b` and activates when its key is present. Exa supplies search and content extraction. No feature/model/Drive/backup/authentication switches remain. Remove obsolete manually configured entries while preserving the four credentials and platform-managed variables.

On an existing Blueprint, `sync: false` does not supply a missing secret; set the four credentials in Render before deploying. Do not replace the complete environment blindly, which could discard active credentials.

After deployment, verify the actual deployed commit, all five pages, the stick-house favicon and database readiness. A successful build alone does not establish a live Turso connection.
