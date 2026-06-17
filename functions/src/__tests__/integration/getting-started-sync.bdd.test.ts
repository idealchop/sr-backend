import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com", email_verified: true };
    next();
  }),
}));

vi.mock("../../middleware/business-middleware", () => ({
  validateBusinessAccess: vi.fn((_req: any, _res: any, next: any) => next()),
  requireBusinessOwner: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../services/business/getting-started-sync-service", () => ({
  syncGettingStartedOnBusiness: vi.fn(),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

import { syncGettingStartedOnBusiness } from "../../services/business/getting-started-sync-service";

describe("Feature: Getting started sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /business/:businessId/getting-started/sync returns merged checklist", async () => {
    (syncGettingStartedOnBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({
      gettingStarted: {
        verifyEmail: true,
        addPaymentAccount: true,
        addInventory: false,
        addCustomer: false,
        addDelivery: false,
        addCollection: false,
        addWalkin: false,
        addExpense: false,
        useAi: false,
      },
      updated: true,
      patch: { addPaymentAccount: true },
    });

    const res = await request(app)
      .get("/business/biz-1/getting-started/sync")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.data.gettingStarted.addPaymentAccount).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.patch).toEqual({ addPaymentAccount: true });
    expect(syncGettingStartedOnBusiness).toHaveBeenCalledWith("biz-1", {
      emailVerified: true,
    });
  });
});
