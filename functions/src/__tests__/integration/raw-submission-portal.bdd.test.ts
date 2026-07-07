import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import publicRoutes from "../../routes/public-routes";

const { assertValidMock, createPendingMock, getCustomerMock } = vi.hoisted(() => ({
  assertValidMock: vi.fn(),
  createPendingMock: vi.fn(),
  getCustomerMock: vi.fn(),
}));

vi.mock("../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomer: getCustomerMock,
  },
}));

vi.mock("../../services/customers/qr-customer-service", () => ({
  QrCustomerService: {
    assertValidPortalToken: assertValidMock,
    renderQrPng: vi
      .fn()
      .mockResolvedValue(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  },
  getApiPublicBase: vi.fn(() => "https://api.test"),
  getPortalAppBase: vi.fn(() => "http://localhost:3000"),
  buildPortalDeepLink: vi.fn(),
  buildQrImageUrl: vi.fn(),
}));

vi.mock("../../services/portal/raw-submission-service", () => ({
  RawSubmissionService: {
    createPending: createPendingMock,
  },
  computeStockCheckPreview: vi.fn(),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      const mockDoc = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ businessName: "WRS Muntinlupa", name: "WRS" }),
        }),
        collection: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [] }),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        })),
      };
      if (name === "businesses") {
        return {
          doc: vi.fn(() => mockDoc),
        };
      }
      return {
        doc: vi.fn(() => mockDoc),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      };
    }),
  },
  FieldValue: { serverTimestamp: vi.fn(() => "ts") },
}));

function buildPortalApp() {
  const app = express();
  app.use(express.json());
  app.use("/public", publicRoutes);
  return app;
}

describe("Feature: Verified public QR portal", () => {
  const app = buildPortalApp();

  beforeEach(() => {
    assertValidMock.mockReset();
    createPendingMock.mockReset();
    getCustomerMock.mockReset();
    assertValidMock.mockResolvedValue({
      name: "Justfer Customer",
      qrToken: "valid-token",
      status: "active",
      qrCodeUrl: "https://api.test/public/qr.png?b=b1&c=c1&t=valid-token",
      portalDeepLink: "http://localhost:3000/order?b=b1&c=c1&t=valid-token",
    });
    getCustomerMock.mockResolvedValue({
      id: "c1",
      businessId: "b1",
      name: "Justfer Customer",
      status: "active",
      type: "residential",
      phone: "09170000000",
      address: "Manila",
      isDeliveryEnabled: true,
      isCollectionEnabled: true,
    });
    createPendingMock.mockResolvedValue({ id: "raw-sub-1" });
  });

  describe("Scenario: Customer context for greeting", () => {
    it("returns first name and business for a valid token", async () => {
      const res = await request(app).get("/public/portal/customer").query({
        b: "b1",
        c: "c1",
        t: "valid-token",
      });
      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe("Justfer");
      expect(res.body.data.businessName).toBe("WRS Muntinlupa");
      expect(assertValidMock).toHaveBeenCalledWith("b1", "c1", "valid-token");
    });
  });

  describe("Scenario: Anonymous portal submission", () => {
    it("creates pending_review when Terms are accepted", async () => {
      const res = await request(app)
        .post("/public/portal/submissions")
        .send({
          businessId: "b1",
          customerId: "c1",
          token: "valid-token",
          submissionType: "PROFILE_UPDATE",
          legalAgreed: true,
          payload: { profile: { name: "Justfer Customer" } },
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: "raw-sub-1",
        status: "pending_review",
      });
      expect(createPendingMock).toHaveBeenCalled();
    });

    it("rejects submission without legal consent", async () => {
      const res = await request(app).post("/public/portal/submissions").send({
        businessId: "b1",
        customerId: "c1",
        token: "valid-token",
        submissionType: "PROFILE_UPDATE",
        legalAgreed: false,
        payload: {},
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Terms/i);
      expect(createPendingMock).not.toHaveBeenCalled();
    });
  });
});
