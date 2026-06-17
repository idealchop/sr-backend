import type { GeminiContentPart } from "../ai/gemini-multimodal";
import type { SupportMessageAttachment } from "./support-chat-types";

import { SUPPORT_VIDEO_MAX_BYTES } from "./support-chat-media-limits";

export const MAX_SUPPORT_ATTACHMENTS = 4;
export const MAX_SUPPORT_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_SUPPORT_VIDEO_BYTES = SUPPORT_VIDEO_MAX_BYTES;
export const MAX_VIDEOS_PER_MESSAGE = 1;

const IMAGE_MIMES = new Set([
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/gif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/3gpp",
  "video/mpeg",
]);

export function normalizeAttachmentMime(
  mimeType?: string,
  fileName?: string,
): string {
  const raw = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (raw) return raw;
  const ext = (fileName || "").split(".").pop()?.toLowerCase();
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "3gp") return "video/3gpp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return raw;
}

export function isSupportImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

export function isSupportVideoMime(mime: string): boolean {
  return VIDEO_MIMES.has(mime);
}

export function isSupportAttachmentMime(mime: string): boolean {
  return isSupportImageMime(mime) || isSupportVideoMime(mime);
}

export async function fetchUrlAsBuffer(
  url: string,
  maxBytes: number,
): Promise<{ mime: string; buffer: Buffer } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    const ct = res.headers.get("content-type") || "application/octet-stream";
    const mime = ct.split(";")[0].trim().toLowerCase();
    return { mime, buffer: buf };
  } catch {
    return null;
  }
}

export async function fetchAttachmentForGemini(
  att: SupportMessageAttachment,
): Promise<GeminiContentPart | null> {
  const declared = normalizeAttachmentMime(att.mimeType, att.fileName);
  const fetched = await fetchUrlAsBuffer(
    att.url,
    isSupportVideoMime(declared) || declared.startsWith("video/") ?
      MAX_SUPPORT_VIDEO_BYTES :
      MAX_SUPPORT_IMAGE_BYTES,
  );
  if (!fetched) return null;

  const mime = isSupportAttachmentMime(fetched.mime) ?
    fetched.mime :
    isSupportAttachmentMime(declared) ?
      declared :
      null;
  if (!mime) return null;

  return {
    inline_data: {
      mime_type: mime,
      data: fetched.buffer.toString("base64"),
    },
  };
}

export function countAttachmentKinds(
  attachments: SupportMessageAttachment[],
): { images: number; videos: number } {
  let images = 0;
  let videos = 0;
  for (const att of attachments) {
    const mime = normalizeAttachmentMime(att.mimeType, att.fileName);
    if (isSupportVideoMime(mime)) videos += 1;
    else if (isSupportImageMime(mime)) images += 1;
  }
  return { images, videos };
}
