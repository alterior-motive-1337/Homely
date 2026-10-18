import assert from "node:assert/strict";
import test from "node:test";
import { migrate, type HomelyDatabase } from "../src/db.js";
import { listAssets, listSystems } from "../src/domain/repository.js";
import { seedDemo } from "../src/seed.js";
import { createTestDatabase } from "./helpers.js";

test("asset and system health reads stay batched as household records grow", () => {
  const database = createTestDatabase();
  migrate(database);
  seedDemo(database);

  let preparedStatements = 0;
  const measured: HomelyDatabase = {
    exec: (sql) => database.exec(sql),
    close: () => database.close(),
    prepare(sql) {
      preparedStatements += 1;
      return database.prepare(sql);
    }
  };

  try {
    assert.equal(listAssets(measured).length, 16);
    assert.equal(preparedStatements, 3, "asset health uses one list query and two aggregate health queries");

    preparedStatements = 0;
    assert.equal(listSystems(measured).length, 7);
    assert.equal(preparedStatements, 4, "system health uses fixed-count queries, not a query per asset");
  } finally {
    database.close();
  }
});
