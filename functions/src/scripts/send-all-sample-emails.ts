/**
 * Send one sample of every SmartRefill transactional email via Brevo.
 *
 * Usage (from backend/functions):
 *   npx ts-node --transpile-only src/scripts/send-all-sample-emails.ts you@example.com
 *
 * Does not apply the Dev outbound sink so the intended inbox receives samples.
 */
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";
import * as brevo from "@getbrevo/brevo";
import {
  getEmailVerificationEmail,
  getPasswordResetEmail,
} from "../utils/auth-transactional-email";
import { getStaffEmailVerificationEmail } from "../utils/staff-email-verification-template";
import { getTeamWorkspaceInviteEmail } from "../utils/email-templates";
import {
  getInquiryLeadEmail,
  getPartnerApplicationLeadEmail,
  getRequestDemoConfirmEmail,
  getRequestDemoLeadEmail,
} from "../utils/marketing-lead-email-templates";
import {
  buildMemberWebinarConfirmationEmail,
  buildMemberWebinarReminderEmail,
  buildWebinarApprovedEmail,
} from "../utils/webinar-transactional-email-templates";
import {
  buildGuestWebinarInviteEmail,
  buildGuestWebinarReminderEmail,
} from "../utils/guest-webinar-invite-email-template";
import { buildResourcesVideoPublishedOwnerEmail } from "../utils/resources-video-published-owner-email-template";
import { buildTutorialPublishedOwnerEmail } from "../utils/tutorial-published-owner-email-template";
import { getPortalCompletionReceiptEmail } from "../utils/portal-completion-receipt-email-templates";
import { buildCustomerPaymentUpdateEmail } from "../utils/customer-payment-update-email-template";
import { buildPortalOrderReceivedEmail } from "../utils/portal-order-received-email-template";
import { buildCustomerTxnStatusEmail } from "../utils/customer-txn-status-email-template";
import { buildMorningBriefEmail } from "../utils/morning-brief-email-template";
import { buildMaintenanceOverdueOwnerEmail } from "../utils/maintenance-overdue-email-template";
import { buildPaymentReminderOwnerEmail } from "../utils/payment-reminder-owner-email-template";
import { buildDormantDigestEmail } from "../utils/dormant-digest-email-template";
import { buildInactiveAccountDeactivationEmail } from "../utils/inactive-account-deactivation-email-template";
import {
  buildSmartRefillEmailLegalFooterHtml,
  buildSmartRefillEmailLegalFooterPlainText,
} from "../utils/smartrefill-email-legal-footer";

function loadEnv(): void {
  const functionsDir = resolve(__dirname, "../..");
  const riverRoot = resolve(functionsDir, "../../..");
  const candidates = [
    resolve(riverRoot, "sales-portal/backend/functions/.env.local"),
    resolve(functionsDir, ".secret.local"),
    resolve(functionsDir, ".env.bak"),
    resolve(functionsDir, ".env"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) dotenv.config({ path: file });
  }
}

loadEnv();

type Sample = {
  app: "smartrefill";
  tag: string;
  subject: string;
  html: string;
  text: string;
};

const ORIGIN = "https://smartrefill.io";
const OWNER = "Justfer";
const STATION = "Smart Refill Demo";
const SAMPLE_EMAIL = "justfer@riverph.com";
const VERIFY = `${ORIGIN}/verified?oobCode=sample`;
const RESET = `${ORIGIN}/reset-password?oobCode=sample`;
const TRACK = `${ORIGIN}/track/SR-DEMO-1042`;
const DASH = `${ORIGIN}/dashboard`;

function digest(tag: string, subject: string, html: string, text: string): {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
} {
  const withFooter = html.includes("Privacy Policy") ?
    html :
    html.replace(
      "</body></html>",
      `${buildSmartRefillEmailLegalFooterHtml()}</body></html>`,
    );
  return {
    subject,
    html: withFooter,
    text: `${text}\n\n${buildSmartRefillEmailLegalFooterPlainText()}`,
    brevoTag: tag,
  };
}

