import { describe, expect, it } from "vitest";
import {
  countAttachmentKinds,
  isSupportAttachmentMime,
  isSupportVideoMime,
  normalizeAttachmentMime,
} from "../../../../services/support/support-attachment-media";

describe("support-attachment-media", () => {
  it("detects video mime from file extension", () => {
    expect(normalizeAttachmentMime(undefined, "screen.mp4")).toBe("video/mp4");
    expect(isSupportVideoMime("video/mp4")).toBe(true);
    expect(isSupportAttachmentMime("video/webm")).toBe(true);
  });

  it("counts images and videos separately", () => {
    const counts = countAttachmentKinds([
      { url: "https://x/a.jpg", mimeType: "image/jpeg" },
      { url: "https://x/b.mp4", fileName: "b.mp4" },
    ]);
    expect(counts).toEqual({ images: 1, videos: 1 });
  });
});
