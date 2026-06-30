import { describe, expect, it } from "vitest";
import {
  isIdempotentPaymentPatch,
  normalizeClientMutationId,
} from "../../../../services/transactions/client-mutation-id";

describe("client-mutation-id", () => {
  it("normalizes valid ids and rejects invalid values", () => {
    expect(normalizeClientMutationId("abc-123")).toBe("abc-123");
    expect(normalizeClientMutationId("bad/id")).toBeNull();
    expect(normalizeClientMutationId(".")).toBeNull();
    expect(normalizeClientMutationId("")).toBeNull();
  });

  it("detects idempotent payment retries", () => {
    const current = {
      amountPaid: 100,
      payments: [
        { id: "pay-1", amount: 100, date: "2026-06-25T08:00:00.000Z", method: "cash" },
      ],
    };

    const updates = {
      amountPaid: 100,
      payments: [
        { id: "pay-1", amount: 100, date: "2026-06-25T08:00:00.000Z", method: "cash" },
      ],
    };

    expect(isIdempotentPaymentPatch(current, updates)).toBe(true);
  });

  it("allows patches that add a new payment row", () => {
    const current = {
      amountPaid: 50,
      payments: [
        { id: "pay-1", amount: 50, date: "2026-06-25T08:00:00.000Z", method: "cash" },
      ],
    };

    const updates = {
      amountPaid: 100,
      payments: [
        { id: "pay-1", amount: 50, date: "2026-06-25T08:00:00.000Z", method: "cash" },
        { id: "pay-2", amount: 50, date: "2026-06-25T09:00:00.000Z", method: "cash" },
      ],
    };

    expect(isIdempotentPaymentPatch(current, updates)).toBe(false);
  });
});
