import { describe, expect, it, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: getMock,
            })),
          })),
        })),
      })),
    })),
  },
}));

import {
  clearRiderRatingCache,
  computeRiderAverageRating,
  isRecordOnlyRider,
  readStoredRiderRating,
  resolvePortalRiderTrackProfile,
  resolveRiderAverageRating,
  RIDER_RATING_CACHE_TTL_MS,
} from "../../../../services/portal/portal-rider-track-profile";

describe("isRecordOnlyRider", () => {
  it("returns true when userId is missing or blank", () => {
    expect(isRecordOnlyRider(undefined)).toBe(true);
    expect(isRecordOnlyRider({})).toBe(true);
    expect(isRecordOnlyRider({ userId: "" })).toBe(true);
    expect(isRecordOnlyRider({ userId: "   " })).toBe(true);
  });

  it("returns false when userId is linked", () => {
    expect(isRecordOnlyRider({ userId: "auth-uid-1" })).toBe(false);
  });
});

describe("resolvePortalRiderTrackProfile", () => {
  beforeEach(() => {
    clearRiderRatingCache();
    getMock.mockReset();
    getMock.mockResolvedValue({ docs: [] });
  });

  it("flags record-only riders without app login", async () => {
    const profile = await resolvePortalRiderTrackProfile(
      "biz",
      "rider-1",
      { name: "Juan", userId: "" },
    );
    expect(profile.riderIsRecordOnly).toBe(true);
    expect(profile.riderName).toBe("Juan");
  });
});

describe("computeRiderAverageRating", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("returns null when no rated transactions exist", async () => {
    getMock.mockResolvedValue({ docs: [] });
    await expect(computeRiderAverageRating("biz", "rider-1")).resolves.toBeNull();
  });

  it("averages rider and legacy star ratings", async () => {
    getMock.mockResolvedValue({
      docs: [
        { data: () => ({ riderRating: 5 }) },
        { data: () => ({ rating: 3 }) },
        { data: () => ({ serviceRating: 4 }) },
        { data: () => ({}) },
      ],
    });
    await expect(computeRiderAverageRating("biz", "rider-1")).resolves.toBe(4);
  });
});

describe("readStoredRiderRating", () => {
  it("uses avgRating / ratingStats on the rider doc", () => {
    expect(readStoredRiderRating(undefined)).toBeUndefined();
    expect(readStoredRiderRating({})).toBeUndefined();
    expect(readStoredRiderRating({ avgRating: 4.26, ratingCount: 9 })).toBe(4.3);
    expect(readStoredRiderRating({ ratingStats: { avg: 3, count: 2 } })).toBe(3);
    expect(readStoredRiderRating({ ratingCount: 0 })).toBeNull();
    expect(readStoredRiderRating({ avgRating: 9 })).toBeUndefined();
  });
});

describe("resolveRiderAverageRating (read-cost)", () => {
  beforeEach(() => {
    clearRiderRatingCache();
    getMock.mockReset();
  });

  it("does not read transactions when the rider doc stores a rating", async () => {
    await expect(
      resolveRiderAverageRating("biz", "r1", { avgRating: 4.5, ratingCount: 3 }),
    ).resolves.toBe(4.5);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("computes once then serves repeated polls from cache until TTL", async () => {
    getMock.mockResolvedValue({ docs: [{ data: () => ({ riderRating: 4 }) }] });
    const t0 = 1_000_000;
    await expect(resolveRiderAverageRating("biz", "r1", {}, t0)).resolves.toBe(4);
    await expect(resolveRiderAverageRating("biz", "r1", {}, t0 + 20_000)).resolves.toBe(4);
    await expect(resolveRiderAverageRating("biz", "r1", {}, t0 + 40_000)).resolves.toBe(4);
    expect(getMock).toHaveBeenCalledTimes(1);

    await resolveRiderAverageRating("biz", "r1", {}, t0 + RIDER_RATING_CACHE_TTL_MS + 1);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("matches the original computation when uncached", async () => {
    getMock.mockResolvedValue({
      docs: [
        { data: () => ({ riderRating: 5 }) },
        { data: () => ({ rating: 3 }) },
        { data: () => ({ serviceRating: 4 }) },
      ],
    });
    const direct = await computeRiderAverageRating("biz", "r2");
    clearRiderRatingCache();
    await expect(resolveRiderAverageRating("biz", "r2", undefined)).resolves.toBe(direct);
  });
});
