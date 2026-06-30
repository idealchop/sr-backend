import { describe, expect, it } from "vitest";
import {
  customerLookupKey,
  isWalkInCustomerName,
  matchCustomersToLedgerRows,
  normalizePhoneKey,
} from "../../../../services/ai/ledger-scan-customer-match";
import {
  attachInventoryIds,
  normalizeLedgerRow,
  normalizeLedgerType,
} from "../../../../services/ai/ledger-scan-normalize";
import type { ExtractedLedgerRow } from "../../../../services/ai/ledger-scan-types";

describe("ledger-scan-normalize", () => {
  it("maps legacy Sale to walkin for counter customer", () => {
    expect(
      normalizeLedgerType("Sale", { customerName: "Walk-in Customer" }),
    ).toBe("walkin");
  });

  it("maps legacy Sale with address to delivery", () => {
    expect(
      normalizeLedgerType("Sale", {
        customerName: "Maria Santos",
        address: "Brgy 5",
      }),
    ).toBe("delivery");
  });

  it("normalizes expense rows without bottle quantity", () => {
    const row = normalizeLedgerRow(
      {
        transactionType: "expense",
        customerName: "Supplier",
        amount: 500,
        date: "2026-06-02",
      },
      "2026-06-02",
    );
    expect(row?.transactionType).toBe("expense");
    expect(row?.amount).toBe(500);
  });

  it("attaches inventory catalog ids by name", () => {
    const lines = attachInventoryIds(
      [{ itemName: "Round Jug", count: 3 }],
      [{ id: "inv-1", name: "Round Jug", category: "container" }],
    );
    expect(lines[0].inventoryItemId).toBe("inv-1");
    expect(lines[0].isNew).toBe(false);
  });
});

describe("ledger-scan-customer-match", () => {
  const existing = [
    { id: "c1", name: "Maria Santos", phone: "09171234567" },
    { id: "c2", name: "Juan Dela Cruz", phone: "09179876543" },
  ];

  it("matches by phone before fuzzy name", () => {
    const rows: ExtractedLedgerRow[] = [
      {
        transactionType: "delivery",
        customerName: "Maria S.",
        customerPhone: "9171234567",
        date: "2026-06-02",
        amount: 100,
        bottleQuantity: 2,
      },
    ];
    const matched = matchCustomersToLedgerRows(rows, existing);
    expect(matched[0].customerId).toBe("c1");
    expect(matched[0].matchedExisting).toBe(true);
    expect(matched[0].isNewCustomer).toBe(false);
  });

  it("deduplicates new customers within the same batch by phone", () => {
    const rows: ExtractedLedgerRow[] = [
      {
        transactionType: "delivery",
        customerName: "New Person",
        customerPhone: "09181112222",
        date: "2026-06-02",
        amount: 50,
        bottleQuantity: 1,
      },
      {
        transactionType: "walkin",
        customerName: "New Person",
        customerPhone: "9181112222",
        date: "2026-06-02",
        amount: 25,
        bottleQuantity: 1,
      },
    ];
    const matched = matchCustomersToLedgerRows(rows, existing);
    expect(matched[0].isNewCustomer).toBe(true);
    expect(matched[1].isNewCustomer).toBe(true);
    expect(normalizePhoneKey("09181112222")).toBe(
      normalizePhoneKey("9181112222"),
    );
    expect(customerLookupKey("New Person", "09181112222")).toBe(
      customerLookupKey("New Person", "9181112222"),
    );
  });

  it("skips customer match for walk-in and expense", () => {
    expect(isWalkInCustomerName("Walk-in Customer")).toBe(true);
    expect(isWalkInCustomerName(null)).toBe(true);
    expect(isWalkInCustomerName(undefined)).toBe(true);
    const rows: ExtractedLedgerRow[] = [
      {
        transactionType: "walkin",
        customerName: "Walk-in Customer",
        date: "2026-06-02",
        amount: 25,
        bottleQuantity: 1,
      },
      {
        transactionType: "expense",
        customerName: "Expense",
        date: "2026-06-02",
        amount: 100,
      },
    ];
    const matched = matchCustomersToLedgerRows(rows, existing);
    expect(matched[0].isNewCustomer).toBe(false);
    expect(matched[1].isNewCustomer).toBe(false);
  });
});
