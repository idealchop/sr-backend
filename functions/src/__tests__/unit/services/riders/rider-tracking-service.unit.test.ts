import { describe, it, expect, vi, beforeEach } from "vitest";
import { RiderTrackingService } from "../../../../services/riders/rider-tracking-service";

const { mockSet, mockGet, mockRiderRef } = vi.hoisted(() => {
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockGet = vi.fn();
  const mockRiderRef = {
    get: mockGet,
    set: mockSet,
  };
  return { mockSet, mockGet, mockRiderRef };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => mockRiderRef),
        })),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe("RiderTrackingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
  });

  describe("updateRiderLocation", () => {
    it("rejects invalid coordinates", async () => {
      await expect(
        RiderTrackingService.updateRiderLocation(
          "biz-1",
          "rider-1",
          "user-1",
          "owner",
          { latitude: Number.NaN, longitude: 121 },
        ),
      ).rejects.toThrow("INVALID_COORDINATES");
    });

    it("rejects when rider does not exist", async () => {
      mockGet.mockResolvedValueOnce({ exists: false });
      await expect(
        RiderTrackingService.updateRiderLocation(
          "biz-1",
          "missing",
          "user-1",
          "owner",
          { latitude: 14.4, longitude: 121.0 },
        ),
      ).rejects.toThrow("RIDER_NOT_FOUND");
    });

    it("rejects when actor is not owner/admin/linked rider", async () => {
      mockGet
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ userId: "other-user" }),
        })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            lastLocation: {
              latitude: 14.4,
              longitude: 121.0,
              updatedAt: "mock-timestamp",
            },
          }),
        });
      await expect(
        RiderTrackingService.updateRiderLocation(
          "biz-1",
          "rider-1",
          "user-1",
          "member",
          { latitude: 14.4, longitude: 121.0 },
        ),
      ).rejects.toThrow("FORBIDDEN");
    });

    it("persists lastLocation for linked rider", async () => {
      mockGet
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ userId: "user-1" }),
        })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            lastLocation: {
              latitude: 14.41,
              longitude: 121.01,
              updatedAt: "mock-timestamp",
            },
          }),
        });

      const result = await RiderTrackingService.updateRiderLocation(
        "biz-1",
        "rider-1",
        "user-1",
        "member",
        { latitude: 14.41, longitude: 121.01, accuracy: 12 },
      );

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          lastLocation: expect.objectContaining({
            latitude: 14.41,
            longitude: 121.01,
            accuracy: 12,
          }),
        }),
        { merge: true },
      );
      expect(result.latitude).toBe(14.41);
      expect(result.longitude).toBe(121.01);
    });
  });

  describe("getRiderLastLocation", () => {
    it("returns null when rider has no coordinates", async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ lastLocation: { updatedAt: "ts" } }),
      });
      const loc = await RiderTrackingService.getRiderLastLocation(
        "biz-1",
        "rider-1",
      );
      expect(loc).toBeNull();
    });

    it("returns stored coordinates", async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          lastLocation: { latitude: 14.5, longitude: 121.2, updatedAt: "ts" },
        }),
      });
      const loc = await RiderTrackingService.getRiderLastLocation(
        "biz-1",
        "rider-1",
      );
      expect(loc).toEqual({
        latitude: 14.5,
        longitude: 121.2,
        updatedAt: "ts",
      });
    });
  });
});
