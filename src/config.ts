import path from "node:path";

const root = process.cwd();
const onRender = process.env.RENDER === "true";

export const config = {
  host: process.env.HOST?.trim() || (onRender ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.PORT ?? 4173),
  dbPath: path.resolve(root, process.env.HOMELY_DB_PATH ?? "./data/homely.db"),
  publicDir: path.resolve(root, "public"),
  migrationsDir: path.resolve(root, "migrations"),

  aiEnabled: process.env.AI_ENABLED === "true",
  groqApiKey: process.env.GROQ_API_KEY?.trim() ?? "",
  groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL?.trim() ?? "",
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() ?? "",

  googleDriveEnabled: process.env.GOOGLE_DRIVE_ENABLED === "true",
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  googleDriveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? "",
  googleDriveRedirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || "http://localhost:4173/api/google-drive/callback",
  googleDriveTokenPath: path.resolve(root, process.env.GOOGLE_DRIVE_TOKEN_PATH ?? "./data/google-drive-token.json")
};

