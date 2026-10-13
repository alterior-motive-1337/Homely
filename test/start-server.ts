// CI uses a test database and never calls paid providers or the production DB.
process.env.GROQ_API_KEY = "";
process.env.EXA_API_KEY = "";
const { createTestDatabase } = await import("./helpers.js");
const { startServer } = await import("../src/server.js");
// Explicit CI-only gateway. Production startServer never supplies this bypass.
const { migrate } = await import("../src/db.js");
const { seedDemo } = await import("../src/seed.js");
const db=createTestDatabase();migrate(db);seedDemo(db);
const now=new Date().toISOString();
db.prepare("INSERT INTO auth_users(id,google_subject,email,display_name,created_at,last_login_at) VALUES(?,?,?,?,?,?)")
  .run("ci-user","ci-google-user","test@example.invalid","CI",now,now);
db.prepare("INSERT INTO home_memberships(home_id,user_id,role,joined_at) VALUES(?,?,?,?)")
  .run("home-hawthorn","ci-user","OWNER",now);

// A second completely empty home proves the new-account experience doesn't depend on demo data.
db.prepare("INSERT INTO homes(id,name,address_label,created_at,updated_at) VALUES(?,?,NULL,?,?)")
  .run("home-ci-empty","My Home",now,now);
db.prepare("INSERT INTO systems(id,home_id,name,category,description,position,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?,?)")
  .run("sys-ci-appliances","home-ci-empty","Appliances","APPLIANCES",1,now,now);
const demoUser={id:"ci-user",email:"test@example.invalid",name:"CI",homeId:"home-hawthorn",role:"OWNER" as const};
const freshUser={id:"ci-fresh",email:"fresh@example.invalid",name:"Fresh",homeId:"home-ci-empty",role:"OWNER" as const};
const {saveChatTurn}=await import("../src/domain/chat.js");
saveChatTurn(db,demoUser,"Seeded chat question",{text:"Saved household chat",responseId:null,proposals:[],toolsUsed:[]});
function userFor(req:{headers:{cookie?:string}}){return String(req.headers.cookie??"").includes("homely_test_view=fresh")?freshUser:demoUser}

await startServer(db,{
  status(req){return {enabled:false,authenticated:true,provider:"google" as const,setupRequired:false,user:userFor(req)}},
  requireUser(req){return userFor(req)},
  switchHome(_req,homeId){return {id:"ci-user",email:"test@example.invalid",name:"CI",homeId,role:"OWNER" as const}},
  recentlyAuthenticated(){return true},
  beginLogin(){throw new Error("Google login is disabled in CI")},
  async finishLogin(){throw new Error("Google login is disabled in CI")},
  logout(_req,res){res.setHeader("set-cookie","homely_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")}
});
