import { describe, expect, it, vi, beforeEach } from "vitest";

const noticeCreate = vi.fn();
const noticeSet = vi.fn();
const noticeDelete = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({ success: true, id: "n1" });

const businessDocs = [
  { id: "biz-1", data: () => ({ ownerId: "owner-1" }) },
  { id: "biz-2", data: () => ({ ownerId: "owner-2" }) },
  { id: "biz-3", data: () => ({ ownerId: "" }) },
];

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: (name: string) => {
      if (name === "businesses") {
        return {
          select: () => ({
            get: async () => ({ docs: businessDocs, size: businessDocs.length }),
          }),
        };
      }
      if (name === "apps") {
        return {
          doc: () => ({
            collection: () => ({
              doc: () => ({
                create: noticeCreate,
                set: noticeSet,
                delete: noticeDelete,
              }),
            }),
          }),
        };
      }
      return {};
    },
  },
  FieldValue: {
    serverTimestamp: () => "SERVER_TS",
  },
}));

vi.mock("../../../../services/notifications/notification-service", () => ({
  NotificationService: {
    send: (...args: unknown[]) => sendNotification(...args),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { notifyOwnersWebinarPublished } from "../../../../services/events-training/notify-webinar-published-service";

describe("notifyOwnersWebinarPublished", () => {
  beforeEach(() => {
    noticeCreate.mockReset();
    noticeSet.mockReset();
    noticeDelete.mockReset();
    sendNotification.mockClear();
    noticeCreate.mockResolvedValue(undefined);
    noticeSet.mockResolvedValue(undefined);
    noticeDelete.mockResolvedValue(undefined);
  });

  it("formats startsAt as Asia/Manila in the notification message", async () => {
    const result = await notifyOwnersWebinarPublished({
      eventId: "evt-1",
      name: "Mama the musical",
      startsAt: "2026-07-15T13:27:00.000Z",
    });

    expect(result.notified).toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const firstCall = sendNotification.mock.calls[0]?.[0] as { message: string };
    expect(firstCall.message).toMatch(
      /Mama the musical is now open for registration\. Starts .+ \(Asia\/Manila\)\./,
    );
    expect(firstCall.message).not.toContain("2026-07-15T13:27:00.000Z");
    expect(firstCall.message).toMatch(/9:27\s*PM/i);
  });

  it("is idempotent when the publish notice already exists", async () => {
    noticeCreate.mockRejectedValue({ code: 6 });

    const result = await notifyOwnersWebinarPublished({
      eventId: "evt-1",
      name: "Mama the musical",
      startsAt: "2026-07-15T13:27:00.000Z",
    });

    expect(result.alreadyNotified).toBe(true);
    expect(result.notified).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
