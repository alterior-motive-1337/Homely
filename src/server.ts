import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL, pathToFileURL } from "node:url";
import { config } from "./config.js";
import { migrate, openDatabase, type HomelyDatabase } from "./db.js";
import { getAsset, getOverview, getProject, getTimeline, listAssets, listCharges, listDocuments, listIssues, listMaintenance, listProjects, listPurchaseCandidates, listRepairs, listSystems } from "./domain/repository.js";
import {
  commitTransaction,
  DomainError,
  getTransaction,
  listTransactions,
  proposeTransaction,
  rejectTransaction,
  undoTransaction,
  type ActionType
} from "./domain/transactions.js";
import { hasHome, seedDemo } from "./seed.js";
import { createAgentRuntime } from "./agent/runtime.js";
import { assertSameOrigin } from "./security/request.js";
import { startUpload, appendUploadChunk, finishUpload, streamStoredFile, UPLOAD_CHUNK_BYTES } from "./evidence/storage.js";
import { analyzeDocument } from "./evidence/analyze.js";
import { GoogleAuthentication, type AuthGateway } from "./security/googleAuth.js";
import { enterHome } from "./security/homeScope.js";
import { RequestLimiter } from "./security/traffic.js";
import { streamHomeArchive } from "./domain/exportHome.js";
import { deleteAccount } from "./domain/deleteAccount.js";
import { deleteDocument } from "./domain/deleteDocument.js";
import { listAlerts, acknowledgeAlert } from "./domain/alerts.js";
import { chatHistory, clearChat, saveChatTurn, listChatConversations, createChatConversation, renameChatConversation, resolveChatConversation, belongsToConversation } from "./domain/chat.js";
import { acceptInvite, inviteMember, listHouseholds, listInvitations, listMembers, removeMember, renameHome, revokeInvite } from "./domain/households.js";
import { openSampleHome } from "./domain/sampleHome.js";
import { serveStatic } from "./server/staticFiles.js";
import { securityHeaders } from "./security/headers.js";
import { viewerMayWrite } from "./security/authorization.js";

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  securityHeaders(res);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {}
) {
  securityHeaders(res);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, maxSize = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxSize) throw new DomainError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage, maxSize = 1_000_000): Promise<Record<string, unknown>> {
  const body = await readBody(req, maxSize);
  if (!body.length) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new DomainError("Request body must be valid JSON.");
  }
}

