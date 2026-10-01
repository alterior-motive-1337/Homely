import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { google, type drive_v3 } from "googleapis";
import type { Credentials } from "google-auth-library";
import { config } from "../config.js";
import { DomainError } from "../domain/transactions.js";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  size: string | null;
}

export interface DriveBackupMetadata {
  id: string;
  name: string;
  createdTime: string | null;
  size: string | null;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class GoogleDriveIntegration {
  get status() {
    const configured = Boolean(config.googleClientId && config.googleClientSecret && config.googleDriveRedirectUri);
    const tokenOnDisk = fs.existsSync(config.googleDriveTokenPath);
    const connected = configured && Boolean(config.googleDriveRefreshToken || tokenOnDisk);
    return {
      enabled: config.googleDriveEnabled,
      configured,
      connected,
      available: config.googleDriveEnabled && configured,
      credentialSource: config.googleDriveRefreshToken ? "ENVIRONMENT" : tokenOnDisk ? "LOCAL_FILE" : "NONE",
      scope: DRIVE_FILE_SCOPE
    };
  }

  private oauth() {
    if (!this.status.configured) {
      throw new DomainError("Google Drive is not configured.", 503);
    }
    return new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleDriveRedirectUri
    );
  }

  private readStoredCredentials(): Credentials | null {
    let stored: Credentials = {};
    if (fs.existsSync(config.googleDriveTokenPath)) {
      try {
        stored = JSON.parse(fs.readFileSync(config.googleDriveTokenPath, "utf8")) as Credentials;
      } catch {
        throw new DomainError("Stored Google Drive credentials are unreadable.", 500);
      }
    }

    if (config.googleDriveRefreshToken) {
      return { ...stored, refresh_token: config.googleDriveRefreshToken };
    }

    return Object.keys(stored).length ? stored : null;
  }

