import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
import * as portalTrackSearch from "../../services/portal/portal-track-search";

const trackTxDoc = {
  id: "tx-track-1",
  data: () => ({
    referenceId: "REF-TRACK-1",
    deliveryStatus: "in-transit",
    riderId: "rider-1",
    customerId: "cust-1",
    type: "refill",
    totalAmount: 500,
    balanceDue: 0,
    paymentStatus: "paid",
  }),
};

const riderActiveTxDocs = [
  trackTxDoc,
  {
    id: "tx-other-1",
    data: () => ({ deliveryStatus: "pending", riderId: "rider-1" }),
  },
];

vi.mock("../../services/riders/rider-tracking-service", () => ({
  RiderTrackingService: {
    getRiderLastLocation: vi.fn().mockResolvedValue({
      latitude: 14.4081,
      longitude: 121.0415,
      updatedAt: { toDate: () => new Date("2024-06-01T10:00:00Z") },
    }),
  },
}));

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name !== "businesses") {
        return { doc: vi.fn(), where: vi.fn().mockReturnThis(), get: vi.fn() };
      }
      return {
        doc: vi.fn(() => ({
          collection: vi.fn((sub: string) => {
            if (sub === "transactions") {
              return {
                where: vi.fn((field: string) => {
                  if (field === "referenceId") {
                    return {
                      limit: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                          empty: false,
                          docs: [trackTxDoc],
                        }),
                      })),
                    };
                  }
                  if (field === "riderId") {
                    const riderIdDocs = {
                      docs: [
                        {
                          data: () => ({ riderRating: 5 }),
                        },
                      ],
                    };
                    return {
                      get: vi.fn().mockResolvedValue({ docs: riderActiveTxDocs }),
                      limit: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue(riderIdDocs),
                      })),
                    };
                  }
                  return {
                    limit: vi.fn(() => ({
                      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
                    })),
                  };
                }),
              };
            }
            if (sub === "riders") {
              return {
                doc: vi.fn(() => ({
                  get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({
                      name: "Juan Rider",
                      phone: "09171234567",
                      photoUrl: "https://cdn.example/rider.jpg",
                      userId: "auth-rider-1",
                    }),
                  }),
                })),
              };
            }
            if (sub === "customers") {
              return {
                doc: vi.fn(() => ({
                  get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({
                      location: {
                        lat: 14.41,
                        lng: 121.02,
                        address: "Customer Home",
                      },
                    }),
                  }),
                })),
              };
            }
            if (sub === "raw_submissions") {
              const emptySubmissionSnap = { empty: true, docs: [] };
              const rawSubQuery = {
                where: vi.fn(),
                limit: vi.fn(),
                get: vi.fn().mockResolvedValue(emptySubmissionSnap),
              };
              rawSubQuery.where.mockReturnValue(rawSubQuery);
              rawSubQuery.limit.mockReturnValue(rawSubQuery);
              return rawSubQuery;
            }
            return { doc: vi.fn(), where: vi.fn().mockReturnThis() };
          }),
        })),
      };
    }),
  },
  FieldValue: { serverTimestamp: vi.fn(() => "mock-timestamp") },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = { uid: "user123" };
    next();
  }),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

describe("GET /public/portal/track/search", () => {
  it("returns 400 when business id is missing", async () => {
    const res = await request(app)
      .get("/public/portal/track/search")
      .query({ q: "justfer" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/businessId/i);
  });

  it("returns 400 when no field has 2+ characters", async () => {
    const res = await request(app)
      .get("/public/portal/track/search")
      .query({ b: "test-biz", email: "a" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one field/i);
  });

  it("passes OR filters to search service", async () => {
    const spy = vi
      .spyOn(portalTrackSearch, "searchPortalTrackOrders")
      .mockResolvedValue([]);

    await request(app)
      .get("/public/portal/track/search")
      .query({
        b: "test-biz",
        name: "Justfer Himbing",
        email: "justfer15@gmail.com",
      });

    expect(spy).toHaveBeenCalledWith(
      "test-biz",
      expect.objectContaining({
        name: "Justfer Himbing",
        email: "justfer15@gmail.com",
      }),
      25,
      undefined,
    );
    spy.mockRestore();
  });

  it("returns search rows from service (email-only query)", async () => {
    const spy = vi
      .spyOn(portalTrackSearch, "searchPortalTrackOrders")
      .mockResolvedValue([
        {
          transactionId: "tx-search-1",
          referenceId: "REF-SEARCH-1",
          type: "delivery",
          typeLabel: "Delivery",
          refillLabel: "Refill ×1",
          assetLabel: "D",
          scheduledAt: "2026-05-10T08:00:00.000Z",
          status: "in-transit",
          customerName: "Justfer",
          source: "transaction",
        },
      ]);

    const res = await request(app)
      .get("/public/portal/track/search")
      .query({ b: "test-biz", email: "justfer@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].referenceId).toBe("REF-SEARCH-1");
    expect(res.body.data[0].assetLabel).toBe("D");
    spy.mockRestore();
  });
});

describe("GET /public/portal/track/:referenceId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rider location, destination, and other active stops", async () => {
    const res = await request(app)
      .get("/public/portal/track/REF-TRACK-1")
      .query({ b: "test-biz" });

    expect(res.status).toBe(200);
    expect(res.body.data.referenceId).toBe("REF-TRACK-1");
    expect(res.body.data.status).toBe("in-transit");
    expect(res.body.data.riderName).toBe("Juan Rider");
    expect(res.body.data.riderPhone).toBe("09171234567");
    expect(res.body.data.riderPhotoUrl).toBe("https://cdn.example/rider.jpg");
    expect(res.body.data.riderAvgRating).toBe(5);
    expect(res.body.data.riderIsRecordOnly).toBe(false);
    expect(res.body.data.riderLocation).toMatchObject({
      latitude: 14.4081,
      longitude: 121.0415,
    });
    expect(res.body.data.destination).toMatchObject({
      latitude: 14.41,
      longitude: 121.02,
      address: "Customer Home",
    });
    expect(res.body.data.riderOtherActiveStops).toBe(1);
  });

  it("returns 400 when business id is missing", async () => {
    const res = await request(app).get("/public/portal/track/REF-TRACK-1");
    expect(res.status).toBe(400);
  });
});

describe("Feature: Public order tracking (BDD)", () => {
  it("Scenario: Customer tracks in-transit order with live rider GPS", async () => {
    const res = await request(app)
      .get("/public/portal/track/REF-TRACK-1")
      .query({ b: "test-biz" });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("transaction");
    expect(res.body.data.riderLocation).toBeTruthy();
    expect(res.body.data.riderOtherActiveStops).toBeGreaterThanOrEqual(0);
  });
});
