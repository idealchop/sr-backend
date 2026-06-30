import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../services/transactions/transaction-service";
import {
  extractTransactionPaymentReference,
  resolveReceiptPaymentDisplay,
} from "../../../utils/receipt-payment-display";

const accounts = [
  { id: "pf2i90eocjdudj3i4frp", bankName: "GCash" },
  { id: "acct-bpi", bankName: "BPI Savings" },
];

function tx(partial: Partial<Transaction>): Transaction {
  return {
    businessId: "biz-1",
    referenceId: "TX-001",
    type: "delivery",
    customerName: "Maria",
    totalAmount: 500,
    amountPaid: 0,
    balanceDue: 500,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    deliveryStatus: "completed",
    ...partial,
  };
}

describe("resolveReceiptPaymentDisplay", () => {
  it("shows N/A for unpaid orders", () => {
    const display = resolveReceiptPaymentDisplay(
      tx({
        paymentMethod: "pf2i90eocjdudj3i4frp",
        paymentStatus: "unpaid",
      }),
      accounts,
    );
    expect(display.paymentMethod).toBe("N/A");
    expect(display.paymentReference).toBeNull();
  });

  it("resolves payment_info id to business account label", () => {
    const display = resolveReceiptPaymentDisplay(
      tx({
        paymentMethod: "pf2i90eocjdudj3i4frp",
        paymentStatus: "paid",
        amountPaid: 500,
        balanceDue: 0,
      }),
      accounts,
    );
    expect(display.paymentMethod).toBe("GCash");
    expect(display.paymentReference).toBe("-");
  });

  it("shows online payment reference when available", () => {
    const display = resolveReceiptPaymentDisplay(
      tx({
        paymentMethod: "pf2i90eocjdudj3i4frp",
        paymentStatus: "paid",
        amountPaid: 500,
        balanceDue: 0,
        payments: [
          {
            id: "pay-1",
            amount: 500,
            date: new Date(),
            method: "pf2i90eocjdudj3i4frp",
            notes: "Ref: GCASH-778899",
          },
        ],
      }),
      accounts,
    );
    expect(display.paymentMethod).toBe("GCash");
    expect(display.paymentReference).toBe("GCASH-778899");
  });

  it("uses dash when online method cannot be resolved", () => {
    const display = resolveReceiptPaymentDisplay(
      tx({
        paymentMethod: "missing-account-id",
        paymentStatus: "partial",
        amountPaid: 200,
        balanceDue: 300,
      }),
      accounts,
    );
    expect(display.paymentMethod).toBe("-");
    expect(display.paymentReference).toBe("-");
  });

  it("shows Cash without payment reference row for cash payments", () => {
    const display = resolveReceiptPaymentDisplay(
      tx({
        paymentMethod: "cash",
        paymentStatus: "paid",
        amountPaid: 500,
        balanceDue: 0,
      }),
      accounts,
    );
    expect(display.paymentMethod).toBe("Cash");
    expect(display.paymentReference).toBeNull();
  });
});

describe("extractTransactionPaymentReference", () => {
  it("reads reference from payment notes and transaction notes", () => {
    expect(
      extractTransactionPaymentReference(
        tx({
          payments: [
            {
              id: "pay-1",
              amount: 100,
              date: new Date(),
              method: "cash",
              notes: "Payment ref: ABC-123 | Paid: 2026-06-29",
            },
          ],
        }),
      ),
    ).toBe("ABC-123");

    expect(
      extractTransactionPaymentReference(
        tx({
          notes: "[Portal completion] Payment reference: XYZ-999 | Date paid: 2026-06-29",
        }),
      ),
    ).toBe("XYZ-999");
  });
});
