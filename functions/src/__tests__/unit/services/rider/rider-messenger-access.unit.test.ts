import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request } from "express";
import { canManageRiderMessengerLink } from "../../../../services/rider/rider-messenger-access";

vi.mock("../../../../services/riders/rider-service", () => ({
  RiderService: {
    getRiderByUserId: vi.fn(),
  },
}));

import { RiderService } from "../../../../services/riders/rider-service";

function mockReq(role: string, uid: string, businessId = "biz-1"): Request {
  return {
    params: { businessId },
    user: { uid },
    businessRole: role,
  } as unknown as Request;
}

describe("canManageRiderMessengerLink", () => {
  beforeEach(() => {
    vi.mocked(RiderService.getRiderByUserId).mockReset();
  });

  it("allows owner for any rider", async () => {
    const allowed = await canManageRiderMessengerLink(mockReq("owner", "uid-owner"), "rider-1");
    expect(allowed).toBe(true);
  });

  it("allows app rider for own profile only", async () => {
    vi.mocked(RiderService.getRiderByUserId).mockResolvedValue({
      id: "rider-1",
      businessId: "biz-1",
      userId: "uid-rider",
      name: "Juan",
      phone: "0917",
      status: "active",
    });
    const allowed = await canManageRiderMessengerLink(mockReq("rider", "uid-rider"), "rider-1");
    expect(allowed).toBe(true);
  });

  it("denies app rider for another rider profile", async () => {
    vi.mocked(RiderService.getRiderByUserId).mockResolvedValue({
      id: "rider-1",
      businessId: "biz-1",
      userId: "uid-rider",
      name: "Juan",
      phone: "0917",
      status: "active",
    });
    const allowed = await canManageRiderMessengerLink(mockReq("rider", "uid-rider"), "rider-2");
    expect(allowed).toBe(false);
  });
});
