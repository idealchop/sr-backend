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
  computeRiderAverageRating,
  isRecordOnlyRider,
  resolvePortalRiderTrackProfile,
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
