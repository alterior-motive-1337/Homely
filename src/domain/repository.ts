import type { HomelyDatabase } from "../db.js";
import { deriveAssetHealth, deriveSystemHealth, type HealthState, type Severity } from "./health.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function healthForAsset(db: HomelyDatabase, assetId: string, observedAt: unknown): HealthState {
  const severities = db.prepare(
    `SELECT severity FROM issues
     WHERE asset_id = ? AND status IN ('OPEN','MONITORING','PLANNED','IN_PROGRESS')`
  ).all(assetId).map((row) => String(row.severity) as Severity);

  const overdue = db.prepare(
    `SELECT 1 AS hit FROM maintenance_rules
     WHERE asset_id = ? AND active = 1 AND next_due_at < ? LIMIT 1`
  ).get(assetId, todayIso());

  return deriveAssetHealth({
    activeSeverities: severities,
    hasOverdueMaintenance: Boolean(overdue),
    hasObservation: Boolean(observedAt)
  });
}

export function getHome(db: HomelyDatabase) {
  return db.prepare("SELECT * FROM homes ORDER BY created_at LIMIT 1").get() ?? null;
}

export function listAssets(db: HomelyDatabase) {
  const rows = db.prepare(
    `SELECT a.*, s.name AS system_name, s.category AS system_category
     FROM assets a JOIN systems s ON s.id = a.system_id
     ORDER BY s.position, a.name`
  ).all();

  return rows.map((row) => ({
    ...row,
    health: healthForAsset(db, String(row.id), row.health_observed_at)
  }));
}

export function listSystems(db: HomelyDatabase) {
  return db.prepare("SELECT * FROM systems ORDER BY position, name").all().map((system) => {
    const assets = db.prepare("SELECT id, health_observed_at FROM assets WHERE system_id = ? ORDER BY name")
      .all(String(system.id));
    const states = assets.map((asset) => healthForAsset(db, String(asset.id), asset.health_observed_at));
    return { ...system, health: deriveSystemHealth(states), asset_count: assets.length };
  });
}

export function getAsset(db: HomelyDatabase, assetId: string) {
  const asset = db.prepare(
    `SELECT a.*, s.name AS system_name, s.category AS system_category
     FROM assets a JOIN systems s ON s.id = a.system_id WHERE a.id = ?`
  ).get(assetId);
  if (!asset) return null;

  return {
    ...asset,
    health: healthForAsset(db, assetId, asset.health_observed_at),
    issues: db.prepare("SELECT * FROM issues WHERE asset_id = ? ORDER BY detected_at DESC").all(assetId),
    maintenance: db.prepare("SELECT * FROM maintenance_rules WHERE asset_id = ? ORDER BY next_due_at").all(assetId),
    documents: db.prepare("SELECT * FROM documents WHERE asset_id = ? ORDER BY created_at DESC").all(assetId),
    history: db.prepare("SELECT * FROM timeline_events WHERE asset_id = ? ORDER BY occurred_at DESC LIMIT 30").all(assetId)
  };
}

export function listIssues(db: HomelyDatabase) {
  return db.prepare(
    `SELECT i.*, a.name AS asset_name, s.name AS system_name
     FROM issues i JOIN assets a ON a.id = i.asset_id JOIN systems s ON s.id = a.system_id
     ORDER BY CASE i.status WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'MONITORING' THEN 3 ELSE 4 END,
       i.detected_at DESC`
  ).all();
}

export function listMaintenance(db: HomelyDatabase) {
  const today = todayIso();
  return db.prepare(
    `SELECT m.*, a.name AS asset_name, s.name AS system_name,
      CASE WHEN m.next_due_at < ? THEN 'OVERDUE'
           WHEN m.next_due_at <= date(?, '+30 day') THEN 'UPCOMING'
           ELSE 'SCHEDULED' END AS due_state
     FROM maintenance_rules m
     JOIN assets a ON a.id = m.asset_id JOIN systems s ON s.id = a.system_id
     WHERE m.active = 1 ORDER BY m.next_due_at`
  ).all(today, today);
}

export function listDocuments(db: HomelyDatabase) {
  return db.prepare(`
    SELECT d.*, a.name AS asset_name, s.name AS system_name, i.title AS issue_title
    FROM documents d
    LEFT JOIN assets a ON a.id = d.asset_id
    LEFT JOIN systems s ON s.id = a.system_id
    LEFT JOIN issues i ON i.id = d.issue_id
    ORDER BY d.created_at DESC, d.title
  `).all();
}

export function getTimeline(db: HomelyDatabase, limit = 80) {
  return db.prepare(
    `SELECT t.*, a.name AS asset_name
     FROM timeline_events t LEFT JOIN assets a ON a.id = t.asset_id
     ORDER BY t.occurred_at DESC LIMIT ?`
  ).all(limit);
}

export function getOverview(db: HomelyDatabase) {
  const home = getHome(db);
  const systems = listSystems(db);
  const today = todayIso();

  const activeIssues = db.prepare(
    `SELECT i.id, i.title, i.severity, i.status, i.detected_at,
       a.id AS asset_id, a.name AS asset_name, s.name AS system_name
     FROM issues i JOIN assets a ON a.id = i.asset_id JOIN systems s ON s.id = a.system_id
     WHERE i.status IN ('OPEN','MONITORING','PLANNED','IN_PROGRESS')
     ORDER BY CASE i.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
       i.detected_at DESC`
  ).all();

  const overdue = db.prepare(
    `SELECT m.id, m.title, m.next_due_at, a.id AS asset_id, a.name AS asset_name, s.name AS system_name,
       CAST(julianday(?) - julianday(m.next_due_at) AS INTEGER) AS days_overdue
     FROM maintenance_rules m JOIN assets a ON a.id = m.asset_id JOIN systems s ON s.id = a.system_id
     WHERE m.active = 1 AND m.next_due_at < ? ORDER BY m.next_due_at`
  ).all(today, today);

  const upcoming = db.prepare(
    `SELECT m.id, m.title, m.next_due_at, a.id AS asset_id, a.name AS asset_name, s.name AS system_name,
       CAST(julianday(m.next_due_at) - julianday(?) AS INTEGER) AS days_until
     FROM maintenance_rules m JOIN assets a ON a.id = m.asset_id JOIN systems s ON s.id = a.system_id
     WHERE m.active = 1 AND m.next_due_at >= ? AND m.next_due_at <= date(?, '+30 day')
     ORDER BY m.next_due_at`
  ).all(today, today, today);

  return {
    home,
    systems,
    summary: {
      systems_needing_attention: systems.filter((s) => ["FAILED","DEGRADED","ATTENTION"].includes(String(s.health))).length,
      open_issues: activeIssues.length,
      overdue_maintenance: overdue.length
    },
    attention: { issues: activeIssues, maintenance: overdue },
    upcoming,
    recent: getTimeline(db, 6)
  };
}


export function listProjects(db: HomelyDatabase) {
  return db.prepare(`
    SELECT *
    FROM projects
    ORDER BY
      CASE status
        WHEN 'ACTIVE' THEN 1
        WHEN 'PLANNED' THEN 2
        WHEN 'PAUSED' THEN 3
        WHEN 'COMPLETE' THEN 4
        ELSE 5
      END,
      COALESCE(target_date, '9999-12-31'),
      created_at DESC
  `).all();
}

export function getProject(db: HomelyDatabase, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return null;
  return {
    ...project,
    history: db.prepare(
      "SELECT * FROM timeline_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 30"
    ).all(projectId)
  };
}
