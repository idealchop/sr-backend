import { getGeminiApiKey } from "../ai/gemini-config";
import { geminiGenerateJson } from "../ai/gemini-client";
import {
  COMMUNITY_FIELD_LABELS,
  type CommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  COMMUNITY_ORDER_TEMPLATE_BLOCK,
  buildCommunityOrderTemplateMessage,
} from "./community-order-template";

function formatMissingList(errors: string[]): string {
  return errors
    .map((key) => `• ${COMMUNITY_FIELD_LABELS[key] ?? key}`)
    .join("\n");
}

/** CP-04 — deterministic clarification when template fields are missing. */
export function buildCommunityClarificationMessage(
  errors: string[],
  partialFields?: CommunityOrderFields,
): string {
  const missing = formatMissingList(errors);
  const hasPartial =
    partialFields &&
    Object.values(partialFields).some((v) => v !== undefined && v !== "");

  const intro = hasPartial ?
    "Thank you — we received your order details and we're almost ready to route your request." :
    "Thank you for reaching out to River Smart Refill.";

  return [
    intro,
    "",
    "To complete your order, please provide:",
    missing,
    "",
    "You may reply with the missing details, or copy and resend the form below:",
    "",
    COMMUNITY_ORDER_TEMPLATE_BLOCK,
    "",
    "We're here to help — salamat po! 🙏",
  ].join("\n");
}

/** Acknowledgement when a pin is saved but the order is still incomplete. */
export function buildLocationPinReceivedMessage(errors: string[]): string {
  const lines = [
    "Salamat po — we received your location pin. 📍",
    "",
  ];

  if (errors.length > 0) {
    lines.push(
      "To finish your order, please send:",
      formatMissingList(errors),
      "",
      "You may copy our order form below and fill in the remaining lines:",
      "",
      COMMUNITY_ORDER_TEMPLATE_BLOCK,
      "",
    );
  }

  lines.push("Salamat po! 🙏");
  return lines.join("\n");
}

/** CP-29 — summary shown before routing AI / wizard orders. */
export function buildCommunityOrderConfirmSummary(
  fields: CommunityOrderFields,
): string {
  const deliveryLabel = fields.delivery ? "Delivery" : "Pickup";
  const lines = [
    "Please confirm your order:",
    "",
    `• Name: ${fields.name ?? "—"}`,
    `• ${deliveryLabel}: ${fields.qty ?? "—"} gal`,
    `• Mobile: ${fields.number ?? "—"}`,
  ];

  if (fields.delivery && fields.location) {
    lines.push(`• Address: ${fields.location}`);
  }
  if (fields.preferredWaterType) {
    lines.push(`• Water: ${fields.preferredWaterType}`);
  }
  if (fields.email) {
    lines.push(`• Email: ${fields.email}`);
  }

  lines.push("", "Tap Confirm order to send to nearby stations.");
  return lines.join("\n");
}

/** CP-04 confirmation when all required fields are present. */
export function buildCommunityOrderReceivedMessage(
  fields: CommunityOrderFields,
  referenceId?: string,
): string {
  const deliveryLabel = fields.delivery ? "Delivery" : "Pickup";
  const lines = [
    "Thank you — your order has been received. ✨",
    "",
  ];

  if (referenceId?.trim()) {
    lines.push(`Reference: ${referenceId.trim()}`, "");
  }

  lines.push(
    "Here's what we captured:",
    `• Name: ${fields.name}`,
    `• ${deliveryLabel}: ${fields.qty} gal`,
    `• Mobile: ${fields.number}`,
  );

  if (fields.delivery && fields.location) {
    lines.push(`• Location: ${fields.location}`);
  }
  if (fields.preferredWaterType) {
    lines.push(`• Water type: ${fields.preferredWaterType}`);
  }
  if (fields.email) {
    lines.push(`• Email: ${fields.email}`);
  }

  lines.push(
    "",
    "Our team is notifying nearby refilling stations. The first to accept will confirm your order.",
    "",
    "Salamat po for choosing River Smart Refill! 💧",
  );

  return lines.join("\n");
}

type RepairReply = { message: string; source: "ai" | "deterministic" };

/**
 * AI-48 — polite Messenger copy listing only missing template fields (fallback: CP-04).
 */
export async function buildCommunityTemplateRepairReply(params: {
  errors: string[];
  partialFields: CommunityOrderFields;
  rawMessage: string;
}): Promise<RepairReply> {
  const { errors, partialFields, rawMessage } = params;
  if (!errors.length) {
    return {
      message: buildCommunityOrderReceivedMessage(partialFields),
      source: "deterministic",
    };
  }

  if (!getGeminiApiKey()) {
    return {
      message: buildCommunityClarificationMessage(errors, partialFields),
      source: "deterministic",
    };
  }

  const missingLabels = errors.map((k) => COMMUNITY_FIELD_LABELS[k] ?? k);
  const filled = Object.entries(partialFields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");

  const ai = await geminiGenerateJson<{ message?: string }>({
    system:
      "You write short, professional, warm Messenger replies for a water refilling community page in the Philippines. " +
      "The customer sent a partial order form. Ask ONLY for the missing fields listed. " +
      "Use polite English with light Taglish (Salamat po). No markdown. Max 600 characters. " +
      "End by inviting them to complete the missing info. Output JSON: { message: string }.",
    user:
      `Missing fields: ${missingLabels.join(", ")}\n` +
      `Already provided: ${filled || "none"}\n` +
      `Customer message:\n${rawMessage.slice(0, 800)}`,
    fallback: {},
    temperature: 0.4,
    maxOutputTokens: 512,
  });

  const message =
    typeof ai.message === "string" && ai.message.trim().length > 20 ?
      ai.message.trim().slice(0, 900) :
      buildCommunityClarificationMessage(errors, partialFields);

  return { message, source: typeof ai.message === "string" ? "ai" : "deterministic" };
}

/** Wrap AI-04 clarifying question with template reminder. */
export function buildCommunityFreeTextClarificationMessage(
  clarifyingQuestion: string,
): string {
  return [
    clarifyingQuestion,
    "",
    "Or, if you prefer, use our order form:",
    "",
    buildCommunityOrderTemplateMessage(),
  ].join("\n");
}
