import { describe, expect, it } from "vitest";

type Member = {
  id: string;
  role?: string;
  isActive?: boolean;
};

/**
 * Mirrors team-hub-service countActiveStaffMembers (owner excluded).
 * @param {Member[]} members Workspace members to count.
 * @return {number} Active non-owner member count.
 */
function countActiveStaffMembers(members: Member[]): number {
  return members.filter((m) => {
    if (m.isActive === false) return false;
    return String(m.role || "").toLowerCase() !== "owner";
  }).length;
}

describe("Team Hub staff seat usage", () => {
  it("counts only active non-owner members for the occupied side of the meter", () => {
    const members: Member[] = [
      { id: "owner", role: "owner", isActive: true },
      { id: "r1", role: "rider", isActive: true },
      { id: "a1", role: "admin", isActive: true },
      { id: "r2", role: "rider", isActive: false },
    ];
    expect(countActiveStaffMembers(members)).toBe(2);
  });
});
