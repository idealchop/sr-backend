import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deliveryStatusLabel,
  listManagementUserIds,
  transactionTypeLabel,
} from "../../../../services/notifications/station-activity-notification-service";

const businessGetMock = vi.fn();
const membersGetMock = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name !== "businesses") {
        return { doc: vi.fn() };
      }
      return {
        doc: vi.fn(() => ({
          get: businessGetMock,
          collection: vi.fn(() => ({
            get: membersGetMock,
          })),
        })),
      };
    }),
  },
}));

describe("station-activity-notification formatters", () => {
  it("labels transaction types for owners", () => {
    expect(transactionTypeLabel("walkin")).toBe("Walk-in sale");
    expect(transactionTypeLabel("expense")).toBe("Expense");
    expect(transactionTypeLabel("collection")).toBe("Collection");
    expect(transactionTypeLabel("delivery")).toBe("Delivery order");
  });

  it("labels delivery statuses in plain language", () => {
    expect(deliveryStatusLabel("in-transit")).toBe("in transit");
    expect(deliveryStatusLabel("completed")).toBe("completed");
  });
});

describe("listManagementUserIds", () => {
  beforeEach(() => {
    businessGetMock.mockReset();
    membersGetMock.mockReset();
  });

  it("always includes the workspace owner even without a member doc", async () => {
    businessGetMock.mockResolvedValue({
      data: () => ({ ownerId: "owner-uid" }),
    });
    membersGetMock.mockResolvedValue({ docs: [] });

    await expect(listManagementUserIds("biz-1")).resolves.toEqual(["owner-uid"]);
  });

  it("includes active management seats and resolves member userId", async () => {
    businessGetMock.mockResolvedValue({
      data: () => ({ ownerId: "owner-uid" }),
    });
    membersGetMock.mockResolvedValue({
      docs: [
        {
          id: "legacy-doc",
          data: () => ({ role: "admin", userId: "admin-uid", isActive: true }),
        },
        {
          id: "staff-uid",
          data: () => ({ role: "staff", isActive: true }),
        },
        {
          id: "rider-uid",
          data: () => ({ role: "rider", isActive: true }),
        },
      ],
    });

    const ids = await listManagementUserIds("biz-1");
    expect(ids).toContain("owner-uid");
    expect(ids).toContain("admin-uid");
    expect(ids).toContain("staff-uid");
    expect(ids).not.toContain("rider-uid");
  });
});
