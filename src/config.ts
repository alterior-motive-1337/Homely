import path from "node:path";

const root = process.cwd();
const onRender = process.env.RENDER === "true";

export const config = {
  host: onRender ? "0.0.0.0" : "127.0.0.1",
  port: Number(process.env.PORT ?? 4173),
  publicDir: path.resolve(root, "public"),
  migrationsDir: path.resolve(root, "migrations"),

  groqApiKey: process.env.GROQ_API_KEY?.trim() ?? "",
  groqModel: "openai/gpt-oss-120b",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL?.trim() ?? "",
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() ?? ""
};

