export type PlaybackProvider = "youtube" | "loom" | "vimeo" | "other";

const YOUTUBE_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/,
];
const LOOM_ID_PATTERN = /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/;
const VIMEO_ID_PATTERN = /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/;

function normalizePlaybackInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const iframeSrc = trimmed.match(
    /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i,
  );
  if (iframeSrc?.[1]) return iframeSrc[1].trim();
  return trimmed;
}

function extractPlaybackId(provider: PlaybackProvider, url: string): string | null {
  const trimmed = normalizePlaybackInput(url);
  if (!trimmed) return null;

  if (provider === "youtube") {
    for (const pattern of YOUTUBE_ID_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  }
  if (provider === "loom") {
    return trimmed.match(LOOM_ID_PATTERN)?.[1] ?? null;
  }
  if (provider === "vimeo") {
    return trimmed.match(VIMEO_ID_PATTERN)?.[1] ?? null;
  }
  return null;
}

export function parsePlaybackProvider(raw: unknown): PlaybackProvider {
  if (raw === "youtube" || raw === "loom" || raw === "vimeo" || raw === "other") {
    return raw;
  }
  return "other";
}

/** Safe iframe src for published Sales Portal training videos. */
export function buildEmbedUrl(input: {
  provider: PlaybackProvider;
  playbackUrl: string;
  playbackId?: string | null;
}): string | null {
  const playbackId =
    (typeof input.playbackId === "string" && input.playbackId.trim()) ||
    extractPlaybackId(input.provider, input.playbackUrl);

  if (input.provider === "youtube" && playbackId) {
    return `https://www.youtube.com/embed/${playbackId}`;
  }
  if (input.provider === "loom" && playbackId) {
    return `https://www.loom.com/embed/${playbackId}`;
  }
  if (input.provider === "vimeo" && playbackId) {
    return `https://player.vimeo.com/video/${playbackId}`;
  }

  const normalized = normalizePlaybackInput(input.playbackUrl);
  if (/^https:\/\//i.test(normalized)) return normalized;
  return null;
}

export function resolveThumbnailUrl(input: {
  provider: PlaybackProvider;
  playbackUrl: string;
  playbackId?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  if (typeof input.thumbnailUrl === "string" && input.thumbnailUrl.trim()) {
    return input.thumbnailUrl.trim();
  }
  const id =
    (typeof input.playbackId === "string" && input.playbackId.trim()) ||
    extractPlaybackId(input.provider, input.playbackUrl);
  if (input.provider === "youtube" && id) {
    return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  }
  return null;
}
