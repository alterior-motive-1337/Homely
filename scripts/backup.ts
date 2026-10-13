import fs from "node:fs";
import { once } from "node:events";
import { migrate,openDatabase } from "../src/db.js";
import { writeHomeArchive } from "../src/domain/exportHome.js";
const [homeId,outputPath]=process.argv.slice(2);
if(!homeId||!outputPath)throw new Error("Usage: npm run backup -- HOME_ID /path/backup.tar");
const db=openDatabase();migrate(db);
try{
  if(!db.prepare("SELECT id FROM homes WHERE id=?").get(homeId))throw new Error("Household not found.");
  const stream=fs.createWriteStream(outputPath,{flags:"wx",mode:0o600});
  const finished=once(stream,"finish");
  try{await writeHomeArchive(db,homeId,stream);await finished;console.log("Backup saved.")}
  catch(error){stream.destroy();await finished.catch(()=>{});throw error}
}finally{db.close()}
