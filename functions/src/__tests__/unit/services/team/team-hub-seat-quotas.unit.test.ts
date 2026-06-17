import { describe, expect, it } from "vitest";
import { filterAssignableRolesBySeatQuotas } from "../../../../services/team/team-hub-service";
import {
  applyAddonBoostsToQuotas,
  emptyAddonLimitBoosts,
} from "../../../../utils/subscription-addon-limit-boosts";
import { parsePlanLimitations } from "../../../../utils/subscription-addon-plan-limits";

describe("team hub seat quotas with add-ons", () => {
  const growRiderRole = [{ value: "rider", label: "Rider / Operator" }];

  it("blocks rider invites when base rider cap is full without add-ons", () => {
    const quotas = parsePlanLimitations({ staff: { rider: 1, admin: 0 } });
    const roles = filterAssignableRolesBySeatQuotas(growRiderRole, quotas, 0, 1);
    expect(roles).toHaveLength(0);
  });

  it("allows another rider invite when rider add-on boosts the cap", () => {
    const base = parsePlanLimitations({ staff: { rider: 1, admin: 0 } });
    const quotas = applyAddonBoostsToQuotas(base, {
      ...emptyAddonLimitBoosts(),
      staffRider: 1,
    });
    const roles = filterAssignableRolesBySeatQuotas(growRiderRole, quotas, 0, 1);
    expect(roles).toHaveLength(1);
    expect(roles[0]?.value).toBe("rider");
  });
});
