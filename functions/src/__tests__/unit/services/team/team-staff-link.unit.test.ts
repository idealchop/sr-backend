import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, authMock, state } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  authMock: {
    createCustomToken: vi.fn(async (uid: string) => `custom-${uid}`),
    revokeRefreshTokens: vi.fn(async () => undefined),
  },
  state: { chain: Promise.resolve() as Promise<unknown> },
}));

function applySet(path: string, data: Record<string, unknown>, merge?: boolean) {
  const base = merge ? { ...(store.get(path) || {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (value === "__delete__") delete base[key];
    else base[key] = value;
  }
  store.set(path, base);
}

function ref(path: string) {
  return {
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    collection: (name: string) => col(`${path}/${name}`),
  };
}
type Tx = {
  get: (r: { path: string }) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  set: (
    r: { path: string },
    data: Record<string, unknown>,
    opts?: { merge?: boolean },
  ) => void;
  delete: (r: { path: string }) => void;
};

function col(path: string) {
  return {
    doc: (id: string) => ref(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const hits = [...store.entries()].filter(([key, data]) =>
            key.startsWith(`${path}/`) &&
            key.split("/").length === path.split("/").length + 1 &&
            data[field] === value);
          return { empty: hits.length === 0 };
        },
      }),
    }),
  };
}

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  let n = 0;
  return {
    ...actual,
    randomBytes: (size: number) => {
      n += 1;
      const buf = Buffer.alloc(size);
      Buffer.from(`fake-staff-link-${n}`).copy(buf);
      buf[size - 1] = n;
      return buf;
    },
  };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: (name: string) => col(name),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (r: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
          ops.push(() => applySet(r.path, data, opts?.merge)),
        delete: (r: { path: string }) => ops.push(() => store.delete(r.path)),
        commit: async () => ops.forEach((fn) => fn()),
      };
    },
    runTransaction: (fn: (tx: Tx) => Promise<unknown>) => {
      const run = state.chain.then(async () => {
        const ops: Array<() => void> = [];
        const result = await fn({
          get: async (r) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
          set: (r, data, opts) => ops.push(() => applySet(r.path, data, opts?.merge)),
          delete: (r) => ops.push(() => store.delete(r.path)),
        });
        ops.forEach((op) => op());
        return result;
      });
      state.chain = run.then(() => undefined, () => undefined);
      return run;
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
  getStaffLink,
  hashStaffLinkToken,
  revokeStaffLink,
  STAFF_LINK_EXPIRED_CODE,
  STAFF_LINK_IRRECOVERABLE_CODE,
  STAFF_LINK_MISSING_CODE,
  STAFF_LINK_TTL_MS,
} from "../../../../services/team/team-staff-link-service";

const B = "biz1";
const MEMBER = `businesses/${B}/members/rider1`;

beforeEach(() => {
  store.clear();
  state.chain = Promise.resolve();
  vi.clearAllMocks();
  store.set(`businesses/${B}`, { ownerId: "owner" });
  store.set(MEMBER, { role: "rider", isActive: true });
  store.set(`businesses/${B}/members/admin1`, { role: "admin", isActive: true });
});

function linkDocsFor(memberUid: string) {
  return [...store.entries()].filter(([key, data]) =>
    key.startsWith("staffAccessLinks/") && data.memberUid === memberUid);
}

function memberHoldsToken(token: string) {
  return [...store.entries()].some(([key, data]) =>
    key.startsWith("businesses/") && JSON.stringify(data).includes(token));
}

