import { describe, expect, it } from "vitest";
import { parsePlanLimitations } from "../../../utils/subscription-addon-plan-limits";
import {
  applyStaffSeatAddonBoosts,
  computeStaffSeatLimitFromRoleQuotas,
} from "../../../utils/staff-seat-limit";
import { isActiveStaffMemberForLimit } from "../../../services/team/workspace-member-access";

describe("staff seat limit (owner excluded)", () => {
  it("computes staff cap as rider + admin without an owner slot", () => {
    const quotas = parsePlanLimitations({ staff: { rider: 1, admin: 2 } });
    expect(quotas).not.toBeNull();
    if (quotas === null) {
      throw new Error("expected plan limitations");
    }
    const cap = computeStaffSeatLimitFromRoleQuotas(
      quotas.staffRiderMax ?? 0,
      quotas.staffAdminMax ?? 0,
    );
    expect(cap).toBe(3);
  });

  it("adds staff rider/admin add-on boosts to the base cap", () => {
    const base = computeStaffSeatLimitFromRoleQuotas(1, 0);
    expect(applyStaffSeatAddonBoosts(base, 1, 0)).toBe(2);
  });

  it("does not count the owner toward occupied staff seats", () => {
    const ownerId = "owner-uid";
    expect(
      isActiveStaffMemberForLimit(ownerId, { isActive: true, role: "owner" }, ownerId),
    ).toBe(false);
    expect(
      isActiveStaffMemberForLimit("admin-1", { isActive: true, role: "admin" }, ownerId),
    ).toBe(true);
  });
});
