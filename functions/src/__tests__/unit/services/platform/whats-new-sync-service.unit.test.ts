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

  it("parses June 2026 ledger payment release payload", () => {
    const releases = parseWhatsNewSyncBody({
      releases: [
        {
          id: "2026-06-25",
          publishedAt: "2026-06-25",
          title: "Ledger payment methods & expense fixes",
          summary: "Payment sublines and Total Net breakdown.",
          items: [
            {
              kind: "fix",
              title: "Expense payment method saves correctly",
              description: "BIP/GCash selection persists on save.",
            },
            {
              kind: "improvement",
              title: "Total Net by payment source",
              description: "Cash ₱194 · BIP ₱252 on one line.",
            },
          ],
        },
      ],
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]?.items).toHaveLength(2);
    expect(releases[0]?.items[0]?.kind).toBe("fix");
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
