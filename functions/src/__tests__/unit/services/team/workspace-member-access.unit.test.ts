import { describe, expect, it } from "vitest";
import {
  isActiveStaffMemberForLimit,
  mergeGrantedSmartrefillAppAccess,
  WORKSPACE_ACCESS_REVOKED_MESSAGE,
  WORKSPACE_MEMBER_DEACTIVATED_MESSAGE,
} from "../../../../services/team/workspace-member-access";

describe("isActiveStaffMemberForLimit", () => {
  const ownerId = "owner-uid";

  it("counts active admin and rider members", () => {
    expect(
      isActiveStaffMemberForLimit("rider-1", { isActive: true, role: "rider" }, ownerId),
    ).toBe(true);
    expect(
      isActiveStaffMemberForLimit("admin-1", { isActive: true, role: "admin" }, ownerId),
    ).toBe(true);
  });

  it("clears revocation flags when re-granting app access on invite accept", () => {
    const rows = mergeGrantedSmartrefillAppAccess(
      [
        {
          appId: "smartrefill",
          businessId: "biz-1",
          role: "staff",
          accessRevoked: true,
          revokedAt: { seconds: 1 },
        },
      ],
      { businessId: "biz-1", role: "staff", onboardingComplete: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessRevoked).toBeUndefined();
    expect(rows[0]?.revokedAt).toBeUndefined();
    expect(rows[0]?.businessId).toBe("biz-1");
  });

  it("exports distinct login messages for revoked vs deactivated access", () => {
    expect(WORKSPACE_ACCESS_REVOKED_MESSAGE).toMatch(/no longer have access/i);
    expect(WORKSPACE_MEMBER_DEACTIVATED_MESSAGE).toMatch(/deactivated/i);
  });

  it("excludes inactive members and owner", () => {
    expect(
      isActiveStaffMemberForLimit("rider-1", { isActive: false, role: "rider" }, ownerId),
    ).toBe(false);
    expect(
      isActiveStaffMemberForLimit(ownerId, { isActive: true, role: "owner" }, ownerId),
    ).toBe(false);
    expect(
      isActiveStaffMemberForLimit("owner-doc", { isActive: true, role: "owner" }, ownerId),
    ).toBe(false);
  });
});
