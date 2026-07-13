export type WhatsNewItemKind = "feature" | "improvement" | "enhancement" | "fix";

export type WhatsNewItem = {
  kind: WhatsNewItemKind;
  title: string;
  description: string;
};

export type WhatsNewRelease = {
  id: string;
  publishedAt: string;
  title: string;
  summary: string;
  items: WhatsNewItem[];
};

export type WhatsNewReleaseInput = {
  id: string;
  publishedAt: string;
  title: string;
  summary: string;
  items: Array<{
    kind: WhatsNewItemKind;
    title: string;
    description: string;
  }>;
};

export const WHATS_NEW_APP_DOC_ID = "smartrefill";
export const WHATS_NEW_SUBCOLLECTION = "whats_new";

const ITEM_KINDS: WhatsNewItemKind[] = [
  "feature",
  "improvement",
  "enhancement",
  "fix",
];

function isItemKind(value: unknown): value is WhatsNewItemKind {
  return typeof value === "string" && ITEM_KINDS.includes(value as WhatsNewItemKind);
}

function normalizeDateKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export function parseWhatsNewReleaseInput(raw: unknown): WhatsNewReleaseInput | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const publishedAtRaw =
    typeof row.publishedAt === "string" ? row.publishedAt.trim() : id;
  const publishedAt = normalizeDateKey(publishedAtRaw);
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  if (!id || !publishedAt || !title || !summary) return null;

  if (!Array.isArray(row.items) || row.items.length === 0) return null;
  const items: WhatsNewReleaseInput["items"] = [];
  for (const itemRaw of row.items) {
    if (!itemRaw || typeof itemRaw !== "object") return null;
    const item = itemRaw as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.description !== "string") {
      return null;
    }
    if (!isItemKind(item.kind)) return null;
    items.push({
      kind: item.kind,
      title: item.title.trim(),
      description: item.description.trim(),
    });
  }

  return { id, publishedAt, title, summary, items };
}

export function parseWhatsNewSyncBody(body: unknown): WhatsNewReleaseInput[] {
  if (!body || typeof body !== "object") return [];
  const releasesRaw = (body as { releases?: unknown }).releases;
  if (!Array.isArray(releasesRaw)) return [];
  return releasesRaw
    .map(parseWhatsNewReleaseInput)
    .filter((release): release is WhatsNewReleaseInput => release != null);
}

/** Optional Firestore doc ids to delete when syncing (e.g. superseded Jul 8–12 drafts). */
export function parseWhatsNewPruneIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { pruneIds?: unknown }).pruneIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}
