import { migrate,openDatabase } from "../src/db.js";
import { restoreHomeArchive } from "../src/domain/restoreHome.js";
const [archivePath,ownerId]=process.argv.slice(2);
if(!archivePath||!ownerId)throw new Error("Usage: npm run restore -- /path/backup.tar EXISTING_OWNER_USER_ID");
const db=openDatabase();migrate(db);
try{console.log(JSON.stringify(restoreHomeArchive(db,archivePath,ownerId)))}finally{db.close()}
