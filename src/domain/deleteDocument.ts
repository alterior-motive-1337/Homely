import { randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";
import { activeHomeId } from "../security/homeScope.js";
import { DomainError } from "./transactions.js";

export function deleteDocument(db: HomelyDatabase, documentId: string) {
  const homeId = activeHomeId() ?? "";
  const document = db.prepare(
    "SELECT * FROM documents WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)"
  ).get(documentId,homeId);
  if (!document) throw new DomainError("File not found.",404);

  const transactionId = `tx-${randomUUID()}`;
  const changeId = `chg-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const rowHomeId = String(document.home_id);

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`INSERT INTO transactions(
      id,action_type,status,reason,origin,payload_json,created_at,approved_at,committed_at,home_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      transactionId,"DELETE_DOCUMENT","COMMITTED",`Removed file from Homely: ${String(document.title)}`,
      "WEB_UI",JSON.stringify({documentId}),createdAt,createdAt,createdAt,rowHomeId
    );
    db.prepare(`INSERT INTO transaction_changes(
      id,transaction_id,entity_type,entity_id,operation,before_json,after_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      changeId,transactionId,"document",documentId,"DELETE",JSON.stringify(document),null,createdAt
    );
    const result = db.prepare(
      "DELETE FROM documents WHERE id=? AND home_id=?"
    ).run(documentId,rowHomeId);
    if (result.changes !== 1) throw new DomainError("File changed before it could be removed.",409);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return {deleted:true};
}