export async function startServer(
  db: HomelyDatabase = openDatabase(),
  authentication?: AuthGateway
): Promise<http.Server> {
  migrate(db);
  if (!hasHome(db) && process.env.HOMELY_SEED_DEMO === "true") seedDemo(db);

  const agentRuntime = createAgentRuntime(db);
  const auth = authentication ?? new GoogleAuthentication(db);
  const limits = new RequestLimiter();

  const server = http.createServer(async (req, res) => {
    const requestId=randomUUID();
    const start=Date.now();
    res.setHeader("x-request-id",requestId);
    res.on("finish",()=>{
      const pathOnly=String(req.url??"").split("?")[0]??"";
      const category=pathOnly.startsWith("/api/files/")?"/api/files/:id"
        :pathOnly.startsWith("/api/uploads/")?"/api/uploads/:id"
        :pathOnly.startsWith("/api/transactions/")?"/api/transactions/:id"
        :pathOnly.startsWith("/api/homes/invitations/")?"/api/homes/invitations/:id"
        :pathOnly.startsWith("/api/homes/members/")?"/api/homes/members/:id"
        :pathOnly.startsWith("/auth/")?"/auth/:route"
        :pathOnly.startsWith("/api/")?pathOnly: "static";
      console.info(JSON.stringify({type:"http",requestId,method:req.method,route:category,
        status:res.statusCode,durationMs:Date.now()-start}));
    });
    if (!req.url) return sendJson(res, 400, { error: "Missing URL" });
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      assertSameOrigin(req);
      if(req.method==="GET" && url.pathname==="/api/ready") {
        db.prepare("SELECT 1 AS ok").get();
        const ready=auth.status(req).enabled;
        return sendJson(res,ready?200:503,{ready,storage:"TURSO",googleAuthConfigured:ready},
          {"cache-control":"no-store"});
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        db.prepare("SELECT 1 AS ok").get();
        return sendJson(res, 200, { ok: true, service: "Homely", database: "OK", mode: "MULTI_HOME", durability: "TURSO" });
      }

      if (req.method === "GET" && url.pathname === "/api/auth/status") {
        return sendJson(res, 200, auth.status(req), { "cache-control": "no-store" });
      }
      if (req.method === "GET" && url.pathname === "/auth/google") {
        limits.enforce("oauth-start:"+String(req.socket.remoteAddress??"unknown"),15,15*60_000);
        auth.beginLogin(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/auth/google/callback") {
        limits.enforce("oauth-callback:"+String(req.socket.remoteAddress??"unknown"),30,15*60_000);
        try { await auth.finishLogin(req,res,url); }
        catch (error) {
          console.error("Google sign-in failed:", error instanceof DomainError ? error.message : "Identity provider unavailable");
          res.setHeader("cache-control","no-store");
          res.writeHead(303,{location:"/?auth_error=signin","referrer-policy":"no-referrer"});
          res.end();
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/auth/login") {
        res.writeHead(303,{location:"/","cache-control":"no-store"});
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/auth/logout") {
        auth.logout(req,res);
        res.writeHead(204);
        return res.end();
      }
      // Every home API, file download, upload and agent operation requires a valid owner session.
      // No Google account can access the existing household just by registering.
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/demo-documents/")) {
        const user=auth.requireUser(req);
        enterHome(user.homeId);
        // Limit expensive operations by authenticated Google identity, not by household IP.
        if(req.method==="GET" && url.pathname==="/api/account/export")
          limits.enforce("export:"+user.id,3,60*60_000);
        if(req.method==="GET" && url.pathname.startsWith("/api/files/"))
          limits.enforce("media-download:"+user.id,300,60_000);
        if (req.method!=="GET" && req.method!=="HEAD") {
          const key=user.id;
          if(url.pathname==="/api/agent/respond")limits.enforce("agent:"+key,12,60_000);
          else if(url.pathname==="/api/voice/speech")limits.enforce("voice-speech:"+key,30,60_000);
          else if(url.pathname.endsWith("/analyze"))limits.enforce("analysis:"+key,5,60_000);
          else if(url.pathname==="/api/uploads/start")limits.enforce("upload-start:"+key,20,60*60_000);
          else if(url.pathname.includes("/chunks/"))limits.enforce("chunks:"+key,240,60_000);
          else limits.enforce("write:"+key,90,60_000);
        }
        if(user.role==="VIEWER" && !["GET","HEAD"].includes(req.method ?? "GET") && !viewerMayWrite(req.method ?? "",url.pathname))
          throw new DomainError("Your household membership is read-only.",403);
      }

      if(req.method==="DELETE" && url.pathname==="/api/account/delete") {
        const user=auth.requireUser(req);
        if(!auth.recentlyAuthenticated || !auth.recentlyAuthenticated(req,15*60_000))
          throw new DomainError("Sign out and sign in again before deleting your account.",403);
        deleteAccount(db,user,(await readJson(req)).confirmation);
        auth.logout(req,res);
        res.setHeader("cache-control","no-store");
        res.writeHead(204);
        return res.end();
      }
      if(req.method==="GET" && url.pathname==="/api/account/export") {
        return streamHomeArchive(db,auth.requireUser(req),res);
      }
      if(req.method==="GET" && url.pathname==="/api/homes") {
        const user=auth.requireUser(req);
        return sendJson(res,200,{currentHomeId:user.homeId,homes:listHouseholds(db,user)},{"cache-control":"no-store"});
      }
      if(req.method==="POST" && url.pathname==="/api/homes/active") {
        if(!auth.switchHome)throw new DomainError("Home switching is not available.",503);
        const user=auth.switchHome(req,String((await readJson(req)).homeId??""));
        enterHome(user.homeId);
        return sendJson(res,200,{homeId:user.homeId,role:user.role});
      }
      if(req.method==="POST" && url.pathname==="/api/homes/sample") {
        if(!auth.switchHome)throw new DomainError("Home switching is not available.",503);
        const sample=openSampleHome(db,auth.requireUser(req));
        const user=auth.switchHome(req,sample.homeId);
        enterHome(user.homeId);
        return sendJson(res,200,sample,{"cache-control":"no-store"});
      }
      if(req.method==="GET" && url.pathname==="/api/homes/members") {
        return sendJson(res,200,listMembers(db,auth.requireUser(req)));
      }
      if(req.method==="PATCH" && url.pathname==="/api/homes/current") {
        const user=auth.requireUser(req);
        return sendJson(res,200,renameHome(db,user,(await readJson(req)).name));
      }
      if(req.method==="GET" && url.pathname==="/api/homes/invitations") {
        return sendJson(res,200,listInvitations(db,auth.requireUser(req)));
      }
      if(req.method==="POST" && url.pathname==="/api/homes/invitations") {
        const body=await readJson(req);
        const invitation=inviteMember(db,auth.requireUser(req),body.email,body.role);
        return sendJson(res,201,{...invitation,link:"/?invite="+encodeURIComponent(invitation.token)},{"cache-control":"no-store"});
      }
      if(req.method==="POST" && url.pathname==="/api/homes/invitations/accept") {
        const accepted=acceptInvite(db,auth.requireUser(req),(await readJson(req)).token);
        if(auth.switchHome) {
          auth.switchHome(req,accepted.homeId);
          enterHome(accepted.homeId);
        }
        return sendJson(res,200,accepted);
      }
      const invitationRevoke=url.pathname.match(new RegExp("^/api/homes/invitations/([a-zA-Z0-9-]+)$"));
      if(req.method==="DELETE" && invitationRevoke) {
        return sendJson(res,200,revokeInvite(db,auth.requireUser(req),invitationRevoke[1]!));
      }
      const membershipRemove=url.pathname.match(new RegExp("^/api/homes/members/([a-zA-Z0-9-]+)$"));
      if(req.method==="DELETE" && membershipRemove) {
        return sendJson(res,200,removeMember(db,auth.requireUser(req),membershipRemove[1]!));
      }

      // Upload each 50 MB file in small durable Turso transactions.
      if (req.method === "POST" && url.pathname === "/api/uploads/start") {
        return sendJson(res,201,startUpload(db,await readJson(req)));
      }
      const chunkMatch = /^\/api\/uploads\/(upload-[a-f0-9-]+)\/chunks\/(\d+)$/.exec(url.pathname);
      if (req.method === "PUT" && chunkMatch) {
        const bytes = await readBody(req, UPLOAD_CHUNK_BYTES);
        return sendJson(res,200,appendUploadChunk(db,chunkMatch[1]!,Number(chunkMatch[2]),bytes));
      }
      const finishMatch = /^\/api\/uploads\/(upload-[a-f0-9-]+)\/finish$/.exec(url.pathname);
      if (req.method === "POST" && finishMatch) {
        return sendJson(res,200,finishUpload(db,finishMatch[1]!));
      }
      const mediaMatch = /^\/api\/files\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (req.method === "GET" && mediaMatch) {
        return streamStoredFile(db,mediaMatch[1]!,typeof req.headers.range === "string" ? req.headers.range : undefined,res);
      }

      if (req.method === "GET" && url.pathname === "/api/overview") return sendJson(res, 200, getOverview(db));
      if(req.method==="GET"&&url.pathname==="/api/alerts")return sendJson(res,200,{alerts:listAlerts(db,auth.requireUser(req))},{"cache-control":"no-store"});
      if(req.method==="POST"&&url.pathname==="/api/alerts/acknowledge")return sendJson(res,200,acknowledgeAlert(db,auth.requireUser(req),(await readJson(req)).key));
      if(req.method==="GET"&&url.pathname==="/api/agent/conversations")return sendJson(res,200,listChatConversations(db,auth.requireUser(req)),{"cache-control":"no-store"});
       if(req.method==="POST"&&url.pathname==="/api/agent/conversations")return sendJson(res,201,createChatConversation(db,auth.requireUser(req)),{"cache-control":"no-store"});
       if(req.method==="PATCH"&&url.pathname.startsWith("/api/agent/conversations/")){
         const id=decodeURIComponent(url.pathname.slice("/api/agent/conversations/".length));
         return sendJson(res,200,renameChatConversation(db,auth.requireUser(req),id,(await readJson(req)).title),{"cache-control":"no-store"});
       }
       if(req.method==="GET"&&url.pathname==="/api/agent/history")return sendJson(res,200,chatHistory(db,auth.requireUser(req),url.searchParams.get("conversationId")),{"cache-control":"no-store"});
       if(req.method==="DELETE"&&url.pathname==="/api/agent/history")return sendJson(res,200,clearChat(db,auth.requireUser(req)));
       if (req.method === "GET" && url.pathname === "/api/systems") return sendJson(res, 200, listSystems(db));
       if (req.method === "GET" && url.pathname === "/api/assets") return sendJson(res, 200, listAssets(db));
       if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
         const asset = getAsset(db, decodeURIComponent(url.pathname.slice("/api/assets/".length)));
         return asset ? sendJson(res, 200, asset) : sendJson(res, 404, { error: "Asset not found" });
       }
       if (req.method === "GET" && url.pathname === "/api/issues") return sendJson(res, 200, listIssues(db));
       if (req.method === "GET" && url.pathname === "/api/repairs") return sendJson(res, 200, listRepairs(db));
       if (req.method === "GET" && url.pathname === "/api/charges") return sendJson(res, 200, listCharges(db));
       if (req.method === "GET" && url.pathname === "/api/purchases") return sendJson(res, 200, listPurchaseCandidates(db));
       if (req.method === "GET" && url.pathname === "/api/maintenance") return sendJson(res, 200, listMaintenance(db));
       if (req.method === "GET" && url.pathname === "/api/timeline") return sendJson(res, 200, getTimeline(db));
       if (req.method === "GET" && url.pathname === "/api/documents") return sendJson(res, 200, listDocuments(db));
       const documentDelete = /^\/api\/documents\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
       if (req.method === "DELETE" && documentDelete) {
         return sendJson(res,200,deleteDocument(db,documentDelete[1]!));
       }
       const analysisPath=url.pathname.split("/");
       if(req.method==="POST" && analysisPath.length===5 && analysisPath[1]==="api" &&
         analysisPath[2]==="documents" && analysisPath[4]==="analyze" &&
         /^[a-zA-Z0-9-]+$/.test(analysisPath[3]??"")){
         try {
           const body=await readJson(req);
           if(body.visualFrames!==undefined&&!Array.isArray(body.visualFrames))throw new DomainError("Invalid video frames.");
           return sendJson(res,200,await analyzeDocument(db,analysisPath[3]!,undefined,body.visualFrames as Array<{image:string;timeSeconds:number}>|undefined));
         }
         catch(error){
           if(error instanceof DomainError) throw error;
           console.error("Multimedia processing unavailable:",error);
           return sendJson(res,503,{error:"Multimedia analysis failed or is unavailable."});
         }
       }
       if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, listProjects(db));
       if (req.method === "GET" && url.pathname.startsWith("/api/projects/")) {
         const project = getProject(db, decodeURIComponent(url.pathname.slice("/api/projects/".length)));
         return project ? sendJson(res, 200, project) : sendJson(res, 404, { error: "Project not found" });
       }
       if (req.method === "GET" && url.pathname === "/api/transactions") return sendJson(res, 200, listTransactions(db));
       if (req.method === "GET" && url.pathname === "/api/integrations/status") {
         return sendJson(res, 200, {
           mode: "MULTI_HOME",
           storage: { provider: "TURSO" },
           ai: agentRuntime.status,
           research: agentRuntime.researchStatus,
           voice: { input: "BROWSER", output: "GROQ_ORPHEUS", outputAvailable: Boolean(agentRuntime.speechProvider) }
         });
       }

       if (req.method === "POST" && url.pathname === "/api/voice/speech") {
         const body = await readJson(req, 4096);
         if (typeof body.text !== "string" || !body.text.trim()) throw new DomainError("Speech text is required.");
         if ([...body.text.trim()].length > 200) throw new DomainError("Speech text cannot exceed 200 characters.");
         if (!agentRuntime.speechProvider) throw new DomainError("AI voice playback is unavailable.", 503);
         try {
           const audio = await agentRuntime.speechProvider.synthesize(body.text);
           securityHeaders(res);
           res.setHeader("cache-control", "no-store");
           res.setHeader("content-type", "audio/wav");
           res.setHeader("content-length", String(audio.length));
           res.writeHead(200);
           return res.end(audio);
         } catch (error) {
           console.error("Homely voice synthesis failed:", error instanceof Error ? error.name : "Unknown error");
           throw new DomainError("AI voice playback is temporarily unavailable.", 503);
         }
       }

       if (req.method === "POST" && url.pathname === "/api/agent/respond") {
         const body = await readJson(req);
         const message = String(body.message ?? "").trim();
         if (!message) throw new DomainError("Message is required.");
         if (message.length > 4000) throw new DomainError("Message is too long.");
         if (!agentRuntime.provider) {
           return sendJson(res, 503, {
             error: "Agent unavailable. Structured Homely functionality remains operational."
           });
         }

         const user=auth.requireUser(req);
         const conversationId=resolveChatConversation(db,user,typeof body.conversationId==="string"?body.conversationId:null);
         const previous=typeof body.previousResponseId==="string"&&belongsToConversation(db,user,conversationId,body.previousResponseId)
           ?body.previousResponseId:null;
         try {
           const response = await agentRuntime.provider.respond({
             message,
             userId:user.id,
             previousResponseId:previous
           });
           saveChatTurn(db,user,message,response,conversationId);
           return sendJson(res, 200, {...response,conversationId});
         } catch (error) {
           console.error("Homely agent provider failed:", error);
           return sendJson(res, 503, {
             error: "Agent temporarily unavailable. Structured Homely functionality remains operational."
           });
         }
       }

       if (req.method === "POST" && url.pathname === "/api/transactions/preview") {
         const body = await readJson(req);
         const result = proposeTransaction(db, {
           actionType: String(body.actionType ?? "") as ActionType,
           payload: (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>,
           reason: String(body.reason ?? ""),
           requestText: body.requestText === undefined ? null : String(body.requestText),
           origin: "WEB_UI"
         });
         return sendJson(res, 201, result);
       }

       const transactionMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)(?:\/(commit|reject|undo))?$/);
       if (transactionMatch) {
         const transactionId = decodeURIComponent(transactionMatch[1] ?? "");
         const operation = transactionMatch[2];

         if (req.method === "GET" && !operation) {
           const transaction = getTransaction(db, transactionId);
           return transaction
             ? sendJson(res, 200, transaction)
             : sendJson(res, 404, { error: "Transaction not found" });
         }

         if (req.method === "POST" && operation === "commit") {
           const result = commitTransaction(db, transactionId);
           if (!result) throw new DomainError("Committed transaction could not be reloaded.", 500);
           return sendJson(res, 200, result);
         }

         if (req.method === "POST" && operation === "reject") {
           const result = rejectTransaction(db, transactionId);
           if (!result) throw new DomainError("Rejected transaction could not be reloaded.", 500);
           return sendJson(res, 200, result);
         }

         if (req.method === "POST" && operation === "undo") {
           const result = undoTransaction(db, transactionId);
           return sendJson(res, 200, result);
         }
       }

       if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
       return serveStatic(res, url.pathname, req, config.publicDir);
    } catch (error) {
      if (error instanceof DomainError) {
        if(error.status===429)res.setHeader("retry-after","60");
        return sendJson(res, error.status, { error: error.message });
      }
      console.error(error);
      return sendJson(res, 500, { error: "Homely could not complete this request." });
    }
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Homely received ${signal}; closing home memory.`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      console.log(`Homely running at http://${config.host}:${config.port}`);
      resolve();
    });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error("Homely failed to start:", error);
    process.exit(1);
  });
}
