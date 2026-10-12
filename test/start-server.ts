// CI uses a test database and never calls paid providers or the production DB.
process.env.GROQ_API_KEY = "";
process.env.EXA_API_KEY = "";
const { createTestDatabase } = await import("./helpers.js");
const { startServer } = await import("../src/server.js");
await startServer(createTestDatabase());