function samples(): Sample[] {
  const demoLead = {
    name: OWNER,
    email: SAMPLE_EMAIL,
    phone: "+63 917 000 0000",
    businessName: STATION,
    stationCount: "1",
    requestedDate: "2026-09-22",
    requestedTime: "2:00 PM",
    demoSlotLabel: "Tue, Sep 22, 2026 · 2:00 PM Asia/Manila",
    meetLink: "https://meet.google.com/sample-demo",
  };

  const webinar = {
    displayName: OWNER,
    eventName: "Smart Refill webinar (sample)",
    startsAtLabel: "Fri, Sep 25, 2026, 2:00 PM",
    timezone: "Asia/Manila",
    hubUrl: `${ORIGIN}/resources/webinars`,
    joinUrl: `${ORIGIN}/resources/webinars`,
    cancelUrl: `${ORIGIN}/resources/webinars`,
    feedbackUrl: `${ORIGIN}/resources/webinars/feedback?event=sample`,
    requiresApproval: false,
  };

  const brand = { businessName: STATION, businessLogoUrl: null as string | null };

  return [
    { app: "smartrefill", ...getPasswordResetEmail({
      displayName: OWNER, email: SAMPLE_EMAIL, resetLink: RESET,
    }) },
    { app: "smartrefill", ...getEmailVerificationEmail({
      displayName: OWNER, email: SAMPLE_EMAIL, verificationLink: VERIFY,
    }) },
    { app: "smartrefill", ...getStaffEmailVerificationEmail({
      displayName: "Ana Rider",
      email: SAMPLE_EMAIL,
      verificationLink: VERIFY,
      workspaceName: STATION,
      memberRole: "rider",
    }) },
    {
      app: "smartrefill",
      ...getTeamWorkspaceInviteEmail({
        acceptInviteUrl: `${ORIGIN}/invite/sample-token`,
        inviterName: OWNER,
        inviteeDisplayName: "Ana Rider",
        inviteeEmail: SAMPLE_EMAIL,
        organizationName: STATION,
        roleKey: "rider",
        validityDays: 7,
      }),
      brevoTag: "team_workspace_invite",
    },
    { app: "smartrefill", ...getRequestDemoLeadEmail(demoLead) },
    { app: "smartrefill", ...getRequestDemoConfirmEmail(demoLead) },
    { app: "smartrefill", ...getInquiryLeadEmail({
      firstName: "Justfer",
      lastName: "River",
      email: SAMPLE_EMAIL,
      phone: "+63 917 000 0000",
      company: STATION,
      businessAddress: "Poblacion, Muntinlupa",
      message: "Sample partnership inquiry for the email gallery.",
    }) },
    { app: "smartrefill", ...getPartnerApplicationLeadEmail({
      firstName: "Justfer",
      lastName: "River",
      email: SAMPLE_EMAIL,
      phone: "+63 917 000 0000",
      stationName: STATION,
      address: "Poblacion, Muntinlupa",
      waterTypes: "Purified, Alkaline",
      hasPermits: "Yes",
      stationAge: "3 years",
      deliveryVehicles: "1 motorcycle",
      productionCapacity: "3000 gal/day",
      preferredClients: "Households",
      providesContainers: "Yes",
      providesDispensers: "No",
      onboardingSchedule: "Next week",
    }) },
    { app: "smartrefill", ...buildMemberWebinarConfirmationEmail(webinar) },
    { app: "smartrefill", ...buildWebinarApprovedEmail(webinar) },
    { app: "smartrefill", ...buildMemberWebinarReminderEmail(webinar) },
    { app: "smartrefill", ...buildGuestWebinarInviteEmail(webinar) },
    { app: "smartrefill", ...buildGuestWebinarReminderEmail({
      displayName: webinar.displayName,
      eventName: webinar.eventName,
      startsAtLabel: webinar.startsAtLabel,
      timezone: webinar.timezone,
      joinUrl: webinar.joinUrl,
      cancelUrl: webinar.cancelUrl,
      feedbackUrl: webinar.feedbackUrl,
    }) },
    { app: "smartrefill", ...buildTutorialPublishedOwnerEmail({
      ownerName: OWNER,
      businessName: STATION,
      tutorialName: "Record a delivery (sample)",
      watchUrl: `${ORIGIN}/dashboard`,
    }) },
    { app: "smartrefill", ...buildResourcesVideoPublishedOwnerEmail({
      ownerName: OWNER,
      businessName: STATION,
      videoName: "How a Poblacion station grew with Smart Refill",
      categoryLabel: "WRS Story",
      watchUrl: `${ORIGIN}/resources`,
    }) },
    { app: "smartrefill", ...getPortalCompletionReceiptEmail({
      customerName: "Maria Santos",
      businessName: STATION,
      referenceId: "SR-DEMO-1042",
      completedAt: "Sep 20, 2026, 10:15 AM",
      totalAmount: "250.00",
      amountPaid: "250.00",
      balanceDue: "0.00",
      paymentMethod: "Cash",
      paymentStatus: "Paid",
    }) },
    { app: "smartrefill", ...buildPortalOrderReceivedEmail({
      customerName: "Maria Santos",
      ...brand,
      referenceId: "SR-DEMO-1042",
      trackUrl: TRACK,
      scheduledLabel: "Today, 3:00 PM",
    }) },
    { app: "smartrefill", ...buildCustomerTxnStatusEmail({
      customerName: "Maria Santos",
      ...brand,
      referenceId: "SR-DEMO-1042",
      statusLabel: "Out for delivery",
      trackUrl: TRACK,
      detailLine: "Your rider is on the way with 5× Purified.",
    }) },
    { app: "smartrefill", ...buildCustomerPaymentUpdateEmail({
      customerName: "Maria Santos",
      ...brand,
      referenceId: "SR-DEMO-1042",
      trackUrl: TRACK,
      statusLabel: "Partial payment recorded",
      totalAmount: "₱250.00",
      amountPaid: "₱100.00",
      balanceDue: "₱150.00",
      detailLine: "We recorded ₱100 today. Remaining balance is ₱150.",
    }) },
    { app: "smartrefill", ...buildMorningBriefEmail({
      ownerName: OWNER,
      businessName: STATION,
      briefTitle: "Morning brief",
      briefSummary: "Quiet sukis first. Two deliveries are already late vs usual Monday cadence.",
      highlights: ["3 inactive sukis to call", "Unpaid ₱1,250", "Peak hour 10–11 AM"],
      actionItems: [{ label: "Call Aling Nena", detail: "No order in 18 days" }],
      dashboardUrl: DASH,
    }) },
    { app: "smartrefill", ...buildDormantDigestEmail({
      businessName: STATION,
      ownerName: OWNER,
      dormantCount: 3,
      revenueAtRiskPhp: 2400,
      cadenceLateCount: 2,
      dashboardUrl: DASH,
      morningBriefSummary: "Call the 3 quiet sukis before noon.",
    }) },
    { app: "smartrefill", ...buildPaymentReminderOwnerEmail({
      ownerName: OWNER,
      businessName: STATION,
      dashboardUrl: DASH,
      queue: [
        { customerId: "c1", name: "Aling Nena", amount: 450, oldestDebtDays: 32, reminderTier: 30 },
        { customerId: "c2", name: "Kuya Ben", amount: 800, oldestDebtDays: 61, reminderTier: 60 },
      ],
    }) },
    { app: "smartrefill", ...buildMaintenanceOverdueOwnerEmail({
      ownerName: OWNER,
      businessName: STATION,
      overdueNames: ["Sediment filter", "UV lamp"],
      overdueCount: 2,
      dashboardUrl: `${ORIGIN}/plant`,
    }) },
    { app: "smartrefill", ...buildInactiveAccountDeactivationEmail({
      ownerName: OWNER,
      businessName: STATION,
      loginUrl: `${ORIGIN}/login`,
    }) },
    digest(
      "weekly_performance_email",
      `Weekly performance · ${STATION}`,
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Weekly performance</h1>
        <p>Revenue this week: <strong>₱12,450</strong> (+18% vs prior week)</p>
        <p>Peak hour: 10–11 AM · Unpaid total: ₱1,250</p>
        <p>Dormant sukis: 3 · Revenue at risk: ₱2,400</p>
        <p><strong>Top sukis</strong></p><ul><li>Maria Santos — ₱1,800</li><li>Aling Nena — ₱950</li></ul>
        <p><a href="${DASH}">Open Command Center</a></p>
      </body></html>`,
      "Weekly performance sample",
    ),
    digest(
      "subscription_lifecycle_email",
      `Billing update · ${STATION}`,
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Subscription update</h1>
        <p>Your Scale plan renews on Oct 20, 2026.</p>
        <p><a href="${ORIGIN}/account">Manage plan</a></p>
      </body></html>`,
      "Scale renews Oct 20, 2026",
    ),
    digest(
      "production_variance_email",
      `Plant vs sales mismatch · ${STATION}`,
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Production variance alert</h1>
        <p>Plant output is 18% below ledger refill sales for the last 3 days.</p>
        <p><a href="${DASH}">Review dashboard</a></p>
      </body></html>`,
      "Plant output 18% below sales",
    ),
    digest(
      "low_stock_digest_email",
      "Low stock digest · 2 SKUs",
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Items below minimum</h1>
        <table width="100%" cellspacing="0">
          <tr><td>Slim cap</td><td align="right">4 pcs</td><td align="right">min 20</td></tr>
          <tr><td>Round seal</td><td align="right">8 pcs</td><td align="right">min 15</td></tr>
        </table>
        <p><a href="${ORIGIN}/inventory">Open Inventory</a></p>
      </body></html>`,
      "Slim cap 4/20 · Round seal 8/15",
    ),
    digest(
      "team_activity_digest_email",
      `Team activity digest · ${STATION}`,
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Last 7 days</h1>
        <ul><li>New sukis onboarded: <strong>4</strong></li>
        <li>Deliveries / collections completed: <strong>37</strong></li></ul>
        <p><a href="${DASH}">Open Command Center</a></p>
      </body></html>`,
      "New sukis: 4 · Completed stops: 37",
    ),
    digest(
      "advance_payment_receipt",
      `Payment received SR-DEMO-1042 · ${STATION}`,
      `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:24px;">
        <h1 style="font-size:20px;">Advance payment received</h1>
        <p>Hi Maria Santos,</p>
        <p>We received your payment of <strong>₱250</strong> on Sep 20, 2026, 9:40 AM.</p>
        <p>Reference: <strong>SR-DEMO-1042</strong></p>
        <p><a href="${TRACK}">Track order</a></p>
      </body></html>`,
      "Payment received ₱250 · SR-DEMO-1042",
    ),
  ].map((row) => ({
    app: "smartrefill",
    tag: row.brevoTag,
    subject: row.subject,
    html: row.html,
    text: row.text,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function main(): Promise<void> {
  const sendLive = process.argv.includes("--send");
  const email = String(
    process.argv.find((arg) => arg.includes("@")) || SAMPLE_EMAIL,
  ).trim().toLowerCase();
  if (sendLive && !email.includes("@")) {
    throw new Error("Pass a recipient email as the first argument.");
  }
  const apiKey = process.env.SMARTREFILL_BREVO_API_KEY?.trim();
  if (sendLive && !apiKey) {
    throw new Error("SMARTREFILL_BREVO_API_KEY is missing");
  }

  const outDir = resolve("/tmp/river-email-samples/smartrefill");
  mkdirSync(outDir, { recursive: true });

  const api = sendLive ? new brevo.TransactionalEmailsApi() : null;
  if (api && apiKey) {
    api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
  }
  const rows = samples();
  const indexItems: string[] = [];
  for (const row of rows) {
    const file = resolve(outDir, `${row.tag}.html`);
    writeFileSync(file, row.html, "utf8");
    indexItems.push(
      `<li><a href="./${row.tag}.html">${row.tag}</a> — ${row.subject.replace(/</g, "&lt;")}</li>`,
    );
    console.log(`wrote ${row.tag}`);
    if (!sendLive || !api) continue;
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
    sendSmtpEmail.to = [{ email, name: OWNER }];
    sendSmtpEmail.subject = `[SAMPLE] ${row.subject}`;
    sendSmtpEmail.htmlContent = row.html;
    sendSmtpEmail.textContent = row.text;
    sendSmtpEmail.tags = [row.tag, "email_template_sample"];
    await api.sendTransacEmail(sendSmtpEmail);
    console.log(`sent ${row.tag}`);
    await sleep(250);
  }
  writeFileSync(
    resolve(outDir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SmartRefill email samples</title></head>
<body style="font-family:system-ui;padding:24px;max-width:720px;">
<h1>SmartRefill email samples</h1>
<p>${rows.length} templates</p>
<ul>${indexItems.join("")}</ul>
</body></html>`,
    "utf8",
  );
  console.log(`Wrote ${rows.length} HTML files to ${outDir}`);
  if (sendLive) {
    console.log(`Sent ${rows.length} SmartRefill samples to ${email}`);
  } else {
    console.log("HTML-only (pass --send to deliver via Brevo)");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
