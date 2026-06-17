import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockCollection, mockWhere, mockLimit } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockCollection = vi.fn();
  return { mockGet, mockCollection, mockWhere, mockLimit };
});

vi.mock("../../../config/firebase-admin", () => ({
  db: {
    collection: mockCollection,
  },
}));

import {
  resolveStaffVerificationContext,
  resolveVerificationAudience,
  verificationPathForAudience,
} from "../../../utils/resolve-verification-audience";

function chainDoc(getResult: { exists: boolean; data?: () => Record<string, unknown> }) {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    collection: vi.fn(() => ({
      doc: vi.fn(() => chainDoc(getResult)),
    })),
  };
}

describe("verificationPathForAudience", () => {
  it("routes staff to /staff-verified", () => {
    expect(verificationPathForAudience("staff")).toBe("/staff-verified");
  });

  it("routes owner to /verified", () => {
    expect(verificationPathForAudience("owner")).toBe("/verified");
  });
});

describe("resolveVerificationAudience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ get: mockGet });
  });

  it("defaults to owner when users doc is missing", async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === "users") {
        return { doc: () => chainDoc({ exists: false }) };
      }
      if (name === "businesses") {
        return { where: mockWhere };
      }
      return { doc: () => chainDoc({ exists: false }) };
    });
    mockGet.mockResolvedValue({ empty: true });

    await expect(resolveVerificationAudience("uid-missing")).resolves.toBe("owner");
  });

  it("resolves staff for workspace rider member", async () => {
    const userData = {
      appAccess: [{ appId: "smartrefill", businessId: "biz-1", role: "rider" }],
    };
    const businessData = { ownerId: "owner-1", name: "Alphamart" };
    const memberData = { role: "rider" };

    mockCollection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => userData }),
          }),
        };
      }
      if (name === "businesses") {
        return {
          where: mockWhere,
          doc: (bizId: string) => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => (bizId === "biz-1" ? businessData : {}),
            }),
            collection: (sub: string) => ({
              doc: (memberId: string) => ({
                get: vi.fn().mockResolvedValue({
                  exists: sub === "members" && memberId === "rider-uid",
                  data: () => memberData,
                }),
              }),
            }),
          }),
        };
      }
      return { doc: () => chainDoc({ exists: false }) };
    });
    mockGet.mockResolvedValue({ empty: true });

    await expect(resolveVerificationAudience("rider-uid")).resolves.toBe("staff");
  });

  it("resolves owner when uid matches business ownerId", async () => {
    const userData = {
      appAccess: [{ appId: "smartrefill", businessId: "biz-1", role: "owner" }],
    };

    mockCollection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => userData }),
          }),
        };
      }
      if (name === "businesses") {
        return {
          where: mockWhere,
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerId: "owner-uid", name: "River Station" }),
            }),
            collection: () => ({
              doc: () => ({
                get: vi.fn().mockResolvedValue({ exists: false }),
              }),
            }),
          }),
        };
      }
      return { doc: () => chainDoc({ exists: false }) };
    });
    mockGet.mockResolvedValue({ empty: true });

    await expect(resolveVerificationAudience("owner-uid")).resolves.toBe("owner");
  });
});

describe("resolveStaffVerificationContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspace name and member role for staff", async () => {
    const userData = {
      appAccess: [{ appId: "smartrefill", businessId: "biz-9", role: "admin" }],
    };

    mockCollection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => userData }),
          }),
        };
      }
      if (name === "businesses") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ name: "  River Station  " }),
            }),
            collection: () => ({
              doc: () => ({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ role: "admin" }),
                }),
              }),
            }),
          }),
        };
      }
      return { doc: () => chainDoc({ exists: false }) };
    });

    await expect(resolveStaffVerificationContext("admin-uid")).resolves.toEqual({
      workspaceName: "River Station",
      memberRole: "admin",
    });
  });

  it("returns empty context when user has no businessId", async () => {
    mockCollection.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ appAccess: [{ appId: "smartrefill" }] }),
            }),
          }),
        };
      }
      return { doc: () => chainDoc({ exists: false }) };
    });

    await expect(resolveStaffVerificationContext("orphan-uid")).resolves.toEqual({});
  });
});
