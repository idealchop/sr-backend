import { describe, expect, it, vi, beforeEach } from "vitest";

const noticeCreate = vi.fn();
const noticeSet = vi.fn();
const noticeDelete = vi.fn();
const sendNotification = vi.fn().mockResolvedValue({ success: true, id: "n1" });
const sendResourcesEmail = vi.fn().mockResolvedValue(true);

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
  "../../../../services/notifications/resources-video-published-owner-email-service",
  () => ({
    sendResourcesVideoPublishedOwnerEmail: (...args: unknown[]) =>
      sendResourcesEmail(...args),
  }),
);

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { notifyOwnersResourcesVideoPublished } from "../../../../services/events-training/notify-resources-video-published-service";

describe("notifyOwnersResourcesVideoPublished", () => {
  beforeEach(() => {
    noticeCreate.mockReset();
    noticeSet.mockReset();
    noticeDelete.mockReset();
    sendNotification.mockClear();
    sendResourcesEmail.mockClear();
    noticeCreate.mockResolvedValue(undefined);
    noticeSet.mockResolvedValue(undefined);
    noticeDelete.mockResolvedValue(undefined);
    sendResourcesEmail.mockResolvedValue(true);
  });

  it("sends activity feed + email to each business owner for a WRS story", async () => {
    const result = await notifyOwnersResourcesVideoPublished({
      videoId: "vid-story-1",
      name: "Owner success story",
      category: "wrs_stories",
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
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      title: "New WRS Story",
      metadata: {
        kind: "wrs_story_published",
        trainingVideoId: "vid-story-1",
        category: "wrs_stories",
      },
    });
    expect(sendResourcesEmail).toHaveBeenCalledTimes(2);
  });

  it("returns alreadyNotified when the notice lock exists", async () => {
    noticeCreate.mockRejectedValue({ code: 6 });
    const result = await notifyOwnersResourcesVideoPublished({
      videoId: "vid-dup",
      name: "Dup",
      category: "webinar",
    });
    expect(result.alreadyNotified).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
