import express from "express";
import request from "supertest";
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
          return { empty: hits.length === 0, docs: [] };
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

vi.mock("../../../config/firebase-admin", () => ({
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
        });
        ops.forEach((op) => op());
        return result;
      });
      state.chain = run.then(() => undefined, () => undefined);
      return run;
    },
  },
  auth: authMock,
  FieldValue: { serverTimestamp: () => "ts", delete: () => "__delete__" },
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts", delete: () => "__delete__" },
}));
vi.mock("../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

import { logAuditEvent } from "../../../services/observability/logging/logger";
import {
  deleteStaffLink,
  getStaffLinkHandler,
  postStaffLink,
  STAFF_LINK_OWNER_ONLY_CODE,
} from "../../../handlers/team-staff-link-handler";
import {
  requireBusinessOwner,
  validateBusinessAccess,
} from "../../../middleware/business-middleware";
import {
  exchangeStaffLink,
  STAFF_LINK_IRRECOVERABLE_CODE,
} from "../../../services/team/team-staff-link-service";

const B = "biz1";
const OTHER = "biz2";
const actors: Record<string, { uid: string; staffLink?: boolean }> = {
  owner: { uid: "owner" },
  rider: { uid: "rider1", staffLink: true },
  ownerWithStaffClaim: { uid: "owner", staffLink: true },
  other: { uid: "other-owner" },
};

function app() {
  const api = express();
  api.use(express.json());
  const routes = express.Router({ mergeParams: true }); // eslint-disable-line new-cap
  routes.get("/members/:memberId/staff-link", requireBusinessOwner, getStaffLinkHandler);
  routes.post("/members/:memberId/staff-link", requireBusinessOwner, postStaffLink);
  routes.delete("/members/:memberId/staff-link", requireBusinessOwner, deleteStaffLink);
  api.use("/business/:businessId/team", (req, res, next) => {
    const actor = actors[String(req.header("x-actor") || "")];
    if (!actor) {
      res.status(401).send("Unauthorized");
      return;
    }
    (req as express.Request & { user: typeof actor }).user = actor;
    next();
  }, validateBusinessAccess, routes);
  return api;
}

beforeEach(() => {
  store.clear();
  state.chain = Promise.resolve();
  vi.clearAllMocks();
  store.set(`businesses/${B}`, { ownerId: "owner" });
  store.set(`businesses/${B}/members/rider1`, { role: "rider", isActive: true });
  store.set(`businesses/${OTHER}`, { ownerId: "other-owner" });
  store.set(`businesses/${OTHER}/members/rider9`, { role: "rider", isActive: true });
});

describe("staff link owner routes", () => {
  it("GET and repeated POST return the same link and do not audit a copy", async () => {
    const api = app();
    const first = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const second = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const copied = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(copied.status).toBe(200);
    const token = first.body.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.body.data.token).toBe(token);
    expect(copied.body.data.token).toBe(token);
    expect(second.body.data.expiresAt).toBe(first.body.data.expiresAt);
    expect((await exchangeStaffLink(token)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((logAuditEvent as unknown as { mock: { calls: unknown[] } }).mock.calls))
      .not.toContain(token);
    const member = store.get(`businesses/${B}/members/rider1`);
    expect(JSON.stringify(member)).not.toContain(token);
  });

  it("concurrent POSTs return one link", async () => {
    const api = app();
    const [a, b] = await Promise.all([
      request(api).post(`/business/${B}/team/members/rider1/staff-link`).set("x-actor", "owner"),
      request(api).post(`/business/${B}/team/members/rider1/staff-link`).set("x-actor", "owner"),
    ]);
    expect(a.body.data.token).toBe(b.body.data.token);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
    const links = [...store.keys()].filter((key) => key.startsWith("staffAccessLinks/"));
    expect(links).toHaveLength(1);
  });

  it("returns 409 for a legacy hash-only link and does not replace it", async () => {
    const api = app();
    const first = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const token = first.body.data.token as string;
    const member = store.get(`businesses/${B}/members/rider1`);
    const hash = String(member?.staffLinkHash);
    const legacy = { ...(store.get(`staffAccessLinks/${hash}`) || {}) };
    delete legacy.token;
    store.set(`staffAccessLinks/${hash}`, legacy);

    const copied = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const posted = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");

    expect(copied.status).toBe(409);
    expect(copied.body.code).toBe(STAFF_LINK_IRRECOVERABLE_CODE);
    expect(posted.status).toBe(409);
    expect(posted.body.code).toBe(STAFF_LINK_IRRECOVERABLE_CODE);
    expect(JSON.stringify(copied.body)).not.toContain(token);
    expect(JSON.stringify(posted.body)).not.toContain(token);
    expect(store.get(`businesses/${B}/members/rider1`)?.staffLinkHash).toBe(hash);
    expect(store.get(`staffAccessLinks/${hash}`)).not.toHaveProperty("token");
    expect((await exchangeStaffLink(token)).ok).toBe(true);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("denies staff-link sessions, other businesses, and inactive seats", async () => {
    const api = app();
    const issued = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const token = issued.body.data.token as string;

    const staffGet = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "rider");
    const staffPost = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "rider");
    const staffDelete = await request(api)
      .delete(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "rider");
    const claimedOwner = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "ownerWithStaffClaim");
    const crossGet = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "other");
    const crossPost = await request(api)
      .post(`/business/${OTHER}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");

    for (const res of [staffGet, staffPost, staffDelete, claimedOwner, crossGet, crossPost]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(token);
    }
    expect(claimedOwner.body.code).toBe(STAFF_LINK_OWNER_ONLY_CODE);
    expect(staffGet.body.code).toBeUndefined();
    expect((await exchangeStaffLink(token)).ok).toBe(true);

    store.set(`businesses/${B}/members/rider1`, {
      ...store.get(`businesses/${B}/members/rider1`),
      isActive: false,
    });
    const inactive = await request(api)
      .get(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    expect(inactive.status).toBe(400);
    expect(JSON.stringify(inactive.body)).not.toContain(token);
    expect(authMock.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("explicit revoke invalidates the old link and allows a new issuance", async () => {
    const api = app();
    const first = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    const token = first.body.data.token as string;
    const removed = await request(api)
      .delete(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    expect(removed.status).toBe(200);
    expect((await exchangeStaffLink(token)).ok).toBe(false);
    expect(authMock.revokeRefreshTokens).toHaveBeenCalledWith("rider1");

    const next = await request(api)
      .post(`/business/${B}/team/members/rider1/staff-link`)
      .set("x-actor", "owner");
    expect(next.status).toBe(201);
    expect(next.body.data.token).not.toBe(token);
    expect((await exchangeStaffLink(next.body.data.token)).ok).toBe(true);
  });
});
