import { describe, expect, it, vi, beforeEach } from "vitest";

const getUser = vi.fn();

vi.mock("../../../config/firebase-admin", () => ({
  auth: {
    getUser: (...args: unknown[]) => getUser(...args),
  },
}));

import {
  resolveOwnerEmailForBusiness,
  resolveVerifiedOwnerEmailForBusiness,
} from "../../../utils/owner-email-resolver";

describe("resolveVerifiedOwnerEmailForBusiness", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("returns the Auth email when emailVerified is true", async () => {
    getUser.mockResolvedValue({
      email: "owner@example.com",
      emailVerified: true,
      displayName: "Ana",
    });

    await expect(
      resolveVerifiedOwnerEmailForBusiness({
        ownerId: "owner-1",
        name: "River Station",
        email: "station@example.com",
      }),
    ).resolves.toEqual({ email: "owner@example.com", name: "Ana" });
  });

  it("skips unverified Auth emails", async () => {
    getUser.mockResolvedValue({
      email: "owner@example.com",
      emailVerified: false,
      displayName: "Ana",
    });

    await expect(
      resolveVerifiedOwnerEmailForBusiness({
        ownerId: "owner-1",
        name: "River Station",
      }),
    ).resolves.toBeNull();
  });

  it("skips when ownerId is missing", async () => {
    await expect(
      resolveVerifiedOwnerEmailForBusiness({ name: "River Station" }),
    ).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("resolveOwnerEmailForBusiness", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("still prefers business email when present", async () => {
    await expect(
      resolveOwnerEmailForBusiness({
        ownerId: "owner-1",
        name: "River Station",
        email: "station@example.com",
      }),
    ).resolves.toEqual({
      email: "station@example.com",
      name: "River Station",
    });
    expect(getUser).not.toHaveBeenCalled();
  });
});
