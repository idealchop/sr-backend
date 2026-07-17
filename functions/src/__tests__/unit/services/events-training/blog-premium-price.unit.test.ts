import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));

import { resolvePremiumUnlockPrice } from "../../../../services/events-training/member-video-unlock-service";

describe("resolvePremiumUnlockPrice (CMS priceCents / unlockPrice)", () => {
  it("prefers priceCents (Sales Portal integer cents) over unlockPrice", () => {
    expect(
      resolvePremiumUnlockPrice({
        priceCents: 14900,
        unlockPrice: 99,
      }),
    ).toBe(149);
  });

  it("falls back to unlockPrice when priceCents missing or zero", () => {
    expect(resolvePremiumUnlockPrice({ unlockPrice: 75 })).toBe(75);
    expect(
      resolvePremiumUnlockPrice({
        priceCents: 0,
        unlockPrice: 120,
      }),
    ).toBe(120);
  });

  it("defaults to ₱99 when no price fields", () => {
    expect(resolvePremiumUnlockPrice({})).toBe(99);
  });

  it("accepts pricePhp / price aliases", () => {
    expect(resolvePremiumUnlockPrice({ pricePhp: 88 })).toBe(88);
    expect(resolvePremiumUnlockPrice({ price: 55.5 })).toBe(55.5);
  });
});

const blogDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  wrsBlogsCollection: () => ({
    where: () => ({
      limit: () => ({
        get: async () => ({ docs: blogDocs }),
      }),
    }),
    limit: () => ({
      get: async () => ({ docs: blogDocs }),
    }),
    doc: (id: string) => ({
      get: async () => {
        const found = blogDocs.find((d) => d.id === id);
        return {
          exists: Boolean(found),
          id,
          data: () => found?.data() ?? {},
        };
      },
    }),
  }),
}));

import { listPublicWrsBlogs } from "../../../../services/events-training/public-blogs-service";

describe("listPublicWrsBlogs premium priceCents", () => {
  beforeEach(() => {
    blogDocs.length = 0;
  });

  it("surfaces premiumPrice from priceCents and locks body", async () => {
    blogDocs.push({
      id: "blog-premium",
      data: () => ({
        status: "published",
        appId: "smartrefill",
        title: "Paid article",
        slug: "paid-article",
        excerpt: "Teaser",
        body: "<p>Secret body</p>",
        visibility: "premium",
        priceCents: 14900,
        unlockPrice: 149,
        featured: true,
        publishedAt: "2026-07-15T00:00:00.000Z",
        authorName: "Soak",
        tags: [],
      }),
    });

    const result = await listPublicWrsBlogs({ pageSize: 12 });
    expect(result.total).toBe(1);
    const item = result.items[0];
    expect(item?.canRead).toBe(false);
    expect(item?.bodyHtml).toBeNull();
    expect(item?.unlockAction).toBe("pay");
    expect(item?.premiumPrice).toBe(149);
  });
});
