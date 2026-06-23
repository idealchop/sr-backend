import { describe, expect, it, vi, beforeEach } from "vitest";

const batchSet = vi.fn();
const batchCommit = vi.fn().mockResolvedValue(undefined);
const appDocSet = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    batch: () => ({
      set: batchSet,
      commit: batchCommit,
    }),
    collection: (name: string) => ({
      doc: (id: string) => ({
        collection: (sub: string) => ({
          doc: (releaseId: string) => ({
            path: `${name}/${id}/${sub}/${releaseId}`,
          }),
        }),
        set: appDocSet,
      }),
    }),
  },
  FieldValue: {
    serverTimestamp: () => "SERVER_TS",
  },
}));

import { syncWhatsNewReleases } from "../../../../services/platform/whats-new-sync-service";
import { parseWhatsNewSyncBody } from "../../../../services/platform/whats-new-types";

describe("whats-new sync", () => {
  beforeEach(() => {
    batchSet.mockClear();
    batchCommit.mockClear();
    appDocSet.mockClear();
  });

  it("parses valid sync body", () => {
    const releases = parseWhatsNewSyncBody({
      releases: [
        {
          id: "2026-06-19",
          publishedAt: "2026-06-19",
          title: "Ops hub",
          summary: "Analytics updates",
          items: [
            {
              kind: "feature",
              title: "Revenue trend",
              description: "Sparkline in Operations hub.",
            },
          ],
        },
      ],
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]?.id).toBe("2026-06-19");
  });

  it("writes releases under apps/smartrefill/whats_new", async () => {
    const result = await syncWhatsNewReleases([
      {
        id: "2026-06-19",
        publishedAt: "2026-06-19",
        title: "Ops hub",
        summary: "Analytics updates",
        items: [
          {
            kind: "feature",
            title: "Revenue trend",
            description: "Sparkline in Operations hub.",
          },
        ],
      },
    ]);

    expect(result.written).toBe(1);
    expect(result.appId).toBe("smartrefill");
    expect(batchSet).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(appDocSet).toHaveBeenCalledTimes(1);
  });
});
