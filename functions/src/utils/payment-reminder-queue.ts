import { coerceToDate, manilaDateKey } from "./philippine-datetime";
import type { DebtAgingCustomerRow } from "./analytics-utils";
import type { Customer } from "../services/customers/customer-service";

export type PaymentReminderTier = 30 | 60 | 90;

export type PaymentReminderPrefs = {
  paymentReminderEnabled: boolean;
  paymentReminder30Enabled: boolean;
  paymentReminder60Enabled: boolean;
  paymentReminder90Enabled: boolean;
};

export type PaymentReminderQueueRow = {
  customerId: string;
  name: string;
  amount: number;
  oldestDebtDays: number;
  reminderTier: PaymentReminderTier;
};

function startOfManilaDay(d: Date): Date {
  const key = manilaDateKey(d);
  return new Date(`${key}T00:00:00+08:00`);
}

export function reminderTierForDays(
  days: number,
  prefs: PaymentReminderPrefs,
): PaymentReminderTier | null {
  if (days >= 90 && prefs.paymentReminder90Enabled) return 90;
  if (days >= 60 && prefs.paymentReminder60Enabled) return 60;
  if (days >= 30 && prefs.paymentReminder30Enabled) return 30;
  return null;
}

export function wasRemindedToday(
  lastRemindedAt: unknown,
  now = new Date(),
): boolean {
  if (!lastRemindedAt) return false;
  const reminded = coerceToDate(lastRemindedAt);
  if (!reminded) return false;
  const today = startOfManilaDay(now);
  const remindedDay = startOfManilaDay(reminded);
  return today.getTime() === remindedDay.getTime();
}

export function buildPaymentReminderQueue(
  debtRows: DebtAgingCustomerRow[],
  customers: Customer[],
  prefs: PaymentReminderPrefs,
  now = new Date(),
): PaymentReminderQueueRow[] {
  if (!prefs.paymentReminderEnabled) return [];

  const customerById = new Map<string, Customer>();
  for (const customer of customers) {
    if (customer.id) customerById.set(customer.id, customer);
  }
  const queue: PaymentReminderQueueRow[] = [];

  for (const row of debtRows) {
    const tier = reminderTierForDays(row.oldestDebtDays, prefs);
    if (!tier) continue;

    const customer = customerById.get(row.customerId);
    if (wasRemindedToday(customer?.lastRemindedAt, now)) continue;

    queue.push({
      customerId: row.customerId,
      name: row.name,
      amount: row.amount,
      oldestDebtDays: row.oldestDebtDays,
      reminderTier: tier,
    });
  }

  queue.sort(
    (a, b) =>
      b.oldestDebtDays - a.oldestDebtDays ||
      b.amount - a.amount ||
      a.name.localeCompare(b.name),
  );

  return queue;
}
