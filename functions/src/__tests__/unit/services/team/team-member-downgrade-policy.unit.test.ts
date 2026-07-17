import { beforeEach, describe, expect, it, vi } from "vitest";

const batchUpdate = vi.fn();
const batchCommit = vi.fn().mockResolvedValue(undefined);
const membersGet = vi.fn();
const directoryGet = vi.fn();
const businessGet = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    batch: () => ({
      update: batchUpdate,
      commit: batchCommit,
    }),
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: businessGet,
        collection: vi.fn((name: string) => {
          if (name === "members") return { get: membersGet };
          return { get: directoryGet };
        }),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "TS"),
  },
}));

vi.mock("../../../../services/notifications/notification-service", () => ({
  NotificationService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const updateRider = vi.fn().mockResolvedValue(undefined);
const getRidersByBusiness = vi.fn();

vi.mock("../../../../services/riders/rider-service", () => ({
  RiderService: {
    getRidersByBusiness: (...args: unknown[]) => getRidersByBusiness(...args),
    updateRider: (...args: unknown[]) => updateRider(...args),
  },
}));

describe("deactivateAllNonOwnerWorkspaceMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchCommit.mockResolvedValue(undefined);
    businessGet.mockResolvedValue({
      exists: true,
      data: () => ({ ownerId: "owner-1" }),
    });
  });

  it("deactivates members, record-only riders, and directory records", async () => {
    membersGet.mockResolvedValue({
      docs: [
        {
          id: "owner-1",
          data: () => ({ role: "owner", isActive: true }),
          ref: { path: "members/owner-1" },
        },
        {
          id: "staff-1",
          data: () => ({ role: "admin", isActive: true }),
          ref: { path: "members/staff-1" },
        },
      ],
    });
    getRidersByBusiness.mockResolvedValue([
      { id: "r1", userId: "", status: "active", name: "Record only" },
      { id: "r2", userId: "uid-linked", status: "active", name: "Linked" },
      { id: "r3", userId: "", status: "inactive", name: "Already off" },
    ]);
    directoryGet.mockResolvedValue({
      docs: [
        {
          id: "d1",
          data: () => ({ role: "admin", status: "active" }),
          ref: { path: "team_directory_records/d1" },
        },
        {
          id: "d2",
          data: () => ({ role: "admin", status: "inactive" }),
          ref: { path: "team_directory_records/d2" },
        },
      ],
    });

    const { deactivateAllNonOwnerWorkspaceMembers } = await import(
      "../../../../services/team/team-member-downgrade-policy"
    );
    const result = await deactivateAllNonOwnerWorkspaceMembers("biz-1");

    expect(result).toEqual({
      members: 1,
      recordOnlyRiders: 1,
      directoryRecords: 1,
    });
    expect(updateRider).toHaveBeenCalledWith("biz-1", "r1", {
      status: "inactive",
    });
    expect(updateRider).not.toHaveBeenCalledWith(
      "biz-1",
      "r2",
      expect.anything(),
    );
    expect(batchUpdate).toHaveBeenCalled();
    expect(batchCommit).toHaveBeenCalled();
  });
});
