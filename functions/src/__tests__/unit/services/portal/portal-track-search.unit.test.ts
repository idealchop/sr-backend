import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildRefillAndAsset,
  contactMatchesFilters,
  humanTypeLabel,
  searchPortalTrackOrders,
} from "../../../../services/portal/portal-track-search";

const { mockCustomersGet, mockTxGet, mockSubGet } = vi.hoisted(() => ({
  mockCustomersGet: vi.fn(),
  mockTxGet: vi.fn(),
  mockSubGet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name !== "businesses") {
        return { doc: vi.fn(), where: vi.fn().mockReturnThis(), get: vi.fn() };
      }
      return {
        doc: vi.fn(() => ({
          collection: vi.fn((sub: string) => {
            if (sub === "customers") {
              const customersChain = {
                where: vi.fn(() => customersChain),
                limit: vi.fn(() => ({
                  get: mockCustomersGet,
                })),
                get: mockCustomersGet,
              };
              return customersChain;
            }
            if (sub === "transactions") {
              const chain = {
                where: vi.fn(() => chain),
                orderBy: vi.fn(() => chain),
                limit: vi.fn(() => ({
                  get: mockTxGet,
                })),
              };
              return chain;
            }
            if (sub === "raw_submissions") {
              const chain = {
                where: vi.fn(() => chain),
                limit: vi.fn(() => ({
                  get: mockSubGet,
                })),
              };
              return chain;
            }
            return { doc: vi.fn(), where: vi.fn().mockReturnThis() };
          }),
        })),
      };
    }),
  },
}));

describe("portal-track-search helpers", () => {
  it("humanTypeLabel maps known transaction types", () => {
    expect(humanTypeLabel("delivery")).toBe("Delivery");
    expect(humanTypeLabel("collection")).toBe("Collection");
    expect(humanTypeLabel("walkin")).toBe("Sale");
  });

  it("buildRefillAndAsset returns D for delivery dispatch only", () => {
    const row = buildRefillAndAsset({
      type: "delivery",
      waterRefills: [{ quantity: 2 }],
      items: [{ id: "jug" }],
    });
    expect(row.assetLabel).toBe("D");
    expect(row.refillLabel).toBe("Refill ×2");
  });

  it("contactMatchesFilters uses OR across fields (email only)", () => {
    const customer = {
      name: "Justfer Himbing",
      email: "justfer15@gmail.com",
    };
    expect(
      contactMatchesFilters(customer, { email: "justfer15@gmail.com" }),
    ).toBe(true);
    expect(contactMatchesFilters(customer, { name: "Justfer" })).toBe(true);
    expect(contactMatchesFilters(customer, { company: "Acme" })).toBe(false);
  });

  it("contactMatchesFilters matches Philippine phone variants", () => {
    const customer = { phone: "+63 935 606 0735" };
    expect(contactMatchesFilters(customer, { phone: "09356060735" })).toBe(
      true,
    );
    expect(contactMatchesFilters(customer, { phone: "9356060735" })).toBe(true);
  });

  it("contactMatchesFilters reads raw_submission payload.profile", () => {
    const submission = {
      payload: {
        profile: {
          name: "Portal Guest",
          email: "guest@test.com",
        },
      },
    };
    expect(
      contactMatchesFilters(submission, { email: "guest@test.com" }),
    ).toBe(true);
  });
});

describe("searchPortalTrackOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomersGet.mockResolvedValue({
      docs: [
        {
          id: "cust-1",
          data: () => ({
            name: "Justfer Himbing",
            email: "justfer15@gmail.com",
            phone: "09171234567",
          }),
        },
      ],
    });
    mockTxGet.mockResolvedValue({
      docs: [
        {
          id: "tx-open-1",
          data: () => ({
            referenceId: "REF-OPEN-1",
            type: "delivery",
            deliveryStatus: "in-transit",
            customerName: "Justfer Himbing",
            scheduledAt: "2026-05-10T08:00:00.000Z",
            waterRefills: [{ quantity: 1 }],
          }),
        },
      ],
    });
    mockSubGet.mockResolvedValue({
      docs: [
        {
          id: "sub-pending-1",
          data: () => ({
            referenceId: "TX-260519-ABCD",
            submissionType: "PLACE_ORDER",
            transactionType: "delivery",
            status: "pending_review",
            customerId: "cust-1",
            payload: {
              profile: { name: "Justfer Himbing", email: "justfer15@gmail.com" },
              waterRefills: [{ quantity: 2 }],
            },
          }),
        },
      ],
    });
  });

  it("throws QUERY_TOO_SHORT when no field has 2+ characters", async () => {
    await expect(searchPortalTrackOrders("biz-1", { name: "a" })).rejects.toThrow(
      "QUERY_TOO_SHORT",
    );
  });

  it("matches by email only without requiring name", async () => {
    const rows = await searchPortalTrackOrders("biz-1", {
      email: "justfer15@gmail.com",
    });
    expect(rows.some((r) => r.referenceId === "REF-OPEN-1")).toBe(true);
  });

  it("includes pending raw_submissions", async () => {
    const rows = await searchPortalTrackOrders("biz-1", {
      email: "justfer15@gmail.com",
    });
    const sub = rows.find((r) => r.referenceId === "TX-260519-ABCD");
    expect(sub).toMatchObject({
      source: "submission",
      status: "pending",
      typeLabel: "Delivery",
    });
  });

  it("scopes to portal customerId when provided", async () => {
    mockCustomersGet.mockResolvedValue({ docs: [] });
    mockTxGet.mockResolvedValue({
      docs: [
        {
          id: "tx-scoped",
          data: () => ({
            referenceId: "REF-SCOPED",
            customerId: "cust-portal",
            type: "delivery",
            deliveryStatus: "in-transit",
            customerName: "Portal User",
          }),
        },
      ],
    });
    const rows = await searchPortalTrackOrders(
      "biz-1",
      { phone: "09" },
      25,
      "cust-portal",
    );
    expect(rows.some((r) => r.referenceId === "REF-SCOPED")).toBe(true);
  });
});
