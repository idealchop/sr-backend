import { isSmartrefillDeployedDevTier } from "../config/dev-tier";
import { isSmartrefillDevMode } from "./smartrefill-env-mode";

export type BrevoEmailContact = {
  email?: string;
  name?: string;
};

/** Payload fields we rewrite for non-production safety. */
export type BrevoOutboundEmailPayload = {
  to?: BrevoEmailContact[] | null;
  cc?: BrevoEmailContact[] | null;
  bcc?: BrevoEmailContact[] | null;
  subject?: string | null;
};

const DEFAULT_DEV_EMAIL_SINK = "support@riverph.com";

function isFunctionsEmulator(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.FUNCTIONS_EMULATOR === "1"
  );
}

/**
 * Local (`SMARTREFILL_ENV_DEV`), deployed Dev tier, and Functions emulator
 * must not email real customers.
 */
export function shouldRedirectOutboundEmail(): boolean {
  return (
    isSmartrefillDevMode() ||
    isSmartrefillDeployedDevTier() ||
    isFunctionsEmulator()
  );
}

/** Dev/local sink inbox (default support@riverph.com). */
export function resolveDevEmailSink(): string {
  const fromSupport = process.env.SUPPORT_EMAIL?.trim();
  if (fromSupport?.includes("@")) return fromSupport.toLowerCase();
  const fromSink = process.env.SMARTREFILL_EMAIL_SINK?.trim();
  if (fromSink?.includes("@")) return fromSink.toLowerCase();
  return DEFAULT_DEV_EMAIL_SINK;
}

function collectEmails(list?: BrevoEmailContact[] | null): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const row of list) {
    const email = String(row?.email || "")
      .trim()
      .toLowerCase();
    if (email.includes("@") && !out.includes(email)) out.push(email);
  }
  return out;
}

/**
 * Rewrites `to` / `cc` / `bcc` to the Dev sink and prefixes the subject with
 * the intended recipients so support can see who would have been emailed.
 */
export function applyDevOutboundEmailRedirect(
  payload: BrevoOutboundEmailPayload,
): { redirected: boolean; originalRecipients: string[]; sink: string } {
  if (!shouldRedirectOutboundEmail()) {
    return { redirected: false, originalRecipients: [], sink: "" };
  }

  const sink = resolveDevEmailSink();
  const originalRecipients = [
    ...collectEmails(payload.to),
    ...collectEmails(payload.cc),
    ...collectEmails(payload.bcc),
  ];

  payload.to = [{ email: sink, name: "Smart Refill Dev" }];
  payload.cc = undefined;
  payload.bcc = undefined;

  const intended =
    originalRecipients.filter((e) => e !== sink).join(", ") || "(none)";
  const prefix = `[DEV → ${intended}] `;
  const subject = String(payload.subject || "").trim();
  if (subject && !/^\[DEV\b/i.test(subject)) {
    payload.subject = `${prefix}${subject}`;
  } else if (!subject) {
    payload.subject = `${prefix}(no subject)`;
  }

  return { redirected: true, originalRecipients, sink };
}
