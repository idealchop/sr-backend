import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupportAiPlanLimits } from "../../../../utils/support-ai-plan-limits";

const mocks = vi.hoisted(() => ({
  docGet: vi.fn(),
  docSet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: mocks.docGet,
            set: mocks.docSet,
          })),
        })),
      })),
    })),
  },
  FieldValue: {
    increment: vi.fn((n: number) => ({ __increment: n })),
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
}));

import {
  SupportAiLimitError,
  SupportAiUsageService,
} from "../../../../services/support/support-ai-usage-service";

const starterLimits: SupportAiPlanLimits = {
  chatMax: 5,
  chatFrequency: "monthly",
  attachmentsMax: null,
  attachmentsAllowed: false,
  agentChatEnabled: false,
};

const trialLimits: SupportAiPlanLimits = {
  chatMax: 50,
  chatFrequency: "daily",
  attachmentsMax: 50,
  attachmentsAllowed: true,
  agentChatEnabled: true,
};

describe("SupportAiUsageService.readUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docGet.mockResolvedValue({ data: () => undefined });
  });

  it("returns zero usage when private docs are missing", async () => {
    const usage = await SupportAiUsageService.readUsage("biz-1", starterLimits);
    expect(usage).toEqual({ chatUsed: 0, attachmentsUsed: 0 });
  });

  it("reads chat and attachment counters from private usage docs", async () => {
    mocks.docGet
      .mockResolvedValueOnce({ data: () => ({ chatCount: 3 }) })
      .mockResolvedValueOnce({ data: () => ({ attachmentCount: 7 }) });

    const usage = await SupportAiUsageService.readUsage("biz-1", trialLimits);
    expect(usage).toEqual({ chatUsed: 3, attachmentsUsed: 7 });
  });
});

describe("SupportAiUsageService.assertWithinLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docGet.mockResolvedValue({ data: () => undefined });
  });

  it("throws when monthly chat cap is reached", async () => {
    mocks.docGet.mockResolvedValueOnce({ data: () => ({ chatCount: 5 }) });

    await expect(
      SupportAiUsageService.assertWithinLimits("biz-1", starterLimits, 0),
    ).rejects.toMatchObject({
      code: "SUPPORT_AI_CHAT_LIMIT",
    });
  });

  it("throws when attachments are not allowed on the plan", async () => {
    await expect(
      SupportAiUsageService.assertWithinLimits("biz-1", starterLimits, 1),
    ).rejects.toMatchObject({
      code: "SUPPORT_AI_ATTACHMENTS_NOT_ALLOWED",
    });
  });

  it("throws when attachment cap would be exceeded", async () => {
    mocks.docGet
      .mockResolvedValueOnce({ data: () => ({ chatCount: 0 }) })
      .mockResolvedValueOnce({ data: () => ({ attachmentCount: 50 }) });

    await expect(
      SupportAiUsageService.assertWithinLimits("biz-1", trialLimits, 1),
    ).rejects.toMatchObject({
      code: "SUPPORT_AI_ATTACHMENT_LIMIT",
    });
  });

  it("passes when within chat and attachment quotas", async () => {
    mocks.docGet
      .mockResolvedValueOnce({ data: () => ({ chatCount: 2 }) })
      .mockResolvedValueOnce({ data: () => ({ attachmentCount: 10 }) });

    await expect(
      SupportAiUsageService.assertWithinLimits("biz-1", trialLimits, 2),
    ).resolves.toBeUndefined();
  });
});

describe("SupportAiUsageService.recordTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docSet.mockResolvedValue(undefined);
  });

  it("increments chat counter for capped plans", async () => {
    await SupportAiUsageService.recordTurn("biz-1", starterLimits, 0);

    expect(mocks.docSet).toHaveBeenCalledWith(
      expect.objectContaining({
        chatCount: { __increment: 1 },
        frequency: "monthly",
      }),
      { merge: true },
    );
  });

  it("increments attachment counter when attachments are sent", async () => {
    await SupportAiUsageService.recordTurn("biz-1", trialLimits, 2);

    expect(mocks.docSet).toHaveBeenCalledTimes(2);
    expect(mocks.docSet).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentCount: { __increment: 2 },
      }),
      { merge: true },
    );
  });
});

describe("SupportAiUsageService.getUsageSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docGet.mockResolvedValue({ data: () => ({ chatCount: 4 }) });
  });

  it("merges plan limits with live counters", async () => {
    const snapshot = await SupportAiUsageService.getUsageSnapshot(
      "biz-1",
      starterLimits,
    );
    expect(snapshot).toMatchObject({
      chatMax: 5,
      chatFrequency: "monthly",
      chatUsed: 4,
      attachmentsAllowed: false,
    });
  });
});

describe("SupportAiLimitError", () => {
  it("exposes a stable error code for handlers", () => {
    const err = new SupportAiLimitError("SUPPORT_AI_CHAT_LIMIT", "limit reached");
    expect(err.name).toBe("SupportAiLimitError");
    expect(err.code).toBe("SUPPORT_AI_CHAT_LIMIT");
  });
});
