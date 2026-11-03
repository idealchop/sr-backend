import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, authMock } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  authMock: {
    createCustomToken: vi.fn(async (uid: string) => `custom-${uid}`),
    revokeRefreshTokens: vi.fn(async () => undefined),
  },
}));

function ref(path: string) {
  return {
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    collection: (c: string) => col(`${path}/${c}`),
  };
}
function col(path: string) {
  return {
    doc: (id: string) => ref(`${path}/${id}`),
    where: (f: string, _op: string, v: unknown) => ({
      limit: () => ({
        get: async () => {
          const hits = [...store.entries()].filter(([k, d]) =>
            k.startsWith(`${path}/`) && k.split("/").length === path.split("/").length + 1 && d[f] === v);
          return { empty: hits.length === 0 };
        },
      }),
    }),
  };
}

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: (c: string) => col(c),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (r: { path: string }, d: Record<string, unknown>, o?: { merge?: boolean }) =>
          ops.push(() => {
            const base = o?.merge ? { ...(store.get(r.path) || {}) } : {};
            for (const [k, v] of Object.entries(d)) {
              if (v === "__delete__") delete base[k]; else base[k] = v;
            }
            store.set(r.path, base);
          }),
        delete: (r: { path: string }) => ops.push(() => store.delete(r.path)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
  },
  auth: authMock,
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts", delete: () => "__delete__" },
}));

import {
  createStaffLink,
  exchangeStaffLink,
  hashStaffLinkToken,
  revokeStaffLink,
  STAFF_LINK_TTL_MS,
} from "../../../../services/team/team-staff-link-service";

const B = "biz1";
beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set(`businesses/${B}`, { ownerId: "owner" });
  store.set(`businesses/${B}/members/rider1`, { role: "rider", isActive: true });
  store.set(`businesses/${B}/members/admin1`, { role: "admin", isActive: true });
});

describe("staff access links", () => {
  it("creates an unguessable token and stores only its hash", async () => {
    const r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = hashStaffLinkToken(r.token);
    expect(store.get(`staffAccessLinks/${hash}`)).toMatchObject({ businessId: B, memberUid: "rider1" });
    expect([...store.keys()].some((k) => k.includes(r.token))).toBe(false);
  });

  it("refuses admin seats and the owner", async () => {
    expect((await createStaffLink({ businessId: B, memberUid: "admin1", ownerUid: "owner" })).ok).toBe(false);
    store.set(`businesses/${B}/members/owner`, { role: "rider" });
    expect((await createStaffLink({ businessId: B, memberUid: "owner", ownerUid: "owner" })).ok).toBe(false);
  });

  it("exchanges a valid token for a custom token scoped to the staff uid", async () => {
    const r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!r.ok) throw new Error();
    const x = await exchangeStaffLink(r.token);
    expect(x).toMatchObject({ ok: true, customToken: "custom-rider1", businessId: B });
    expect(authMock.createCustomToken).toHaveBeenCalledWith("rider1", { staffLink: true, staffLinkBusinessId: B });
  });

  it("regenerate kills the old link and ends old sessions", async () => {
    const a = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    const b = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!a.ok || !b.ok) throw new Error();
    expect((await exchangeStaffLink(a.token)).ok).toBe(false);
    expect((await exchangeStaffLink(b.token)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).toHaveBeenCalledWith("rider1");
  });

  it("revoke, deactivate, promote and expiry all stop the link", async () => {
    let r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!r.ok) throw new Error();
    await revokeStaffLink({ businessId: B, memberUid: "rider1" });
    expect((await exchangeStaffLink(r.token)).ok).toBe(false);

    r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!r.ok) throw new Error();
    const t = r.token;
    const late = Date.now() + STAFF_LINK_TTL_MS + 1;
    expect(await exchangeStaffLink(t, late)).toMatchObject({ ok: false, status: 410 });
    store.set(`businesses/${B}/members/rider1`, { ...store.get(`businesses/${B}/members/rider1`), isActive: false });
    expect((await exchangeStaffLink(t)).ok).toBe(false);
    store.set(`businesses/${B}/members/rider1`, { ...store.get(`businesses/${B}/members/rider1`), isActive: true, role: "admin" });
    expect((await exchangeStaffLink(t)).ok).toBe(false);
  });

  it("refuses malformed tokens and accounts that own a workspace", async () => {
    expect((await exchangeStaffLink("abc")).ok).toBe(false);
    expect((await exchangeStaffLink(undefined)).ok).toBe(false);
    const r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!r.ok) throw new Error();
    store.set("businesses/other", { ownerId: "rider1" });
    expect((await exchangeStaffLink(r.token)).ok).toBe(false);
  });
});
