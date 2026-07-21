import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { getPortalBusinessProfile } from "../../../handlers/portal/portal-public-handler";

vi.mock("../../../services/portal/portal-business-profile-service", () => ({
  PortalBusinessProfileService: {
    getPublicProfile: vi.fn(),
  },
}));

vi.mock("../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { PortalBusinessProfileService } from "../../../services/portal/portal-business-profile-service";

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("getPortalBusinessProfile", () => {
  beforeEach(() => {
    vi.mocked(PortalBusinessProfileService.getPublicProfile).mockReset();
  });

  it("returns 400 when business id is missing", async () => {
    const req = { query: {} } as Request;
    const res = mockRes();
    await getPortalBusinessProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns profile data for a valid business id", async () => {
    vi.mocked(PortalBusinessProfileService.getPublicProfile).mockResolvedValue({
      businessName: "Aqua Station",
      businessLogo: null,
      businessBanner: null,
      phone: "09171234567",
      address: "BF Homes",
      location: { latitude: 14.4, longitude: 121.0 },
      ratings: { average: 4.2, count: 8 },
      feedback: { items: [], page: 1, pageSize: 5, total: 8, totalPages: 2 },
    });

    const req = { query: { b: "biz-1", page: "1", pageSize: "5" } } as unknown as Request;
    const res = mockRes();
    await getPortalBusinessProfile(req, res);

    expect(PortalBusinessProfileService.getPublicProfile).toHaveBeenCalledWith({
      businessId: "biz-1",
      page: 1,
      pageSize: 5,
    });
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessName: "Aqua Station" }),
    });
  });

  it("returns 404 when station is not found", async () => {
    vi.mocked(PortalBusinessProfileService.getPublicProfile).mockResolvedValue(null);
    const req = { query: { b: "missing" } } as unknown as Request;
    const res = mockRes();
    await getPortalBusinessProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
