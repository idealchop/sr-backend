import { describe, expect, it } from "vitest";
import {
  buildBusinessBuddySnapshot,
  type BuddyScheduleStop,
} from "../../../../services/support/business-buddy-snapshot";
import { DEFAULT_GETTING_STARTED } from "../../../../services/business/business-onboarding-defaults";
import type { Transaction } from "../../../../services/transactions/transaction-service";

const NOW = new Date("2026-06-17T04:00:00.000Z"); // Manila 2026-06-17 noon-ish

function emptyLoadData(transactions: Transaction[] = []) {
  return {
    businessName: "Buddy Test Station",
    gettingStarted: { ...DEFAULT_GETTING_STARTED, addCustomer: true },
    activeRiderCount: 1,
    transactions,
    customers: [],
    inventory: [],
    riders: [],
    pendingPortalOrders: [],
  };
}

function openDelivery(
  overrides: Partial<Transaction> & { referenceId: string; customerName: string },
): Transaction {
  return {
    id: overrides.referenceId,
    referenceId: overrides.referenceId,
    customerName: overrides.customerName,
    type: "delivery",
    deliveryStatus: "pending",
    waterRefills: [{ waterTypeId: "purified", quantity: 5 }],
    balanceDue: 0,
    ...overrides,
  } as Transaction;
}

describe("buildBusinessBuddySnapshot schedule slices", () => {
  it("includes open delivery scheduled tomorrow in schedule.tomorrow", () => {
    const tomorrow = new Date("2026-06-18T02:00:00.000Z");
    const snapshot = buildBusinessBuddySnapshot(
      emptyLoadData([
        openDelivery({
          referenceId: "TX-TOM",
          customerName: "Ana Cruz",
          scheduledAt: tomorrow,
        }),
        openDelivery({
          referenceId: "TX-DONE",
          customerName: "Done Customer",
          scheduledAt: tomorrow,
          deliveryStatus: "completed",
        }),
      ]),
      NOW,
    );

    expect(snapshot.schedule.tomorrow).toHaveLength(1);
    expect(snapshot.schedule.tomorrow[0].customerName).toBe("Ana Cruz");
    expect(snapshot.schedule.next7Days.map((s) => s.customerName)).toContain(
      "Ana Cruz",
    );
  });
});

describe("BuddyScheduleStop shape", () => {
  it("is used by snapshot builder with gallons from waterRefills", () => {
    const snapshot = buildBusinessBuddySnapshot(
      emptyLoadData([
        openDelivery({
          referenceId: "TX-GAL",
          customerName: "Gallon Test",
          scheduledAt: new Date("2026-06-18T02:00:00.000Z"),
          waterRefills: [
            { waterTypeId: "purified", quantity: 3 },
            { waterTypeId: "operating_expense", quantity: 99 },
          ],
        }),
      ]),
      NOW,
    );
    const stop = snapshot.schedule.tomorrow[0] as BuddyScheduleStop;
    expect(stop.gallons).toBe(3);
  });
});
