import { describe, expect, it, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  trainingVideosCollection: () => ({
    where: () => ({
      where: () => ({
        limit: () => ({
          get: getMock,
        }),
      }),
    }),
    doc: () => ({
      get: vi.fn(),
    }),
  }),
}));

import { listPublicResourceVideos } from "../../../../services/events-training/public-resources-service";

describe("listPublicResourceVideos tutorials", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("only returns tutorials with showOnResources true", async () => {
    getMock.mockResolvedValue({
      docs: [
        {
          id: "t1",
          data: () => ({
            status: "published",
            category: "tutorial",
            showOnResources: true,
            visibility: "public",
            name: "Shown",
            playbackProvider: "youtube",
            playbackUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            playbackId: "dQw4w9WgXcQ",
          }),
        },
        {
          id: "t2",
          data: () => ({
            status: "published",
            category: "tutorial",
            showOnResources: false,
            visibility: "public",
            name: "Hidden",
            playbackProvider: "youtube",
            playbackUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            playbackId: "dQw4w9WgXcQ",
          }),
        },
      ],
    });

    const result = await listPublicResourceVideos({ category: "tutorial" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("t1");
    expect(result.items[0].category).toBe("tutorial");
    expect(result.items[0].canWatch).toBe(true);
  });
});
