import { describe, expect, it } from "vitest";

import {
  buildEmbedUrl,
  parsePlaybackProvider,
  resolveThumbnailUrl,
} from "../../../../services/events-training/member-playback";

describe("member-playback", () => {
  it("builds youtube and loom embed urls", () => {
    expect(
      buildEmbedUrl({
        provider: "youtube",
        playbackUrl: "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");

    expect(
      buildEmbedUrl({
        provider: "loom",
        playbackUrl: "https://www.loom.com/share/abc123",
      }),
    ).toBe("https://www.loom.com/embed/abc123");
  });

  it("parses provider and thumbnail fallback", () => {
    expect(parsePlaybackProvider("youtube")).toBe("youtube");
    expect(parsePlaybackProvider("nope")).toBe("other");
    expect(
      resolveThumbnailUrl({
        provider: "youtube",
        playbackUrl: "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
});
