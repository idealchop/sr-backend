import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockBizGet = vi.fn();

function makeSubcollectionMock() {
  return {
    limit: vi.fn(() => ({ get: mockGet })),
    where: vi.fn(() => ({
      limit: vi.fn(() => ({ get: mockGet })),
    })),
  };
}

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "businesses") {
        return {
          doc: () => ({
            get: mockBizGet,
            collection: () => makeSubcollectionMock(),
            update: mockUpdate,
          }),
        };
      }
      return { doc: vi.fn() };
    }),
  },
  FieldValue: {
    serverTimestamp: () => "SERVER_TS",
  },
}));

describe("getting-started-sync-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBizGet.mockResolvedValue({
      exists: true,
      data: () => ({ gettingStarted: { addInventory: false } }),
    });
    mockGet.mockResolvedValue({ empty: true });
    mockUpdate.mockResolvedValue(undefined);
  });

  it("detects inventory when at least one item exists", async () => {
    mockGet
      .mockResolvedValueOnce({ empty: false })
      .mockResolvedValue({ empty: true });

    const { detectGettingStartedFromCollections } = await import(
      "../../services/business/getting-started-sync-service"
    );

    const detected = await detectGettingStartedFromCollections("biz-1");
    expect(detected.addInventory).toBe(true);
  });

  it("detects addOnlinePayments when payment_info has a document", async () => {
    for (let i = 0; i < 6; i += 1) {
      mockGet.mockResolvedValueOnce({ empty: true });
    }
    mockGet.mockResolvedValueOnce({ empty: false });
    mockGet.mockResolvedValue({ empty: true });

    const { detectGettingStartedFromCollections } = await import(
      "../../services/business/getting-started-sync-service"
    );

    const detected = await detectGettingStartedFromCollections("biz-1");
    expect(detected.addOnlinePayments).toBe(true);
    expect(detected.addCustomer).toBe(false);
  });

  it("sets verifyEmail when emailVerified option is true", async () => {
    const { detectGettingStartedFromCollections } = await import(
      "../../services/business/getting-started-sync-service"
    );

    const detected = await detectGettingStartedFromCollections("biz-1", {
      emailVerified: true,
    });
    expect(detected.verifyEmail).toBe(true);
  });

  it("syncGettingStartedOnBusiness patches only newly detected flags", async () => {
    mockBizGet.mockResolvedValue({
      exists: true,
      data: () => ({
        gettingStarted: { addInventory: false, addOnlinePayments: false },
      }),
    });
    for (let i = 0; i < 6; i += 1) {
      mockGet.mockResolvedValueOnce({ empty: true });
    }
    mockGet.mockResolvedValueOnce({ empty: false });
    mockGet.mockResolvedValue({ empty: true });

    const { syncGettingStartedOnBusiness } = await import(
      "../../services/business/getting-started-sync-service"
    );

    const result = await syncGettingStartedOnBusiness("biz-1");
    expect(result.updated).toBe(true);
    expect(result.patch.addOnlinePayments).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        "gettingStarted.addOnlinePayments": true,
        "updatedAt": "SERVER_TS",
      }),
    );
  });
});
