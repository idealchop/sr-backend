import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com", name: "Test Owner" };
    next();
  }),
}));

vi.mock("../../middleware/business-middleware", () => ({
  validateBusinessAccess: vi.fn((req: any, res: any, next: any) => next()),
  requireBusinessOwner: vi.fn((req: any, res: any, next: any) => next()),
}));

vi.mock("../../services/subscriptions/subscription-service", () => ({
  SubscriptionService: {
    getSubscriptionStatus: vi.fn(),
  },
}));

vi.mock("../../services/team/team-hub-service", () => ({
  getTeamHubOverview: vi.fn(),
  createTeamInvite: vi.fn(),
}));

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          data: () => ({ name: "WRS Muntinlupa" }),
        }),
      })),
    })),
  },
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

import { SubscriptionService } from "../../services/subscriptions/subscription-service";
import {
  getTeamHubOverview,
  createTeamInvite,
} from "../../services/team/team-hub-service";

describe("Feature: Team Hub Management Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario: Workspace Owner accesses Team Hub and invites staff", () => {
    it("Step 1: Given the business has an active premium subscription", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "premium",
        billingCycle: "monthly",
        status: "active",
      });
    });

    it("Step 2: When the owner requests the Team Hub overview", async () => {
      (getTeamHubOverview as any).mockResolvedValue({
        members: [{ id: "user123", role: "owner" }],
        pendingInvites: [],
        staffLimit: 5,
        currentStaffCount: 1,
      });

      const res = await request(app).get("/business/test-biz-123/team");
      expect(res.status).toBe(200);
      expect(res.body.data.staffLimit).toBe(5);
      expect(res.body.data.currentStaffCount).toBe(1);
    });

    it("Step 3: And the owner sends an invite to a new staff member", async () => {
      (createTeamInvite as any).mockResolvedValue({
        ok: true,
        inviteId: "inv-12345",
      });

      const res = await request(app)
        .post("/business/test-biz-123/team/invites")
        .send({
          inviteeEmail: "newstaff@test.com",
          inviteeName: "New Staff",
          role: "rider",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.inviteId).toBe("inv-12345");
    });
  });

  describe("Scenario: Team Hub access is denied for Starter plans", () => {
    it("Step 1: Given the business has a starter plan", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "starter",
        billingCycle: "monthly",
        status: "active",
      });
    });

    it("Step 2: When the owner tries to access the Team Hub overview", async () => {
      const res = await request(app).get("/business/test-biz-123/team");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not available on the Starter plan/i);
    });
  });
});
