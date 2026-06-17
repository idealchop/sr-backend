import { describe, expect, it, vi } from "vitest";
import { OnlineOrderLimitService } from "../../../../services/portal/online-order-limit-service";
import type { RawSubmission } from "../../../../services/portal/raw-submission-types";

vi.mock("../../../../services/subscriptions/subscription-service", () => ({
  SubscriptionService: {
    resolvePlanQuotasForBusiness: vi.fn(),
  },
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(async () => ({ docs: [] })),
          })),
        })),
      })),
    })),
  },
}));

import { SubscriptionService } from "../../../../services/subscriptions/subscription-service";

describe("OnlineOrderLimitService.submissionIsBeyondLimit", () => {
  const base: RawSubmission = {
    businessId: "biz-1",
    customerId: "cust-1",
    referenceId: "TX-1",
    submissionType: "PLACE_ORDER",
    status: "pending_review",
    payload: {},
    metadata: { legalAgreed: true },
  };

  it("returns true when metadata.overOnlineOrderLimit is set", () => {
    expect(
      OnlineOrderLimitService.submissionIsBeyondLimit({
        ...base,
        metadata: { ...base.metadata, overOnlineOrderLimit: true },
      }),
    ).toBe(true);
  });

  it("returns false for in-cap PLACE_ORDER without flag", () => {
    expect(OnlineOrderLimitService.submissionIsBeyondLimit(base)).toBe(false);
  });

  it("returns true for REQUEST_COLLECTION when overOnlineOrderLimit is set", () => {
    expect(
      OnlineOrderLimitService.submissionIsBeyondLimit({
        ...base,
        submissionType: "REQUEST_COLLECTION",
        metadata: { ...base.metadata, overOnlineOrderLimit: true },
      }),
    ).toBe(true);
  });

  it("returns false for submission types outside the portal cap", () => {
    expect(
      OnlineOrderLimitService.submissionIsBeyondLimit({
        ...base,
        submissionType: "MARK_TX_COMPLETE",
        metadata: { ...base.metadata, overOnlineOrderLimit: true },
      }),
    ).toBe(false);
  });
});

describe("OnlineOrderLimitService.staffCanAccessSubmission", () => {
  const flagged: RawSubmission = {
    businessId: "biz-1",
    customerId: "cust-1",
    referenceId: "TX-1",
    submissionType: "PLACE_ORDER",
    status: "pending_review",
    payload: {},
    metadata: { legalAgreed: true, overOnlineOrderLimit: true },
  };

  it("allows flagged submissions when current usage is within upgraded quota", async () => {
    vi.mocked(SubscriptionService.resolvePlanQuotasForBusiness).mockResolvedValue({
      onlineOrders: { max: 50, frequency: "monthly" },
    } as Awaited<ReturnType<typeof SubscriptionService.resolvePlanQuotasForBusiness>>);

    const usageSpy = vi
      .spyOn(OnlineOrderLimitService, "getUsage")
      .mockResolvedValue({
        quota: { max: 50, frequency: "monthly" },
        used: 6,
      });

    await expect(
      OnlineOrderLimitService.staffCanAccessSubmission("biz-1", flagged),
    ).resolves.toBe(true);

    usageSpy.mockRestore();
  });

  it("blocks flagged submissions when current usage still exceeds quota", async () => {
    const usageSpy = vi
      .spyOn(OnlineOrderLimitService, "getUsage")
      .mockResolvedValue({
        quota: { max: 5, frequency: "monthly" },
        used: 6,
      });

    await expect(
      OnlineOrderLimitService.staffCanAccessSubmission("biz-1", flagged),
    ).resolves.toBe(false);

    usageSpy.mockRestore();
  });
});
