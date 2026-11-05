import { beforeEach, describe, expect, it, vi } from "vitest";

const { sets, provision, link, onboard } = vi.hoisted(() => ({
  onboard: vi.fn(async () => undefined),
  sets: [] as Array<{ path: string; data: Record<string, unknown> }>,
  provision: vi.fn(),
  link: vi.fn(),
}));

function ref(path: string): Record<string, unknown> {
  return {
    path,
    set: async (data: Record<string, unknown>) => {
      sets.push({ path, data });
    },
    collection: (c: string) => col(`${path}/${c}`),
  };
}
function col(path: string) {
  return {
    doc: (id: string) => ref(`${path}/${id}`),
    where: () => ({ limit: () => ({ get: async () => ({ docs: [{ ref: ref(`${path}/r1`) }] }) }) }),
  };
}

vi.mock("../../../../config/firebase-admin", () => ({ db: { collection: (c: string) => col(c) } }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }));
vi.mock("../../../../services/team/team-hub-service", () => ({
  createProvisionedTeamMemberForHub: provision,
}));
vi.mock("../../../../services/team/team-staff-link-service", () => ({ createStaffLink: link }));
vi.mock("../../../../services/team/team-invite-accept-service", () => ({
  completeStaffOnboarding: onboard,
}));

import {
  addLinkStaffMember,
  isLinkStaffEmail,
} from "../../../../services/team/team-add-staff-service";

beforeEach(() => {
  sets.length = 0;
  provision.mockReset();
  link.mockReset();
});

describe("addLinkStaffMember", () => {
  it("requires a name", async () => {
    const r = await addLinkStaffMember({ businessId: "b", ownerUid: "o", name: "  " });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(provision).not.toHaveBeenCalled();
  });

  it("provisions a rider with a placeholder email and returns a link token", async () => {
    provision.mockResolvedValue({ ok: true, member: { id: "u1" } });
    link.mockResolvedValue({ ok: true, token: "t".repeat(43), expiresAt: 5 });
    const r = await addLinkStaffMember({
      businessId: "b", ownerUid: "o", name: " Juan ", phone: "0912-345 6789",
    });
    expect(r).toMatchObject({ ok: true, token: "t".repeat(43), member: { id: "u1", name: "Juan" } });
    const arg = provision.mock.calls[0][0];
    expect(arg.role).toBe("rider");
    expect(onboard).toHaveBeenCalledWith("u1", "b");
    expect(isLinkStaffEmail(arg.email)).toBe(true);
    expect(arg.password.length).toBeGreaterThanOrEqual(40);
    expect(sets.find((s) => s.path === "businesses/b/members/u1")?.data).toMatchObject({
      linkOnly: true, phone: "0912345 6789",
    });
    expect(link).toHaveBeenCalledWith({ businessId: "b", memberUid: "u1", ownerUid: "o" });
  });

  it("passes seat/plan errors through", async () => {
    provision.mockResolvedValue({ ok: false, status: 400, message: "Staff seat limit reached." });
    const r = await addLinkStaffMember({ businessId: "b", ownerUid: "o", name: "Ana" });
    expect(r).toEqual({ ok: false, status: 400, message: "Staff seat limit reached." });
    expect(link).not.toHaveBeenCalled();
  });
});
