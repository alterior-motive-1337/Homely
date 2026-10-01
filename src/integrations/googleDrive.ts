import fs from "node:fs";
import path from "node:path";
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

export class GoogleDriveIntegration {
  get status() {
    const configured = Boolean(config.googleClientId && config.googleClientSecret && config.googleDriveRedirectUri);
    const connected = configured && fs.existsSync(config.googleDriveTokenPath);
    return {
      enabled: config.googleDriveEnabled,
      configured,
      connected,
      available: config.googleDriveEnabled && configured,
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
    if (!fs.existsSync(config.googleDriveTokenPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(config.googleDriveTokenPath, "utf8")) as Credentials;
    } catch {
      throw new DomainError("Stored Google Drive credentials are unreadable.", 500);
    }
  }

  private saveCredentials(credentials: Credentials): void {
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

  disconnect(): void {
    if (fs.existsSync(config.googleDriveTokenPath)) fs.rmSync(config.googleDriveTokenPath);
  }
}
