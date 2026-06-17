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

import { computeRiderAverageRating } from "../../../../services/portal/portal-rider-track-profile";

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
