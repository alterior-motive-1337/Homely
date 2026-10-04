import path from "node:path";

const root = process.cwd();
const onRender = process.env.RENDER === "true";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  host: process.env.HOST?.trim() || (onRender ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.PORT ?? 4173),
  dbPath: path.resolve(root, process.env.HOMELY_DB_PATH ?? "./data/homely.db"),
  publicDir: path.resolve(root, "public"),
  migrationsDir: path.resolve(root, "migrations"),

  authEnabled: process.env.AUTH_ENABLED === "true",
  ownerPassword: process.env.HOMELY_OWNER_PASSWORD ?? "",
  sessionSecret: process.env.HOMELY_SESSION_SECRET ?? "",
  sessionDays: positiveInt(process.env.HOMELY_SESSION_DAYS, 7),
  secureCookies: onRender || process.env.NODE_ENV === "production",

  aiEnabled: process.env.AI_ENABLED === "true",
  groqApiKey: process.env.GROQ_API_KEY?.trim() ?? "",
  groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
  openAiApiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5.5",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY?.trim() ?? "",
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL?.trim() ?? "",
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() ?? "",
  voiceEnabled: process.env.VOICE_ENABLED === "true",

  googleDriveEnabled: process.env.GOOGLE_DRIVE_ENABLED === "true",
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  googleDriveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? "",
  googleDriveRedirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || "http://localhost:4173/api/google-drive/callback",
  googleDriveTokenPath: path.resolve(root, process.env.GOOGLE_DRIVE_TOKEN_PATH ?? "./data/google-drive-token.json"),
  googleDriveBackupFolder: process.env.GOOGLE_DRIVE_BACKUP_FOLDER?.trim() || "Homely Backups",

  backupEnabled: process.env.BACKUP_ENABLED === "true",
  backupRequired: process.env.BACKUP_REQUIRED === "true",
  backupIntervalMinutes: positiveInt(process.env.BACKUP_INTERVAL_MINUTES, 30),
  backupRetention: positiveInt(process.env.BACKUP_RETENTION, 72)
};
