import { describe, expect, it, vi, beforeEach } from "vitest";

const noticeCreate = vi.fn();
const noticeSet = vi.fn();
const noticeDelete = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({ success: true, id: "n1" });
const sendTutorialEmail = vi.fn().mockResolvedValue(true);

const businessDocs = [
  { id: "biz-1", data: () => ({ ownerId: "owner-1", email: "a@ex.com", name: "A" }) },
  { id: "biz-2", data: () => ({ ownerId: "owner-2", email: "b@ex.com", name: "B" }) },
  { id: "biz-3", data: () => ({ ownerId: "", email: "c@ex.com", name: "C" }) },
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

vi.mock(
  "../../../../services/notifications/tutorial-published-owner-email-service",
  () => ({
    sendTutorialPublishedOwnerEmail: (...args: unknown[]) =>
      sendTutorialEmail(...args),
  }),
);

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { notifyOwnersTutorialPublished } from "../../../../services/events-training/notify-tutorial-published-service";

describe("notifyOwnersTutorialPublished", () => {
  beforeEach(() => {
    noticeCreate.mockReset();
    noticeSet.mockReset();
    noticeDelete.mockReset();
    sendNotification.mockClear();
    sendTutorialEmail.mockClear();
    noticeCreate.mockResolvedValue(undefined);
    noticeSet.mockResolvedValue(undefined);
    noticeDelete.mockResolvedValue(undefined);
    sendTutorialEmail.mockResolvedValue(true);
  });

  it("sends activity feed + email to each business owner", async () => {
    const result = await notifyOwnersTutorialPublished({
      videoId: "vid-1",
      name: "How to add a delivery",
      appId: "smartrefill",
      appPages: ["transactions"],
    });

    expect(result).toEqual({
      notified: true,
      alreadyNotified: false,
      skipped: false,
      ownersNotified: 2,
      emailsSent: 2,
      businessesScanned: 3,
    });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendTutorialEmail).toHaveBeenCalledTimes(2);
    expect(sendTutorialEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        tutorialName: "How to add a delivery",
        videoId: "vid-1",
      }),
    );
    expect(noticeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        ownersNotified: 2,
        emailsSent: 2,
      }),
      { merge: true },
    );
  });

  it("is idempotent when the publish notice already exists", async () => {
    noticeCreate.mockRejectedValue({ code: 6 });

    const result = await notifyOwnersTutorialPublished({
      videoId: "vid-1",
      name: "How to add a delivery",
    });

    expect(result.alreadyNotified).toBe(true);
    expect(result.notified).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendTutorialEmail).not.toHaveBeenCalled();
  });

  it("skips non-SmartRefill tutorial apps", async () => {
    const result = await notifyOwnersTutorialPublished({
      videoId: "vid-2",
      name: "Other app tutorial",
      appId: "other-app",
    });

    expect(result.skipped).toBe(true);
    expect(noticeCreate).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendTutorialEmail).not.toHaveBeenCalled();
  });
});
