import { describe, expect, it } from "vitest";
import {
  portalSubmissionRequestsEmailReceipt,
} from "../../../../services/portal/portal-completion-receipt-notifier";
import type { RawSubmission } from "../../../../services/portal/raw-submission-types";

describe("portalSubmissionRequestsEmailReceipt", () => {
  const base = {
    businessId: "b1",
    customerId: "c1",
    referenceId: "TX-1",
    status: "pending_review" as const,
    payload: {},
    metadata: { legalAgreed: true },
  } satisfies Partial<RawSubmission>;

  it("returns true when profile opts in", () => {
    const sub = {
      ...base,
      submissionType: "MARK_TX_COMPLETE" as const,
      payload: { profile: { portalEmailNotifications: true } },
    } as RawSubmission;
    expect(portalSubmissionRequestsEmailReceipt(sub, null)).toBe(true);
  });

  it("returns true when customer record opts in", () => {
    const sub = {
      ...base,
      submissionType: "MARK_TX_COMPLETE" as const,
    } as RawSubmission;
    expect(
      portalSubmissionRequestsEmailReceipt(sub, {
        portalEmailNotifications: true,
      } as any),
    ).toBe(true);
  });

  it("returns false when not opted in", () => {
    const sub = {
      ...base,
      submissionType: "MARK_TX_COMPLETE" as const,
    } as RawSubmission;
    expect(portalSubmissionRequestsEmailReceipt(sub, null)).toBe(false);
  });
});
