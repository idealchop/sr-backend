import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  businessGet: vi.fn(),
  businessSet: vi.fn(),
  feedbackGet: vi.fn(),
  where: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "businesses") {
        return {
          doc: vi.fn(() => ({
            get: mocks.businessGet,
            set: mocks.businessSet,
          })),
        };
      }
      if (name === "apps_feedback") {
        const chain = {
          where: mocks.where,
          limit: vi.fn(() => chain),
          get: mocks.feedbackGet,
          add: mocks.add,
        };
        mocks.where.mockReturnValue(chain);
        return chain;
      }
      return { add: vi.fn(), where: vi.fn() };
    }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
}));

import {
  normalizeAppsFeedbackAppId,
  PlatformFeedbackService,
} from "../../../../services/platform/platform-feedback-service";

describe("normalizeAppsFeedbackAppId", () => {
  it("maps smartrefill-v3 to smartrefill", () => {
    expect(normalizeAppsFeedbackAppId("smartrefill-v3")).toBe("smartrefill");
    expect(normalizeAppsFeedbackAppId("smartrefill")).toBe("smartrefill");
  });
});

describe("PlatformFeedbackService.submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: "Aqua Station",
        phone: "+639171234567",
        ownerId: "owner-1",
      }),
    });
    mocks.add.mockResolvedValue({ id: "fb-abc" });
    mocks.businessSet.mockResolvedValue(undefined);
  });

  it("writes apps_feedback with appId smartrefill", async () => {
    const record = await PlatformFeedbackService.submit({
      appId: "smartrefill",
      source: "dashboard-profile-popover",
      businessId: "biz-1",
      userId: "uid-1",
      userEmail: "owner@example.com",
      displayName: "Owner Name",
      rating: 5,
      feedback: "Great command center",
      recommend: true,
      nextUpdateSuggestion: "Better routes",
      plan: "Scale",
      role: "owner",
    });

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "smartrefill",
        submittedBy: expect.objectContaining({
          userId: "uid-1",
          email: "owner@example.com",
        }),
        business: expect.objectContaining({
          businessId: "biz-1",
          name: "Aqua Station",
        }),
        feedback: expect.objectContaining({
          platformSatisfactionRating: 5,
          wouldRecommend: true,
        }),
        acknowledgement: expect.objectContaining({ status: "pending" }),
      }),
    );

    expect(record.appId).toBe("smartrefill");
    expect(record.acknowledgement.status).toBe("pending");
  });

  it("normalizes legacy smartrefill-v3 on submit", async () => {
    await PlatformFeedbackService.submit({
      appId: "smartrefill-v3",
      source: "dashboard",
      businessId: "biz-1",
      userId: "uid-1",
      rating: 4,
    });

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "smartrefill" }),
    );
  });

  it("merges userFeedback on the business doc", async () => {
    await PlatformFeedbackService.submit({
      appId: "smartrefill",
      source: "dashboard",
      businessId: "biz-1",
      userId: "uid-1",
      rating: 3,
      feedback: "Okay",
      recommend: false,
      nextUpdateSuggestion: "Maps",
    });

    expect(mocks.businessSet).toHaveBeenCalledWith(
      { userFeedback: expect.objectContaining({
        rating: 3,
        feedback: "Okay",
        recommend: false,
        nextUpdateSuggestion: "Maps",
      }) },
      { merge: true },
    );
  });
});

describe("PlatformFeedbackService.getLatestForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockImplementation(() => ({
      where: mocks.where,
      limit: vi.fn().mockReturnThis(),
      get: mocks.feedbackGet,
    }));
  });

  it("queries apps_feedback by appId smartrefill", async () => {
    mocks.feedbackGet.mockResolvedValue({
      docs: [
        {
          id: "fb-2",
          data: () => ({
            appId: "smartrefill",
            source: "dashboard",
            business: { businessId: "biz-1", name: "Station" },
            submittedBy: { userId: "uid-1" },
            feedback: {
              platformSatisfactionRating: 5,
              wouldRecommend: true,
              currentExperience: "Great",
              featureWishlist: "",
            },
            acknowledgement: { status: "pending" },
            submittedAt: { toMillis: () => 1000 },
          }),
        },
      ],
    });

    const record = await PlatformFeedbackService.getLatestForUser(
      "biz-1",
      "uid-1",
      "smartrefill",
    );

    expect(mocks.where).toHaveBeenCalledWith("appId", "==", "smartrefill");
    expect(record?.appId).toBe("smartrefill");
    expect(record?.rating).toBe(5);
  });

  it("returns null when no matching docs", async () => {
    mocks.feedbackGet.mockResolvedValue({ docs: [] });

    const record = await PlatformFeedbackService.getLatestForUser(
      "biz-1",
      "uid-1",
    );

    expect(record).toBeNull();
  });
});
