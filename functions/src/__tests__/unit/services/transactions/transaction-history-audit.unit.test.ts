import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({ db: {}, FieldValue: {} }));

import { resolveTransactionHistoryLimit } from "../../../../services/transactions/transaction-queries";
import { buildTransactionUpdateAuditValues } from "../../../../services/transactions/transaction-update-audit-values";

describe("transaction history limit", () => {
  it("defaults to 50 and clamps to 1..100", () => {
    expect(resolveTransactionHistoryLimit(undefined)).toBe(50);
    expect(resolveTransactionHistoryLimit("abc")).toBe(50);
    expect(resolveTransactionHistoryLimit("0")).toBe(50);
    expect(resolveTransactionHistoryLimit("30")).toBe(30);
    expect(resolveTransactionHistoryLimit(12.7)).toBe(12);
    expect(resolveTransactionHistoryLimit("5000")).toBe(100);
  });
});

describe("buildTransactionUpdateAuditValues", () => {
  it("records old and new values for each changed field", () => {
    const { oldValues, newValues } = buildTransactionUpdateAuditValues(
      { totalAmount: 100, notes: undefined, deliveryStatus: "pending" } as any,
      { totalAmount: 150, notes: "Leave at gate" } as any,
      ["totalAmount", "notes"],
    );
    expect(oldValues).toEqual({ totalAmount: 100, notes: null });
    expect(newValues).toEqual({ totalAmount: 150, notes: "Leave at gate" });
  });
});
