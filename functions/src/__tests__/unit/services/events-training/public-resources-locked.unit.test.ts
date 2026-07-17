import { describe, expect, it, vi, beforeEach } from "vitest";

const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  trainingVideosCollection: () => ({
    where: () => ({
      where: () => ({
        limit: () => ({
          get: async () => ({ docs }),
        }),
      }),
    }),
    doc: (id: string) => ({
      get: async () => {
        const found = docs.find((d) => d.id === id);
        return {
          exists: Boolean(found),
          id,
          data: () => found?.data() ?? {},
        };
      },
    }),
  }),
}));

vi.mock("../../../../services/events-training/member-playback", () => ({
  parsePlaybackProvider: () => "youtube",
  buildEmbedUrl: ({ playbackUrl }: { playbackUrl: string }) =>
    playbackUrl ? `https://embed.test/${playbackUrl}` : null,
  resolveThumbnailUrl: () => "https://img.test/t.jpg",
}));

import { listPublicResourceVideos } from "../../../../services/events-training/public-resources-service";

describe("listPublicResourceVideos", () => {
  beforeEach(() => {
    docs.length = 0;
  });

  it("returns public watchable + locked private/premium teasers", async () => {
    docs.push(
      {
        id: "public-1",
        data: () => ({
          status: "published",
          category: "wrs_stories",
          name: "Open story",
          visibility: "public",
          featured: true,
          playbackUrl: "abc",
          recordedAt: "2026-07-10T00:00:00.000Z",
        }),
      },
      {
        id: "premium-1",
        data: () => ({
          status: "published",
          category: "wrs_stories",
          name: "Pay story",
          visibility: "premium",
          featured: false,
          priceCents: 19900,
          playbackUrl: "secret",
          recordedAt: "2026-07-09T00:00:00.000Z",
        }),
      },
      {
        id: "private-1",
        data: () => ({
          status: "published",
          category: "wrs_stories",
          name: "Member story",
          visibility: "private",
          featured: false,
          playbackUrl: "secret2",
          recordedAt: "2026-07-08T00:00:00.000Z",
        }),
      },
    );

    const result = await listPublicResourceVideos({
      category: "wrs_stories",
      pageSize: 12,
    });

    expect(result.total).toBe(3);
    expect(result.items[0]?.id).toBe("public-1");
    expect(result.items[0]?.canWatch).toBe(true);
    expect(result.items[0]?.embedUrl).toBeTruthy();
    expect(result.items[0]?.unlockAction).toBeNull();

    const premium = result.items.find((i) => i.id === "premium-1");
    expect(premium?.canWatch).toBe(false);
    expect(premium?.embedUrl).toBeNull();
    expect(premium?.unlockAction).toBe("pay");
    expect(premium?.premiumPrice).toBe(199);

    const priv = result.items.find((i) => i.id === "private-1");
    expect(priv?.canWatch).toBe(false);
    expect(priv?.embedUrl).toBeNull();
    expect(priv?.unlockAction).toBe("register");
  });
});
