import { describe, expect, it } from "vitest";
import {
  buildDormantCustomerRows,
  buildDormantSignalsSnapshot,
  DEFAULT_DORMANT_THRESHOLD_DAYS,
} from "../../../utils/dormant-customers";
import type { Customer } from "../../../services/customers/customer-service";
import type { Transaction } from "../../../services/transactions/transaction-service";

const now = new Date("2026-06-07T12:00:00+08:00");

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c1",
    name: "Juan",
    type: "residential",
    phone: "09171234567",
    address: "Manila",
    status: "active",
    ...overrides,
  } as Customer;
}

function delivery(
  overrides: Partial<Transaction> & { customerId: string; daysAgo: number },
): Transaction {
  const scheduledAt = new Date(now.getTime() - overrides.daysAgo * 86_400_000).toISOString();
  const { daysAgo, ...rest } = overrides;
  return {
    id: `tx-${rest.customerId}-${daysAgo}`,
    type: "delivery",
    customerName: "Juan",
    deliveryStatus: "delivered",
    paymentStatus: "paid",
    totalAmount: 100,
    amountPaid: 100,
    balanceDue: 0,
    scheduledAt,
    deliveredAt: scheduledAt,
    ...rest,
  } as Transaction;
}

describe("buildDormantCustomerRows", () => {
  it("skips customers with non-string names without throwing", () => {
    const rows = buildDormantCustomerRows(
      [customer({ name: undefined as unknown as string })],
      [delivery({ customerId: "c1", daysAgo: 10 })],
      { now },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Untitled Suki");
  });

  it("flags suki with no fulfilled order in 7+ days", () => {
    const rows = buildDormantCustomerRows(
      [customer()],
      [delivery({ customerId: "c1", daysAgo: 10 })],
      { now },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].daysSinceLastOrder).toBeGreaterThanOrEqual(DEFAULT_DORMANT_THRESHOLD_DAYS);
    expect(rows[0].customerId).toBe("c1");
  });

  it("excludes suki with recent fulfilled delivery", () => {
    const rows = buildDormantCustomerRows(
      [customer()],
      [delivery({ customerId: "c1", daysAgo: 3 })],
      { now },
    );
    expect(rows).toHaveLength(0);
  });

  it("excludes anonymous walk-in customer profiles", () => {
    const rows = buildDormantCustomerRows(
      [customer({ id: "walk", name: "Walk-in Customer" })],
      [
        {
          id: "walk-only",
          type: "walkin",
          customerId: "walk",
          customerName: "Walk-in Customer",
          paymentStatus: "paid",
          totalAmount: 50,
          amountPaid: 50,
          balanceDue: 0,
          scheduledAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
        } as Transaction,
      ],
      { now },
    );
    expect(rows).toHaveLength(0);
  });

  it("does not count walk-in as retention activity", () => {
    const rows = buildDormantCustomerRows(
      [customer()],
      [
        delivery({ customerId: "c1", daysAgo: 20 }),
        {
          id: "walk-1",
          type: "walkin",
          customerId: "c1",
          customerName: "Juan",
          paymentStatus: "paid",
          totalAmount: 50,
          amountPaid: 50,
          balanceDue: 0,
          scheduledAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
        } as Transaction,
      ],
      { now },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].daysSinceLastOrder).toBeGreaterThanOrEqual(20);
  });

  it("uses denormalized lastFulfilledAt when ledger snapshot is partial", () => {
    const rows = buildDormantCustomerRows(
      [
        customer({
          lastFulfilledAt: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
          lastFulfilledType: "delivery",
        }),
      ],
      [],
      { now },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].daysSinceLastOrder).toBeGreaterThanOrEqual(DEFAULT_DORMANT_THRESHOLD_DAYS);
  });
});

describe("buildDormantSignalsSnapshot", () => {
  it("returns counts and sample for AI snapshots", () => {
    const snapshot = buildDormantSignalsSnapshot(
      [customer()],
      [delivery({ customerId: "c1", daysAgo: 12 })],
      now,
    );
    expect(snapshot.dormantCount).toBe(1);
    expect(Array.isArray(snapshot.sample)).toBe(true);
    expect((snapshot.sample as unknown[]).length).toBeGreaterThan(0);
  });
});
