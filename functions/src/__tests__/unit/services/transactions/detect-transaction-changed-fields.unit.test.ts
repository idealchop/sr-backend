import { describe, expect, it } from "vitest";
import {
  detectTransactionChangedFields,
  extractPaymentCorrectionReason,
} from "../../../../services/transactions/detect-transaction-changed-fields";
import type { Transaction } from "../../../../services/transactions/transaction-types";

function baseTx(partial: Partial<Transaction> = {}): Transaction {
  return {
    businessId: "biz1",
    referenceId: "TX-1",
    type: "delivery",
    customerName: "Ada",
    totalAmount: 100,
    amountPaid: 0,
    balanceDue: 100,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    deliveryStatus: "pending",
    ...partial,
  };
}

describe("detectTransactionChangedFields", () => {
  it("lists only fields that actually change", () => {
    expect(
      detectTransactionChangedFields(baseTx(), {
        amountPaid: 40,
        notes: "hi",
        deliveryStatus: "pending",
      }),
    ).toEqual(["notes", "amountPaid"]);
  });
});

describe("extractPaymentCorrectionReason", () => {
  it("reads Edited/Removed stamps from the latest payment notes", () => {
    expect(
      extractPaymentCorrectionReason([
        { id: "a", amount: 10, date: "1", method: "cash", notes: "Initial" },
        {
          id: "b",
          amount: 10,
          date: "2",
          method: "cash",
          notes: "Edited: Typo · staff",
          voided: true,
        },
      ]),
    ).toBe("Typo");
  });
});
