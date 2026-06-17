/** Max support-chat screen recording size (upload + Gemini inline fetch). */
export const SUPPORT_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const SUPPORT_VIDEO_MAX_MB = 30;

export function supportVideoSizeError(): string {
  return `Video must be ${SUPPORT_VIDEO_MAX_MB} MB or smaller.`;
}
