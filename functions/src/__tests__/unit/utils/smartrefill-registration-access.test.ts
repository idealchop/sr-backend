import { describe, it, expect, vi, beforeEach } from "vitest";

const userDocGet = vi.fn();
const whereGet = vi.fn();

vi.mock("../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name !== "users") throw new Error("unexpected collection");
      return {
        doc: vi.fn(() => ({ get: userDocGet })),
        where: vi.fn(() => ({ limit: vi.fn(() => ({ get: whereGet })) })),
      };
    }),
  },
}));

import {
  hasSmartrefillAppAccess,
  resolveSmartrefillAccessForUser,
} from "../../../utils/smartrefill-app-access";

describe("smartrefill registration access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hasSmartrefillAppAccess is case-insensitive on appId", () => {
    expect(
      hasSmartrefillAppAccess([{ appId: "SmartRefill", role: "owner" }]),
    ).toBe(true);
  });

  it("allows signup when uid doc has no smartrefill appAccess", async () => {
    userDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ appAccess: [{ appId: "other-app" }] }),
    });
    whereGet.mockResolvedValue({ docs: [] });

    const result = await resolveSmartrefillAccessForUser("uid-1", "a@test.com");
    expect(result.hasSmartrefillAccess).toBe(false);
  });

  it("blocks signup when any user doc with email has smartrefill", async () => {
    userDocGet.mockResolvedValue({ exists: false });
    whereGet.mockResolvedValue({
      docs: [
        {
          id: "other-uid",
          data: () => ({
            email: "a@test.com",
            appAccess: [{ appId: "smartrefill" }],
          }),
        },
      ],
    });

    const result = await resolveSmartrefillAccessForUser("uid-1", "a@test.com");
    expect(result.hasSmartrefillAccess).toBe(true);
  });
});
