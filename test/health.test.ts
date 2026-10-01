import assert from "node:assert/strict";
import test from "node:test";
import { deriveAssetHealth, deriveSystemHealth } from "../src/domain/health.js";

test("critical unresolved issue makes asset failed", () => {
  assert.equal(deriveAssetHealth({activeSeverities:["CRITICAL"],hasOverdueMaintenance:false,hasObservation:true}), "FAILED");
});
test("high unresolved issue makes asset degraded", () => {
  assert.equal(deriveAssetHealth({activeSeverities:["HIGH"],hasOverdueMaintenance:false,hasObservation:true}), "DEGRADED");
});
test("overdue maintenance creates attention", () => {
  assert.equal(deriveAssetHealth({activeSeverities:[],hasOverdueMaintenance:true,hasObservation:true}), "ATTENTION");
});
test("unobserved clean asset is unknown", () => {
  assert.equal(deriveAssetHealth({activeSeverities:[],hasOverdueMaintenance:false,hasObservation:false}), "UNKNOWN");
});
test("system health reflects worst asset", () => {
  assert.equal(deriveSystemHealth(["HEALTHY","UNKNOWN","ATTENTION"]), "ATTENTION");
});
