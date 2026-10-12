// CI uses a test database and never calls paid providers or the production DB.
process.env.GROQ_API_KEY = "";
process.env.EXA_API_KEY = "";
const { createTestDatabase } = await import("./helpers.js");
const { startServer } = await import("../src/server.js");
// Explicit CI-only gateway. Production startServer never supplies this bypass.
const { migrate } = await import("../src/db.js");
const { seedDemo } = await import("../src/seed.js");
const db=createTestDatabase();migrate(db);seedDemo(db);
await startServer(db,{
  status(){return {enabled:false,authenticated:true,provider:"google" as const,setupRequired:false,user:{id:"ci-user",email:"test@example.invalid",name:"CI",homeId:"home-hawthorn",role:"OWNER" as const}}},
  requireUser(){return {id:"ci-user",email:"test@example.invalid",name:"CI"}},
  beginLogin(){throw new Error("Google login is disabled in CI")},
  async finishLogin(){throw new Error("Google login is disabled in CI")},
  logout(_req,res){res.setHeader("set-cookie","homely_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")}
});
