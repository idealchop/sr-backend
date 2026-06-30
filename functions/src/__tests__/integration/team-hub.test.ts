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
  createRecordOnlyRiderForHub: vi.fn(),
  deleteRecordOnlyRiderFromHub: vi.fn(),
  setTeamMemberActiveStatus: vi.fn(),
  removeTeamMember: vi.fn(),
}));

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          data: () => ({ name: "Mock Business" }),
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
  createRecordOnlyRiderForHub,
  deleteRecordOnlyRiderFromHub,
  removeTeamMember,
  setTeamMemberActiveStatus,
} from "../../services/team/team-hub-service";

describe("Team Hub API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/team", () => {
    it("should return team hub overview for eligible subscriptions", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "premium",
        billingCycle: "monthly",
        status: "active",
      });
      (getTeamHubOverview as any).mockResolvedValue({
        members: [],
        pendingInvites: [],
        recordOnlyRiders: [],
        staffLimit: 5,
        currentStaffCount: 1,
      });

      const res = await request(app).get("/business/test-biz/team");

      expect(res.status).toBe(200);
      expect(res.body.data.staffLimit).toBe(5);
    });

    it("should return 403 for starter plan", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "starter",
        billingCycle: "monthly",
        status: "active",
      });

      const res = await request(app).get("/business/test-biz/team");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Starter plan/i);
    });

    it("should return 403 for trial period", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "premium",
        billingCycle: "trial",
        status: "active",
      });

      const res = await request(app).get("/business/test-biz/team");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/trial period/i);
    });

    it("should return 403 for inactive subscriptions", async () => {
      (SubscriptionService.getSubscriptionStatus as any).mockResolvedValue({
        planCode: "premium",
        billingCycle: "monthly",
        status: "expired",
      });

      const res = await request(app).get("/business/test-biz/team");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/active subscription/i);
    });
  });

  describe("PATCH /business/:businessId/team/members/:memberId", () => {
    it("should update member active status", async () => {
      (setTeamMemberActiveStatus as any).mockResolvedValue({ ok: true });

      const res = await request(app)
        .patch("/business/test-biz/team/members/member-1")
        .type("json")
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(setTeamMemberActiveStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          memberId: "member-1",
          isActive: false,
        }),
      );
    });

    it("should return 400 when isActive is missing or not a boolean", async () => {
      const missing = await request(app)
        .patch("/business/test-biz/team/members/member-1")
        .type("json")
        .send({});

      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe("isActive must be a boolean");
      expect(setTeamMemberActiveStatus).not.toHaveBeenCalled();

      const invalid = await request(app)
        .patch("/business/test-biz/team/members/member-1")
        .type("json")
        .send({ isActive: "true" });

      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe("isActive must be a boolean");
      expect(setTeamMemberActiveStatus).not.toHaveBeenCalled();
    });

    it("should surface seat limit errors on reactivation", async () => {
      (setTeamMemberActiveStatus as any).mockResolvedValue({
        ok: false,
        status: 400,
        message: "All admin seats are in use.",
      });

      const res = await request(app)
        .patch("/business/test-biz/team/members/member-1")
        .type("json")
        .send({ isActive: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/admin seats/i);
    });
  });

  describe("DELETE /business/:businessId/team/members/:memberId", () => {
    it("should remove a team member and revoke workspace access", async () => {
      (removeTeamMember as any).mockResolvedValue({ ok: true });

      const res = await request(app)
        .delete("/business/test-biz/team/members/member-1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(removeTeamMember).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          memberId: "member-1",
        }),
      );
    });
  });

  describe("POST /business/:businessId/team/invites", () => {
    it("should create team invite successfully", async () => {
      (createTeamInvite as any).mockResolvedValue({
        ok: true,
        inviteId: "invite-123",
      });

      const res = await request(app)
        .post("/business/test-biz/team/invites")
        .send({
          inviteeEmail: "staff@test.com",
          inviteeName: "Staff User",
          role: "rider",
        });

      expect(res.status).toBe(201);
      expect(res.body.inviteId).toBe("invite-123");
      expect(createTeamInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          inviteeEmail: "staff@test.com",
          role: "rider",
        }),
      );
    });

    it("should return 400 for invalid role", async () => {
      const res = await request(app)
        .post("/business/test-biz/team/invites")
        .send({
          inviteeEmail: "staff@test.com",
          role: "invalid-role",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/role must be/i);
      expect(createTeamInvite).not.toHaveBeenCalled();
    });

    it("should handle service errors gracefully", async () => {
      (createTeamInvite as any).mockResolvedValue({
        ok: false,
        status: 409,
        message: "User is already a member",
      });

      const res = await request(app)
        .post("/business/test-biz/team/invites")
        .send({
          inviteeEmail: "staff@test.com",
          role: "rider",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("User is already a member");
    });
  });

  describe("POST /business/:businessId/team/records", () => {
    it("should create a record-only rider", async () => {
      (createRecordOnlyRiderForHub as any).mockResolvedValue({
        ok: true,
        rider: {
          id: "rider-record-1",
          name: "Juan",
          phone: "09123456789",
          photoUrl: null,
          role: "rider",
          status: "active",
        },
      });

      const res = await request(app)
        .post("/business/test-biz/team/records")
        .send({ name: "Juan", phone: "09123456789", role: "rider" });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("rider-record-1");
      expect(createRecordOnlyRiderForHub).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          name: "Juan",
          phone: "09123456789",
          role: "rider",
        }),
      );
    });

    it("should return 400 when name is missing", async () => {
      const res = await request(app)
        .post("/business/test-biz/team/records")
        .send({ phone: "09123456789" });

      expect(res.status).toBe(400);
      expect(createRecordOnlyRiderForHub).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /business/:businessId/team/records/:riderId", () => {
    it("should remove a record-only rider", async () => {
      (deleteRecordOnlyRiderFromHub as any).mockResolvedValue({ ok: true });

      const res = await request(app).delete(
        "/business/test-biz/team/records/rider-record-1",
      );

      expect(res.status).toBe(200);
      expect(deleteRecordOnlyRiderFromHub).toHaveBeenCalledWith({
        businessId: "test-biz",
        riderId: "rider-record-1",
      });
    });
  });
});
