import { Exa } from "exa-js";
import { config } from "../config.js";

export type ResearchPurpose = "LOCAL_SERVICE" | "PRODUCT" | "GENERAL";
type JsonRecord = Record<string, unknown>;

function clip(value: unknown, max = 4000): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export class HomeResearch {
  private readonly readableUrls = new Set<string>();

  constructor(private readonly exa: Pick<Exa, "search" | "getContents"> | null =
    config.exaApiKey ? new Exa(config.exaApiKey) : null) {}

  get status() {
    return {
      exa: { configured: Boolean(this.exa) },
      available: Boolean(this.exa)
    };
  }

  async search(input: {
    query: string;
    purpose?: ResearchPurpose;
    location?: string | null;
    maxResults?: number;
  }) {
    if (!this.exa) throw new Error("Exa search is not configured.");

    const query = input.query.trim();
    if (!query) throw new Error("Search query is required.");
    const purpose = input.purpose ?? "GENERAL";
    const location = input.location?.trim() || null;
    if (purpose === "LOCAL_SERVICE" && !location) {
      throw new Error("A user-supplied location is required for local service search.");
    }

    const scopedQuery = location ? query + " " + location : query;
    const maxResults = Math.max(1, Math.min(8, Number(input.maxResults ?? 5) || 5));
    const response = await this.exa.search(scopedQuery, {
      type: "auto",
      numResults: maxResults,
      contents: { highlights: true }
    });

    const results = response.results.slice(0, maxResults).map((raw: unknown) => {
      const row = raw as unknown as JsonRecord;
      const url = clip(row.url, 1500);
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:") this.readableUrls.add(parsed.toString());
      } catch { /* Invalid result URLs are not eligible for reading. */ }
      while (this.readableUrls.size > 256) this.readableUrls.delete(this.readableUrls.values().next().value!);
      return {
        title: clip(row.title, 300),
        url,
        publishedDate: row.publishedDate ? clip(row.publishedDate, 80) : null,
        author: row.author ? clip(row.author, 200) : null,
        highlights: Array.isArray(row.highlights)
          ? row.highlights.map((item) => clip(item, 1200)).slice(0, 4)
          : []
      };
    });

    return { query: scopedQuery, purpose, location, results };
  }

  async readSearchResult(urlValue: string) {
    if (!this.exa) throw new Error("Exa search is not configured.");

    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new Error("A valid page URL is required.");
    }
    if (parsed.protocol !== "https:" || !this.readableUrls.has(parsed.toString())) {
      throw new Error("The page must be an HTTPS result returned by Homely search in this session.");
    }

    const result = await this.exa.getContents([parsed.toString()], {
      text: { maxCharacters: 14000 }
    });
    const row = result.results[0];
    if (!row?.text) throw new Error("This search result has no readable page content.");

    return {
      url: parsed.toString(),
      text: clip(row.text, 14000),
      title: clip(row.title, 300),
      publishedDate: row.publishedDate ?? null
    };
  }
}

