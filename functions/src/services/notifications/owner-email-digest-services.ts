import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { InventoryService } from "../inventory/inventory-service";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import { computePeakDemandSummary } from "../../utils/peak-demand-analytics";
import { buildProductionVarianceAlert } from "../../utils/production-variance-alert";
import { listLowStockItems } from "../../utils/inventory-reorder-alert";
import { buildSubscriptionLifecycleSnapshot } from "../../utils/subscription-lifecycle-alert";
import { ProductionShiftService } from "../plant/production-shift-service";
import { escapeHtmlForEmail } from "../../utils/auth-transactional-email";
import {
  coerceToDate,
  isManilaMonday,
  isManilaSunday,
  manilaDateKey,
  manilaHour,
  formatFirestorePhilippineDateTime,
} from "../../utils/philippine-datetime";
import type { Transaction } from "../transactions/transaction-service";
import type { Customer } from "../customers/customer-service";

const TX_LIMIT = 2000;

type EmailTpl = { subject: string; html: string; text: string; brevoTag: string };

function ownerSendHourOk(
  uiConfig: Record<string, unknown>,
  now: Date,
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  return manilaHour(now) === Number(prefs.dormantPushHour);
}

async function sendOwnerEmail(
  businessId: string,
  businessData: Record<string, unknown>,
  tpl: EmailTpl,
  lastSentField: string,
  now: Date,
): Promise<boolean> {
  const recipient = await resolveOwnerEmailForBusiness(businessData);
  if (!recipient) return false;

  const businessRef = db.collection("businesses").doc(businessId);
  const dateKey = manilaDateKey(now);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info(`EMULATOR: ${tpl.brevoTag}`, {
      businessId,
      email: recipient.email,
    });
    await businessRef.set(
      { [lastSentField]: dateKey, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return true;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email: recipient.email, name: recipient.name }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];
  await api.sendTransacEmail(sendSmtpEmail);

  await businessRef.set(
    { [lastSentField]: dateKey, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return true;
}

function sumPaidRevenueBetween(
  transactions: Transaction[],
  start: Date,
  end: Date,
): number {
  let total = 0;
  for (const tx of transactions) {
    const paid = Number(tx.amountPaid) || 0;
    if (paid <= 0) continue;
    const d =
      coerceToDate(tx.deliveredAt) ??
      coerceToDate(tx.updatedAt) ??
      coerceToDate(tx.scheduledAt) ??
      coerceToDate(tx.createdAt);
    if (!d || d < start || d > end) continue;
    total += paid;
  }
  return total;
}

function topCustomersByRevenue(
  transactions: Transaction[],
  customers: Customer[],
  start: Date,
  end: Date,
  limit = 5,
): Array<{ name: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.customerId) continue;
    const paid = Number(tx.amountPaid) || 0;
    if (paid <= 0) continue;
    const d =
      coerceToDate(tx.deliveredAt) ??
      coerceToDate(tx.updatedAt) ??
      coerceToDate(tx.scheduledAt) ??
      coerceToDate(tx.createdAt);
    if (!d || d < start || d > end) continue;
    totals.set(tx.customerId, (totals.get(tx.customerId) ?? 0) + paid);
  }
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  return [...totals.entries()]
    .map(([id, amount]) => ({
      name: String(nameById.get(id) || "Customer"),
      amount,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** NT-23 — Sunday weekly performance summary email. */
export async function sendWeeklyPerformanceEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (resolveNotificationPreferencesFromUiConfig(uiConfig).weeklyPerformanceEmailEnabled !== true) {
    return { sent: false };
  }
  if (!isManilaSunday(now) || !ownerSendHourOk(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.weeklyPerformanceEmailLastSentWeek === "string" ?
      data.weeklyPerformanceEmailLastSentWeek :
      undefined;
  const weekKey = manilaDateKey(now);
  if (lastSent === weekKey) return { sent: false };

  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const priorStart = new Date(start);
  priorStart.setDate(priorStart.getDate() - 7);

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const thisWeek = sumPaidRevenueBetween(transactions, start, end);
  const priorWeek = sumPaidRevenueBetween(transactions, priorStart, start);
  const deltaPct =
    priorWeek > 0 ?
      Math.round(((thisWeek - priorWeek) / priorWeek) * 100) :
      thisWeek > 0 ?
        100 :
        0;
  const debt = computeDebtAgingBreakdown(transactions, customers);
  const unpaidTotal = debt.rows.reduce((s, r) => s + r.amount, 0);
  const dormant = buildDormantSignalsSnapshot(customers, transactions);
  const peak = computePeakDemandSummary(transactions, now);
  const top = topCustomersByRevenue(transactions, customers, start, end);

  const businessName = String(data.name || "Your station");
  const subject = `Weekly performance · ${businessName}`;
  const topLines = top
    .map((row) => `<li>${escapeHtmlForEmail(row.name)} — ₱${Math.round(row.amount).toLocaleString("en-PH")}</li>`)
    .join("");
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Weekly performance</h1>
  <p>Revenue this week: <strong>₱${Math.round(thisWeek).toLocaleString("en-PH")}</strong> (${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs prior week)</p>
  <p>Peak hour: ${escapeHtmlForEmail(peak.busiestHourLabel || "—")} · Unpaid total: ₱${Math.round(unpaidTotal).toLocaleString("en-PH")}</p>
  <p>Dormant sukis: ${Number(dormant.dormantCount) || 0} · Revenue at risk: ₱${Math.round(Number(dormant.revenueAtRiskPhp) || 0).toLocaleString("en-PH")}</p>
  <p><strong>Top sukis</strong></p><ul>${topLines || "<li>—</li>"}</ul>
  <p><a href="${escapeHtmlForEmail(`${resolveAppBaseUrlForEmail()}/dashboard`)}">Open Command Center</a></p>
</body></html>`;
  const text = [
    `Weekly performance — ${businessName}`,
    `Revenue: ₱${thisWeek.toFixed(2)} (${deltaPct}% vs prior week)`,
    `Unpaid: ₱${unpaidTotal.toFixed(2)} · Dormant: ${Number(dormant.dormantCount) || 0}`,
    ...top.map((r) => `${r.name}: ₱${r.amount.toFixed(2)}`),
  ].join("\n");

  const sent = await sendOwnerEmail(
    businessId,
    data,
    { subject, html, text, brevoTag: "weekly_performance_email" },
    "weeklyPerformanceEmailLastSentWeek",
    now,
  );
  return { sent };
}

/** NT-24 — subscription lifecycle email (expiring / expired). */
export async function sendSubscriptionLifecycleEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (resolveNotificationPreferencesFromUiConfig(uiConfig).subscriptionEmailEnabled !== true) {
    return { sent: false };
  }
  if (!ownerSendHourOk(uiConfig, now)) return { sent: false };

  const lifecycle = await buildSubscriptionLifecycleSnapshot(businessId, now);
  if (!lifecycle.active || !lifecycle.headline) return { sent: false };

  const lastSent =
    typeof data.subscriptionEmailLastSentDate === "string" ?
      data.subscriptionEmailLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const businessName = String(data.name || "Your station");
  const subject = `Billing update · ${businessName}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Subscription update</h1>
  <p>${escapeHtmlForEmail(lifecycle.headline)}</p>
  <p><a href="${escapeHtmlForEmail(`${resolveAppBaseUrlForEmail()}/account`)}">Manage plan</a></p>
</body></html>`;
  const text = `${lifecycle.headline}\nAccount: ${resolveAppBaseUrlForEmail()}/account`;

  const sent = await sendOwnerEmail(
    businessId,
    data,
    { subject, html, text, brevoTag: "subscription_lifecycle_email" },
    "subscriptionEmailLastSentDate",
    now,
  );
  return { sent };
}

/** NT-26 — production variance email when alert is active (max 1/day). */
export async function sendProductionVarianceEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.productionVarianceEmailEnabled !== true) {
    return { sent: false };
  }
  if (!ownerSendHourOk(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.productionVarianceEmailLastSentDate === "string" ?
      data.productionVarianceEmailLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const [shifts, transactions] = await Promise.all([
    ProductionShiftService.list(businessId, { limit: 14 }),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);
  const alert = buildProductionVarianceAlert({ shifts, transactions, uiConfig, now });
  if (!alert.active || !alert.headline) return { sent: false };

  const businessName = String(data.name || "Your station");
  const subject = `Plant vs sales mismatch · ${businessName}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Production variance alert</h1>
  <p>${escapeHtmlForEmail(alert.headline)}</p>
  <p><a href="${escapeHtmlForEmail(`${resolveAppBaseUrlForEmail()}/dashboard`)}">Review dashboard</a></p>
</body></html>`;
  const text = `${alert.headline}\n${resolveAppBaseUrlForEmail()}/dashboard`;

  const sent = await sendOwnerEmail(
    businessId,
    data,
    { subject, html, text, brevoTag: "production_variance_email" },
    "productionVarianceEmailLastSentDate",
    now,
  );
  return { sent };
}

/** NT-27 — weekly low stock digest (Monday). */
export async function sendLowStockDigestEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean; itemCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false, itemCount: 0 };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (resolveNotificationPreferencesFromUiConfig(uiConfig).lowStockEmailEnabled !== true) {
    return { sent: false, itemCount: 0 };
  }
  if (!isManilaMonday(now) || !ownerSendHourOk(uiConfig, now)) {
    return { sent: false, itemCount: 0 };
  }

  const lastSent =
    typeof data.lowStockEmailLastSentWeek === "string" ?
      data.lowStockEmailLastSentWeek :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false, itemCount: 0 };

  const inventory = await InventoryService.listItems(businessId);
  const lowStock = listLowStockItems(inventory);
  if (lowStock.length === 0) return { sent: false, itemCount: 0 };

  const rows = lowStock
    .slice(0, 20)
    .map(
      (row) =>
        `<tr><td>${escapeHtmlForEmail(row.name)}</td>` +
        `<td align="right">${row.current} ${escapeHtmlForEmail(row.unit)}</td>` +
        `<td align="right">min ${row.min}</td></tr>`,
    )
    .join("");

  const subject = `Low stock digest · ${lowStock.length} SKU${lowStock.length === 1 ? "" : "s"}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Items below minimum</h1>
  <table width="100%" cellspacing="0">${rows}</table>
  <p><a href="${escapeHtmlForEmail(`${resolveAppBaseUrlForEmail()}/inventory`)}">Open Inventory</a></p>
</body></html>`;
  const text = lowStock
    .map((r) => `${r.name}: ${r.current}/${r.min} ${r.unit}`)
    .join("\n");

  const sent = await sendOwnerEmail(
    businessId,
    data,
    { subject, html, text, brevoTag: "low_stock_digest_email" },
    "lowStockEmailLastSentWeek",
    now,
  );
  return { sent, itemCount: lowStock.length };
}

/** NT-29 — weekly team activity digest (Monday). */
export async function sendTeamActivityDigestEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (resolveNotificationPreferencesFromUiConfig(uiConfig).teamDigestEmailEnabled !== true) {
    return { sent: false };
  }
  if (!isManilaMonday(now) || !ownerSendHourOk(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.teamDigestEmailLastSentWeek === "string" ?
      data.teamDigestEmailLastSentWeek :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const newCustomers = customers.filter((c) => {
    const d = coerceToDate(c.createdAt);
    return d != null && d >= weekAgo;
  }).length;

  const completedDeliveries = transactions.filter((tx) => {
    if (tx.type !== "delivery" && tx.type !== "collection") return false;
    const st = String(tx.deliveryStatus || "");
    if (!["delivered", "collected", "completed"].includes(st)) return false;
    const d = coerceToDate(tx.deliveredAt) ?? coerceToDate(tx.updatedAt);
    return d != null && d >= weekAgo;
  }).length;

  const businessName = String(data.name || "Your station");
  const subject = `Team activity digest · ${businessName}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Last 7 days</h1>
  <ul>
    <li>New sukis onboarded: <strong>${newCustomers}</strong></li>
    <li>Deliveries / collections completed: <strong>${completedDeliveries}</strong></li>
  </ul>
  <p><a href="${escapeHtmlForEmail(`${resolveAppBaseUrlForEmail()}/dashboard`)}">Open Command Center</a></p>
</body></html>`;
  const text = `New sukis: ${newCustomers}\nCompleted stops: ${completedDeliveries}`;

  const sent = await sendOwnerEmail(
    businessId,
    data,
    { subject, html, text, brevoTag: "team_activity_digest_email" },
    "teamDigestEmailLastSentWeek",
    now,
  );
  return { sent };
}

/** NT-30 — advance payment receipt email to suki (portal wallet top-up). */
export async function sendAdvancePaymentReceiptEmail(args: {
  businessId: string;
  customerEmail: string;
  customerName: string;
  businessName: string;
  amount: number;
  referenceId: string;
  trackUrl: string;
  paidAt?: unknown;
}): Promise<{ sent: boolean }> {
  if (!args.customerEmail.includes("@")) return { sent: false };

  const amountLabel = `₱${Math.round(args.amount).toLocaleString("en-PH")}`;
  const paidWhen = formatFirestorePhilippineDateTime(args.paidAt ?? new Date());
  const subject = `Payment received ${args.referenceId} · ${args.businessName}`;
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
  <h1 style="font-size:20px;">Advance payment received</h1>
  <p>Hi ${escapeHtmlForEmail(args.customerName)},</p>
  <p>We received your payment of <strong>${amountLabel}</strong> on ${escapeHtmlForEmail(paidWhen)}.</p>
  <p>Reference: <strong>${escapeHtmlForEmail(args.referenceId)}</strong></p>
  <p><a href="${escapeHtmlForEmail(args.trackUrl)}">Track order</a></p>
</body></html>`;
  const text = [
    `Payment received: ${amountLabel}`,
    `Reference: ${args.referenceId}`,
    `Track: ${args.trackUrl}`,
  ].join("\n");

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: advance payment receipt email", {
      businessId: args.businessId,
      email: args.customerEmail,
      referenceId: args.referenceId,
    });
    return { sent: true };
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: args.businessName.slice(0, 40),
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{
    email: args.customerEmail,
    name: args.customerName,
  }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;
  sendSmtpEmail.textContent = text;
  sendSmtpEmail.tags = ["advance_payment_receipt"];
  await api.sendTransacEmail(sendSmtpEmail);
  return { sent: true };
}
