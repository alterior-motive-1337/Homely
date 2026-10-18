# Render deployment

Use the existing Homely Node web service and `main` branch. The Blueprint builds with `npm ci && npm run build`, starts with `npm start`, and checks `/api/health`. Node 24.x is pinned in `.node-version`; Render supplies the runtime port and the app selects its host automatically. `/api/ready` additionally reports whether Google OAuth is configured.

Set all seven application variables in Render:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GROQ_API_KEY`
- `EXA_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Google OAuth is required to access household records; configure its consent screen and exact HTTPS callback URL before testing sign-in. Turso is mandatory. Missing credentials, an invalid local/file database URL or a failed initial synchronization stop startup. There is no disposable database fallback. Health reports `durability: "TURSO"` after the database is ready. The replica cache location is managed by the application.

Groq uses `openai/gpt-oss-120b` and activates when its key is present. Exa supplies search and content extraction. No feature/model/Drive/backup switches remain. Preserve all seven application credentials and platform-managed variables when editing the service environment.

On an existing Blueprint, `sync: false` does not supply a missing secret; set the seven credentials in Render before deploying. Do not replace the complete environment blindly, which could discard active credentials.

After deployment, verify the actual deployed commit, `/api/health`, Google sign-in, all five pages and the stick-house favicon. A successful build alone does not establish a live Turso connection.
