import { describe, expect, it } from "vitest";
import {
  buildPaymentReminderQueue,
  reminderTierForDays,
  wasRemindedToday,
} from "../../../utils/payment-reminder-queue";
import type { DebtAgingCustomerRow } from "../../../utils/analytics-utils";

const prefs = {
  paymentReminderEnabled: true,
  paymentReminder30Enabled: true,
  paymentReminder60Enabled: true,
  paymentReminder90Enabled: true,
};

describe("payment-reminder-queue", () => {
  it("maps debt age to reminder tiers", () => {
    expect(reminderTierForDays(29, prefs)).toBeNull();
    expect(reminderTierForDays(30, prefs)).toBe(30);
    expect(reminderTierForDays(60, prefs)).toBe(60);
    expect(reminderTierForDays(90, prefs)).toBe(90);
  });

  it("builds queue sorted by oldest debt first", () => {
    const debtRows: DebtAgingCustomerRow[] = [
      {
        customerId: "c1",
        name: "Ana",
        amount: 500,
        oldestDebtDays: 45,
      },
      {
        customerId: "c2",
        name: "Ben",
        amount: 1200,
        oldestDebtDays: 92,
      },
    ];
    const queue = buildPaymentReminderQueue(debtRows, [], prefs);
    expect(queue.map((r) => r.customerId)).toEqual(["c2", "c1"]);
    expect(queue[0].reminderTier).toBe(90);
  });

  it("skips customers reminded today", () => {
    const now = new Date("2026-06-16T10:00:00+08:00");
    const debtRows: DebtAgingCustomerRow[] = [
      {
        customerId: "c1",
        name: "Ana",
        amount: 500,
        oldestDebtDays: 45,
      },
    ];
    const customers = [
      {
        id: "c1",
        name: "Ana",
        lastRemindedAt: now.toISOString(),
      },
    ] as Parameters<typeof buildPaymentReminderQueue>[1];
    expect(wasRemindedToday(now.toISOString(), now)).toBe(true);
    expect(buildPaymentReminderQueue(debtRows, customers, prefs, now)).toEqual(
      [],
    );
  });
});
