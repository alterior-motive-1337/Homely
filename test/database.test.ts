import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { createTestDatabase } from "./helpers.js";

test("missing Turso credentials stop startup before creating any database", () => {
  let called = false;
  const factory = () => { called = true; throw new Error("must not connect"); };
  for (const connection of [{ url: "", authToken: "" }, { url: "libsql://home.turso.io", authToken: "" }, { url: "", authToken: "token" }]) {
    assert.throws(() => openDatabase(connection, factory), /Turso is required/);
  }
  assert.equal(called, false);
});

test("local-file URLs cannot bypass the required Turso connection", () => {
  for (const url of ["file:home.db", "http://localhost:8080", ":memory:"]) {
    assert.throws(() => openDatabase({ url, authToken: "token" }), /remote|valid/);
  }
});

test("failed Turso synchronization closes the replica and never falls back", () => {
  const db = createTestDatabase(); let closed = false;
  assert.throws(() => openDatabase({ url: "libsql://home.turso.io", authToken: "test-only" }, () => ({
    ...db, prepare: db.prepare.bind(db), exec: db.exec.bind(db),
    sync() { throw new Error("Turso unreachable"); },
    close() { closed = true; db.close(); }
  })), /Turso unreachable/);
  assert.equal(closed, true);
});

test("database results contain data columns without libSQL query metadata", () => {
  const db = createTestDatabase();
  try {
    assert.deepEqual(db.prepare("SELECT 42 AS answer").get(), { answer: 42 });
    assert.deepEqual(db.prepare("SELECT 42 AS answer").all(), [{ answer: 42 }]);
  } finally { db.close(); }
});