describe("staff access links", () => {
  it("creates an unguessable token and stores the secret only on the server link doc", async () => {
    const r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issued).toBe(true);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.token.startsWith("ZmFrZS1zdGFmZi1saW5r")).toBe(true);
    const hash = hashStaffLinkToken(r.token);
    expect(store.get(`staffAccessLinks/${hash}`)).toMatchObject({
      businessId: B,
      memberUid: "rider1",
      token: r.token,
    });
    expect(store.get(MEMBER)).toMatchObject({ staffLinkHash: hash });
    expect(store.get(MEMBER)).not.toHaveProperty("token");
    expect(memberHoldsToken(r.token)).toBe(false);
    expect([...store.keys()].some((key) => key.includes(r.token))).toBe(false);
  });

  it("returns the same link on repeated GET and POST without revoking sessions", async () => {
    const created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    const again = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    const copied = await getStaffLink({ businessId: B, memberUid: "rider1" });
    if (!created.ok || !again.ok || !copied.ok) throw new Error("expected a link");
    expect(again.token).toBe(created.token);
    expect(copied.token).toBe(created.token);
    expect(again.expiresAt).toBe(created.expiresAt);
    expect(copied.expiresAt).toBe(created.expiresAt);
    expect(again.issued).toBe(false);
    expect(copied.issued).toBe(false);
    expect((await exchangeStaffLink(created.token)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(linkDocsFor("rider1")).toHaveLength(1);
  });

  it("concurrent issuance commits one token and both callers receive it", async () => {
    const [a, b] = await Promise.all([
      createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" }),
      createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" }),
    ]);
    if (!a.ok || !b.ok) throw new Error("expected a link");
    expect(a.token).toBe(b.token);
    expect([a.issued, b.issued].filter(Boolean)).toHaveLength(1);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(linkDocsFor("rider1")).toHaveLength(1);
    expect((await exchangeStaffLink(a.token)).ok).toBe(true);
  });

  it("refuses admin seats and the owner", async () => {
    expect((await createStaffLink({ businessId: B, memberUid: "admin1", ownerUid: "owner" })).ok).toBe(false);
    expect((await getStaffLink({ businessId: B, memberUid: "admin1" })).ok).toBe(false);
    store.set(`businesses/${B}/members/owner`, { role: "rider" });
    expect((await createStaffLink({ businessId: B, memberUid: "owner", ownerUid: "owner" })).ok).toBe(false);
    expect((await getStaffLink({ businessId: B, memberUid: "owner" })).ok).toBe(false);
  });

  it("exchanges a valid token for a custom token scoped to the staff uid", async () => {
    const r = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!r.ok) throw new Error("expected a link");
    const exchanged = await exchangeStaffLink(r.token);
    expect(exchanged).toMatchObject({ ok: true, customToken: "custom-rider1", businessId: B });
    expect(authMock.createCustomToken).toHaveBeenCalledWith("rider1", {
      staffLink: true,
      staffLinkBusinessId: B,
    });
  });

  it("does not replace a hash-only legacy link, and the old URL still opens", async () => {
    const created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    const hash = hashStaffLinkToken(created.token);
    const legacy = { ...(store.get(`staffAccessLinks/${hash}`) || {}) };
    delete legacy.token;
    store.set(`staffAccessLinks/${hash}`, legacy);

    const copied = await getStaffLink({ businessId: B, memberUid: "rider1" });
    const posted = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    expect(copied).toMatchObject({
      ok: false,
      status: 409,
      code: STAFF_LINK_IRRECOVERABLE_CODE,
    });
    expect(posted).toMatchObject({
      ok: false,
      status: 409,
      code: STAFF_LINK_IRRECOVERABLE_CODE,
    });
    expect(store.get(MEMBER)?.staffLinkHash).toBe(hash);
    expect(store.get(`staffAccessLinks/${hash}`)).not.toHaveProperty("token");
    expect(linkDocsFor("rider1")).toHaveLength(1);
    expect((await exchangeStaffLink(created.token)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("does not replace an expired link until the owner turns it off", async () => {
    const created = await createStaffLink({
      businessId: B,
      memberUid: "rider1",
      ownerUid: "owner",
      now: 1_000,
    });
    if (!created.ok) throw new Error("expected a link");
    const hash = store.get(MEMBER)?.staffLinkHash;
    const late = 1_000 + STAFF_LINK_TTL_MS + 1;
    expect(await getStaffLink({ businessId: B, memberUid: "rider1", now: late })).toMatchObject({
      ok: false,
      status: 410,
      code: STAFF_LINK_EXPIRED_CODE,
    });
    expect(await createStaffLink({
      businessId: B,
      memberUid: "rider1",
      ownerUid: "owner",
      now: late,
    })).toMatchObject({ ok: false, status: 410, code: STAFF_LINK_EXPIRED_CODE });
    expect(store.get(MEMBER)?.staffLinkHash).toBe(hash);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(await exchangeStaffLink(created.token, late)).toMatchObject({ ok: false, status: 410 });

    await revokeStaffLink({ businessId: B, memberUid: "rider1" });
    const replacement = await createStaffLink({
      businessId: B,
      memberUid: "rider1",
      ownerUid: "owner",
      now: late,
    });
    if (!replacement.ok) throw new Error("expected a replacement");
    expect(replacement.token).not.toBe(created.token);
    expect(replacement.issued).toBe(true);
    expect((await exchangeStaffLink(created.token, late)).ok).toBe(false);
    expect((await exchangeStaffLink(replacement.token, late)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).toHaveBeenCalledWith("rider1");
  });

  it("keeps a link in place when the seat is inactive, then allows it again", async () => {
    const created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    const hash = store.get(MEMBER)?.staffLinkHash;
    store.set(MEMBER, { ...store.get(MEMBER), isActive: false });

    expect(await getStaffLink({ businessId: B, memberUid: "rider1" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(store.get(MEMBER)?.staffLinkHash).toBe(hash);
    expect((await exchangeStaffLink(created.token)).ok).toBe(false);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();

    store.set(MEMBER, { ...store.get(MEMBER), isActive: true });
    const copied = await getStaffLink({ businessId: B, memberUid: "rider1" });
    if (!copied.ok) throw new Error("expected the same link");
    expect(copied.token).toBe(created.token);
    expect((await exchangeStaffLink(created.token)).ok).toBe(true);
  });

  it("revoke, promote and a missing member stop the link", async () => {
    let created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    await revokeStaffLink({ businessId: B, memberUid: "rider1" });
    expect((await exchangeStaffLink(created.token)).ok).toBe(false);
    expect(await getStaffLink({ businessId: B, memberUid: "rider1" })).toMatchObject({
      ok: false,
      status: 404,
      code: STAFF_LINK_MISSING_CODE,
    });

    created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    store.set(MEMBER, { ...store.get(MEMBER), role: "admin" });
    expect((await exchangeStaffLink(created.token)).ok).toBe(false);
    expect((await getStaffLink({ businessId: B, memberUid: "rider1" })).ok).toBe(false);
    expect(authMock.revokeRefreshTokens).toHaveBeenCalledWith("rider1");
  });

  it("does not return another business's link material", async () => {
    const created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    const hash = String(store.get(MEMBER)?.staffLinkHash);
    store.set(`staffAccessLinks/${hash}`, {
      ...(store.get(`staffAccessLinks/${hash}`) || {}),
      businessId: "biz2",
    });
    const copied = await getStaffLink({ businessId: B, memberUid: "rider1" });
    const posted = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    expect(copied).toMatchObject({ ok: false, status: 409, code: STAFF_LINK_IRRECOVERABLE_CODE });
    expect(posted).toMatchObject({ ok: false, status: 409, code: STAFF_LINK_IRRECOVERABLE_CODE });
    expect(store.get(MEMBER)?.staffLinkHash).toBe(hash);
    expect(JSON.stringify(copied)).not.toContain(created.token);
    expect(JSON.stringify(posted)).not.toContain(created.token);

    store.set("businesses/biz2", { ownerId: "other-owner" });
    expect(await getStaffLink({ businessId: "biz2", memberUid: "rider1" })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await createStaffLink({
      businessId: B,
      memberUid: "missing",
      ownerUid: "owner",
    })).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses malformed tokens and accounts that own a workspace", async () => {
    expect((await exchangeStaffLink("not-a-real-token")).ok).toBe(false);
    expect((await exchangeStaffLink(undefined)).ok).toBe(false);
    const created = await createStaffLink({ businessId: B, memberUid: "rider1", ownerUid: "owner" });
    if (!created.ok) throw new Error("expected a link");
    store.set("businesses/other", { ownerId: "rider1" });
    expect((await exchangeStaffLink(created.token)).ok).toBe(false);
  });
});
