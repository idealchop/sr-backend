import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  upsertPortalTrackLiveForRider,
  syncPortalTrackLiveOnDeliveryStatus,
  clearPortalTrackLive,
} from "../../../../services/portal/portal-track-live-service";

const {
  mockBatchSet,
  mockBatchCommit,
  mockLiveDocSet,
  mockLiveDocDelete,
  mockTxGet,
  mockRiderGet,
} = vi.hoisted(() => {
  const mockBatchSet = vi.fn();
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
  const mockLiveDocSet = vi.fn().mockResolvedValue(undefined);
  const mockLiveDocDelete = vi.fn().mockResolvedValue(undefined);
  const mockTxGet = vi.fn();
  const mockRiderGet = vi.fn();

  return {
    mockBatchSet,
    mockBatchCommit,
    mockLiveDocSet,
    mockLiveDocDelete,
    mockTxGet,
    mockRiderGet,
  };
});

vi.mock("../../../../config/firebase-admin", () => {
  const liveDocRef = {
    set: mockLiveDocSet,
    delete: mockLiveDocDelete,
  };
  const ridersDocRef = { get: mockRiderGet };
  const transactionsCollection = { where: vi.fn().mockReturnThis(), get: mockTxGet };
  const portalTrackLiveCollection = { doc: vi.fn(() => liveDocRef) };
  const ridersCollection = { doc: vi.fn(() => ridersDocRef) };

  return {
    db: {
      batch: vi.fn(() => ({
        set: mockBatchSet,
        commit: mockBatchCommit,
      })),
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn((name: string) => {
            if (name === "transactions") return transactionsCollection;
            if (name === "portal_track_live") return portalTrackLiveCollection;
            if (name === "riders") return ridersCollection;
            return { doc: vi.fn(() => liveDocRef) };
          }),
        })),
      })),
    },
    FieldValue: {
      serverTimestamp: vi.fn(() => "mock-ts"),
    },
  };
});

vi.mock("firebase-functions", () => ({
  logger: { warn: vi.fn() },
}));

describe("portal-track-live-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts live docs for in-transit transactions", async () => {
    mockTxGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        { data: () => ({ referenceId: "TX-001" }) },
        { data: () => ({ referenceId: "" }) },
        { data: () => ({ referenceId: "TX-002" }) },
      ],
    });

    await upsertPortalTrackLiveForRider("biz-1", "rider-1", {
      latitude: 14.4,
      longitude: 121.0,
    });

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it("seeds live doc with rider coordinates when status becomes in-transit", async () => {
    mockRiderGet.mockResolvedValueOnce({
      data: () => ({
        lastLocation: { latitude: 14.5, longitude: 121.1 },
      }),
    });

    await syncPortalTrackLiveOnDeliveryStatus("biz-1", {
      referenceId: "TX-ABC",
      riderId: "rider-1",
      deliveryStatus: "in-transit",
    });

    expect(mockLiveDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: "TX-ABC",
        riderId: "rider-1",
        latitude: 14.5,
        longitude: 121.1,
      }),
      { merge: true },
    );
  });

  it("clears live doc when delivery leaves in-transit", async () => {
    await syncPortalTrackLiveOnDeliveryStatus("biz-1", {
      referenceId: "TX-ABC",
      riderId: "rider-1",
      deliveryStatus: "delivered",
    });

    expect(mockLiveDocDelete).toHaveBeenCalled();
    expect(mockLiveDocSet).not.toHaveBeenCalled();
  });

  it("clearPortalTrackLive deletes by reference id", async () => {
    await clearPortalTrackLive("biz-1", "TX-ABC");
    expect(mockLiveDocDelete).toHaveBeenCalled();
  });
});
