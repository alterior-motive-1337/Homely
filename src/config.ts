import path from "node:path";

const root = process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4173),
  dbPath: path.resolve(root, process.env.HOMELY_DB_PATH ?? "./data/homely.db"),
  publicDir: path.resolve(root, "public"),
  migrationsDir: path.resolve(root, "migrations"),
  aiEnabled: process.env.AI_ENABLED === "true",
  openAiApiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5.5",
  voiceEnabled: process.env.VOICE_ENABLED === "true",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb",
  elevenLabsTtsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_multilingual_v2",
  elevenLabsSttModel: process.env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2",
  googleDriveEnabled: process.env.GOOGLE_DRIVE_ENABLED === "true",
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  googleDriveRedirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || "http://localhost:4173/api/google-drive/callback",
  googleDriveTokenPath: path.resolve(root, process.env.GOOGLE_DRIVE_TOKEN_PATH ?? "./data/google-drive-token.json")
};