  private saveCredentials(credentials: Credentials): void {
    if (config.googleDriveRefreshToken) {
      // Cloud mode keeps the long-lived refresh token in the platform secret store.
      // Short-lived access tokens remain process-local and can be reacquired after restart.
      return;
    }

    fs.mkdirSync(path.dirname(config.googleDriveTokenPath), { recursive: true });
    fs.writeFileSync(config.googleDriveTokenPath, JSON.stringify(credentials, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    try { fs.chmodSync(config.googleDriveTokenPath, 0o600); } catch {}
  }

  getAuthorizationUrl(): string {
    if (!this.status.enabled) throw new DomainError("Google Drive integration is disabled.", 503);
    const oauth = this.oauth();
    const url = new URL(oauth.generateAuthUrl({
      access_type: "offline",
      scope: [DRIVE_FILE_SCOPE],
      include_granted_scopes: true,
      prompt: this.status.connected ? undefined : "consent"
    }));
    url.searchParams.set("trigger_onepick", "true");
    return url.toString();
  }

  async exchangeCode(code: string): Promise<void> {
    if (!this.status.enabled) throw new DomainError("Google Drive integration is disabled.", 503);
    if (config.googleDriveRefreshToken) {
      throw new DomainError("Google Drive credentials are managed by the cloud secret store.", 409);
    }

    const oauth = this.oauth();
    const existing = this.readStoredCredentials();
    const { tokens } = await oauth.getToken(code);
    this.saveCredentials({
      ...existing,
      ...tokens,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token
    });
  }

  private authorizedDrive(): drive_v3.Drive {
    if (!this.status.enabled) throw new DomainError("Google Drive integration is disabled.", 503);
    const credentials = this.readStoredCredentials();
    if (!credentials) throw new DomainError("Google Drive is not connected.", 401);
    const oauth = this.oauth();
    oauth.setCredentials(credentials);
    oauth.on("tokens", (tokens) => {
      if (config.googleDriveRefreshToken) return;
      const current = this.readStoredCredentials() ?? {};
      this.saveCredentials({
        ...current,
        ...tokens,
        refresh_token: tokens.refresh_token ?? current.refresh_token
      });
    });
    return google.drive({ version: "v3", auth: oauth });
  }

  async getSelectedFiles(fileIds: string[]): Promise<DriveFileMetadata[]> {
    const ids = [...new Set(fileIds.map((id) => id.trim()).filter(Boolean))].slice(0, 10);
    if (!ids.length) return [];
    const drive = this.authorizedDrive();

    return Promise.all(ids.map(async (fileId) => {
      const response = await drive.files.get({
        fileId,
        fields: "id,name,mimeType,modifiedTime,webViewLink,size"
      });
      const file = response.data;
      if (!file.id || !file.name) throw new DomainError("Selected Drive file metadata is incomplete.", 502);
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType ?? null,
        modifiedTime: file.modifiedTime ?? null,
        webViewLink: file.webViewLink ?? null,
        size: file.size ?? null
      };
    }));
  }

  async readTextFile(fileId: string): Promise<{ mimeType: string; text: string }> {
    const drive = this.authorizedDrive();
    const metadata = await drive.files.get({ fileId, fields: "id,mimeType,name" });
    const mimeType = metadata.data.mimeType ?? "application/octet-stream";

    if (mimeType === "application/vnd.google-apps.document") {
      const exported = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" }
      );
      return { mimeType: "text/plain", text: String(exported.data) };
    }

    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      const downloaded = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );
      return { mimeType, text: String(downloaded.data) };
    }

    throw new DomainError("This Drive file type is not text-readable yet.", 415);
  }

  private async backupFolderId(): Promise<string> {
    const drive = this.authorizedDrive();
    const folderName = config.googleDriveBackupFolder;
    const query = [
      "trashed = false",
      "mimeType = 'application/vnd.google-apps.folder'",
      `name = '${escapeDriveQuery(folderName)}'`,
      "appProperties has { key='homelyRole' and value='backup-folder' }"
    ].join(" and ");

    const existing = await drive.files.list({
      q: query,
      pageSize: 1,
      fields: "files(id,name)"
    });

    const existingId = existing.data.files?.[0]?.id;
    if (existingId) return existingId;

    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { homelyRole: "backup-folder" }
      },
      fields: "id"
    });

    if (!created.data.id) throw new DomainError("Drive backup folder could not be created.", 502);
    return created.data.id;
  }

  async uploadBackup(filePath: string, fileName: string): Promise<DriveBackupMetadata> {
    const drive = this.authorizedDrive();
    const folderId = await this.backupFolderId();
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        appProperties: { homelyRole: "sqlite-backup" }
      },
      media: {
        mimeType: "application/vnd.sqlite3",
        body: fs.createReadStream(filePath)
      },
      fields: "id,name,createdTime,size"
    });

    const file = response.data;
    if (!file.id || !file.name) throw new DomainError("Drive backup upload returned incomplete metadata.", 502);
    return {
      id: file.id,
      name: file.name,
      createdTime: file.createdTime ?? null,
      size: file.size ?? null
    };
  }

  async listBackups(limit = 100): Promise<DriveBackupMetadata[]> {
    const drive = this.authorizedDrive();
    const folderId = await this.backupFolderId();
    const response = await drive.files.list({
      q: [
        "trashed = false",
        `'${folderId}' in parents`,
        "appProperties has { key='homelyRole' and value='sqlite-backup' }"
      ].join(" and "),
      orderBy: "createdTime desc",
      pageSize: Math.max(1, Math.min(100, limit)),
      fields: "files(id,name,createdTime,size)"
    });

    return (response.data.files ?? [])
      .filter((file): file is typeof file & { id: string; name: string } => Boolean(file.id && file.name))
      .map((file) => ({
        id: file.id,
        name: file.name,
        createdTime: file.createdTime ?? null,
        size: file.size ?? null
      }));
  }

  async downloadLatestBackup(destinationPath: string): Promise<DriveBackupMetadata | null> {
    const [latest] = await this.listBackups(1);
    if (!latest) return null;

    const drive = this.authorizedDrive();
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const temporaryPath = destinationPath + ".restore";
    const response = await drive.files.get(
      { fileId: latest.id, alt: "media" },
      { responseType: "stream" }
    );

    try {
      await pipeline(response.data, fs.createWriteStream(temporaryPath));
      fs.renameSync(temporaryPath, destinationPath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    return latest;
  }

  async pruneBackups(keep: number): Promise<number> {
    const backups = await this.listBackups(100);
    const remove = backups.slice(Math.max(1, keep));
    const drive = this.authorizedDrive();
    for (const backup of remove) {
      await drive.files.delete({ fileId: backup.id });
    }
    return remove.length;
  }

  disconnect(): void {
    if (fs.existsSync(config.googleDriveTokenPath)) fs.rmSync(config.googleDriveTokenPath);
  }
}
