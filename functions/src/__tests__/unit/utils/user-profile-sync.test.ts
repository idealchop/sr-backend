import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  userSet: vi.fn(),
  userGet: vi.fn(),
  authGetUser: vi.fn(),
}));

vi.mock("../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mocks.userGet,
        set: mocks.userSet,
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
  auth: {
    getUser: mocks.authGetUser,
  },
}));

import { upsertSmartrefillUserProfile } from "../../../utils/user-profile-sync";

describe("upsertSmartrefillUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authGetUser.mockResolvedValue({
      uid: "uid-1",
      email: "owner@test.com",
      displayName: "Auth Display",
      photoURL: "https://example.com/p.jpg",
    });
  });

  it("writes uid, email, displayName, fullName, timestamps on new user", async () => {
    mocks.userGet.mockResolvedValue({ exists: false });

    await upsertSmartrefillUserProfile({
      uid: "uid-1",
      email: "owner@test.com",
      bodyFullName: "River Owner",
      grantSmartrefillAccess: true,
    });

    expect(mocks.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid-1",
        email: "owner@test.com",
        displayName: "River Owner",
        fullName: "River Owner",
        photoURL: "https://example.com/p.jpg",
        createdAt: "SERVER_TS",
        updatedAt: "SERVER_TS",
      }),
      { merge: true },
    );
  });

  it("merges profile fields when granting smartrefill on existing doc", async () => {
    mocks.userGet.mockResolvedValue({
      exists: true,
      data: () => ({ appAccess: [{ appId: "legacy-app" }], createdAt: "OLD" }),
    });

    await upsertSmartrefillUserProfile({
      uid: "uid-1",
      email: "owner@test.com",
      grantSmartrefillAccess: true,
    });

    expect(mocks.userSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid-1",
        email: "owner@test.com",
        displayName: "Auth Display",
        updatedAt: "SERVER_TS",
      }),
      { merge: true },
    );
    expect(mocks.userSet.mock.calls[0][0]).not.toHaveProperty("createdAt");
  });
});
