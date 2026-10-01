import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { HomelyDatabase } from "../db.js";
import { config } from "../config.js";
import { GoogleDriveIntegration, type DriveBackupMetadata } from "./googleDrive.js";

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function verifyDatabase(filePath: string): void {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    const result = String(row?.integrity_check ?? "");
    if (result !== "ok") throw new Error(`SQLite integrity check failed: ${result || "unknown result"}`);
  } finally {
    db.close();
  }
}

export class DriveBackupService {
  private queue: Promise<unknown> = Promise.resolve();
  private interval: NodeJS.Timeout | null = null;
  private lastBackupAt: string | null = null;
  private lastRestoreAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly drive: GoogleDriveIntegration) {}

  get status() {
    return {
      enabled: config.backupEnabled,
      required: config.backupRequired,
      provider: "google-drive",
      connected: this.drive.status.connected,
      intervalMinutes: config.backupIntervalMinutes,
      retention: config.backupRetention,
      lastBackupAt: this.lastBackupAt,
      lastRestoreAt: this.lastRestoreAt,
      lastError: this.lastError
    };
  }

  assertReady(): void {
    if (!config.backupEnabled) {
      if (config.backupRequired) throw new Error("BACKUP_REQUIRED=true requires BACKUP_ENABLED=true.");
      return;
    }

    if (!this.drive.status.available || !this.drive.status.connected) {
      const message = "Drive backups are enabled but Google Drive credentials are not ready.";
      if (config.backupRequired) throw new Error(message);
      console.warn(message);
    }
  }

  async restoreIfDatabaseMissing(): Promise<DriveBackupMetadata | null> {
    if (fs.existsSync(config.dbPath) || !config.backupEnabled) return null;
    this.assertReady();
    if (!this.drive.status.connected) return null;

    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    const candidatePath = config.dbPath + ".candidate";
    if (fs.existsSync(candidatePath)) fs.rmSync(candidatePath, { force: true });

    try {
      const restored = await this.drive.downloadLatestBackup(candidatePath);
      if (!restored) return null;
      verifyDatabase(candidatePath);
      fs.renameSync(candidatePath, config.dbPath);
      this.lastRestoreAt = new Date().toISOString();
      this.lastError = null;
      console.log(`Homely restored SQLite state from Drive backup ${restored.name}.`);
      return restored;
    } catch (error) {
      if (fs.existsSync(candidatePath)) fs.rmSync(candidatePath, { force: true });
      this.lastError = error instanceof Error ? error.message : "Restore failed.";
      throw error;
    }
  }

  backupNow(db: HomelyDatabase, reason = "scheduled"): Promise<DriveBackupMetadata | null> {
    const task = this.queue.then(async () => {
      if (!config.backupEnabled) return null;
      this.assertReady();
      if (!this.drive.status.connected) return null;

      const backupDir = path.join(path.dirname(config.dbPath), ".backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const fileName = `homely-${safeTimestamp()}.db`;
      const localPath = path.join(backupDir, fileName);

      try {
        await backup(db, localPath);
        verifyDatabase(localPath);
        const uploaded = await this.drive.uploadBackup(localPath, fileName);
        await this.drive.pruneBackups(config.backupRetention);
        this.lastBackupAt = new Date().toISOString();
        this.lastError = null;
        console.log(`Homely backup uploaded to Drive (${reason}): ${uploaded.name}.`);
        return uploaded;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Backup failed.";
        console.error("Homely Drive backup failed:", this.lastError);
        if (config.backupRequired) throw error;
        return null;
      } finally {
        if (fs.existsSync(localPath)) fs.rmSync(localPath, { force: true });
      }
    });

    this.queue = task.catch(() => undefined);
    return task;
  }

  startPeriodic(db: HomelyDatabase): void {
    if (!config.backupEnabled || this.interval) return;
    const milliseconds = config.backupIntervalMinutes * 60_000;
    this.interval = setInterval(() => {
      void this.backupNow(db, "periodic");
    }, milliseconds);
    this.interval.unref();
  }

  stopPeriodic(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }
}
