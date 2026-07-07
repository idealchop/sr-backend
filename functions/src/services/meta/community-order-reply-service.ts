import { getGeminiApiKey } from "../ai/gemini-config";
import { geminiGenerateJson } from "../ai/gemini-client";
import {
  COMMUNITY_FIELD_LABELS,
  formatCommunityOrderLines,
  type CommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  COMMUNITY_DELIVERY_LOCATION_TIP,
  buildCommunityOrderTemplateMessage,
} from "./community-order-template";
import {
  COMMUNITY_ORDER_IN_PROGRESS_NOTE,
  COMMUNITY_PRICE_BEFORE_ACCEPT_HINT,
} from "./community-messenger-copy";

function formatMissingList(errors: string[]): string {
  return errors
    .map((key) => `• ${COMMUNITY_FIELD_LABELS[key] ?? key}`)
    .join("\n");
}

function formatMissingFieldsPrompt(errors: string[]): string {
  const count = errors.length;
  if (count === 1) {
    return "Kulang pa ang field na ito:";
  }
  return "Kulang pa ang mga field na ito:";
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
    "Salamat po — natanggap na namin ang order mo. Konti na lang!" :
    "Salamat po sa pag-message sa River Smart Refill.";

  return [
    intro,
    "",
    COMMUNITY_ORDER_IN_PROGRESS_NOTE,
    "",
    formatMissingFieldsPrompt(errors),
    missing,
    "",
    "Paki-send ang kulang — pwede isa-isa o sabay-sabay.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** Acknowledgement when a pin is saved but the order is still incomplete. */
export function buildLocationPinReceivedMessage(errors: string[]): string {
  const lines = [
    "Salamat po — natanggap na ang location pin mo. 📍",
    "",
  ];

  if (errors.length > 0) {
    lines.push(
      COMMUNITY_ORDER_IN_PROGRESS_NOTE,
      "",
      formatMissingFieldsPrompt(errors),
      formatMissingList(errors),
      "",
      "Paki-send ang kulang — pwede isa-isa o sabay-sabay.",
      "",
    );
  }

  lines.push("Salamat po! 🙏");
  return lines.join("\n");
}

/** Address could not be geocoded — ask customer to resend a Google Maps–locatable address. */
export function buildCommunityAddressRepairMessage(providedAddress?: string): string {
  const addressLine = providedAddress?.trim() ?
    `Address mo: ${providedAddress.trim()}` :
    "Hindi namin mahanap ang address sa form mo.";

  return [
    "Salamat po — natanggap ang order mo, pero hindi namin ma-verify ang address.",
    "",
    COMMUNITY_ORDER_IN_PROGRESS_NOTE,
    "",
    addressLine,
    "",
    "Paki-send ulit ang buong address (street/landmark, barangay, city). Dapat makita sa Google Maps.",
    "",
    "Tip: Hanapin sa Google Maps ang lugar mo, copy ang address — o mag-send ng location pin dito.",
    "",
    COMMUNITY_DELIVERY_LOCATION_TIP,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** Order line unreadable — remind container, water type, and format. */
export function buildCommunityOrderFormatRepairMessage(providedOrder?: string): string {
  const orderLine = providedOrder?.trim() ?
    `Order mo: ${providedOrder.trim()}` :
    "Hindi namin mabasa ang Order line sa form mo.";

  return [
    "Salamat po — okay na ang address, pero hindi namin mabasa ang Order mo.",
    "",
    COMMUNITY_ORDER_IN_PROGRESS_NOTE,
    "",
    orderLine,
    "",
    "Gamitin ang format na ito:",
    "{qty} {slim o round} - {alkaline, mineral, o purified}",
    "",
    "Halimbawa: 3 slim - alkaline, 4 round - purified",
    "Maraming items? Paghiwalayin ng comma — hal. 2 round - mineral, 1 slim - alkaline",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

function appendCommunityOrderQuantityLines(
  lines: string[],
  fields: CommunityOrderFields,
): void {
  if (fields.orderLines?.length) {
    lines.push(`• Order: ${formatCommunityOrderLines(fields.orderLines)}`);
    lines.push(`• Total: ${fields.qty ?? "—"} container(s)`);
    return;
  }

  const deliveryLabel = fields.delivery ? "Delivery" : "Pickup";
  lines.push(`• ${deliveryLabel}: ${fields.qty ?? "—"} gal`);
  if (fields.preferredWaterType) {
    lines.push(`• Tubig: ${fields.preferredWaterType}`);
  }
}

/** CP-29 — summary shown before routing AI / template orders. */
export function buildCommunityOrderConfirmSummary(
  fields: CommunityOrderFields,
): string {
  const lines = [
    "Pakicheck muna ang order mo:",
    "",
    `• Name: ${fields.name ?? "—"}`,
  ];

  if (fields.number) {
    lines.push(`• Number: ${fields.number}`);
  }

  if (fields.delivery && fields.location) {
    lines.push(`• Address: ${fields.location}`);
  }

  appendCommunityOrderQuantityLines(lines, fields);

  if (fields.email) {
    lines.push(`• Email: ${fields.email}`);
  }

  lines.push(
    "",
    COMMUNITY_PRICE_BEFORE_ACCEPT_HINT,
    "",
    "Tap Confirm order para ipadala sa malapit na stations.",
    "(Pwede rin sumagot ng \"yes\" kung walang buttons.)",
  );
  return lines.join("\n");
}

/** CP-04 confirmation when all required fields are present. */
export function buildCommunityOrderReceivedMessage(
  fields: CommunityOrderFields,
  referenceId?: string,
): string {
  const lines = [
    "Salamat po — natanggap na ang order mo! ✨",
    "",
  ];

  if (referenceId?.trim()) {
    lines.push(`Reference: ${referenceId.trim()}`, "");
  }

  lines.push(
    "Narito ang na-save namin:",
    `• Name: ${fields.name}`,
  );

  if (fields.number) {
    lines.push(`• Number: ${fields.number}`);
  }

  if (fields.delivery && fields.location) {
    lines.push(`• Address: ${fields.location}`);
  }

  appendCommunityOrderQuantityLines(lines, fields);

  if (fields.email) {
    lines.push(`• Email: ${fields.email}`);
  }

  lines.push(
    "",
    "Ipinapaalam na namin sa malapit na stations. Unang tumanggap ang kukuha ng order.",
    "",
    COMMUNITY_PRICE_BEFORE_ACCEPT_HINT,
    "",
    "Salamat po sa River Smart Refill! 💧",
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
      "You write short, warm Messenger replies for a water refilling page in the Philippines. " +
      "Use simple English with light Taglish (Salamat po). No jargon. " +
      "The customer sent a partial order. Ask ONLY for the missing fields listed. " +
      "Do NOT paste the full order form. Max 500 characters. Output JSON: { message: string }.",
    user:
      `Missing: ${missingLabels.join(", ")}\n` +
      `Already have: ${filled || "none"}\n` +
      `Customer message:\n${rawMessage.slice(0, 800)}`,
    fallback: {},
    temperature: 0.4,
    maxOutputTokens: 512,
  });

  const message =
    typeof ai.message === "string" && ai.message.trim().length > 20 ?
      `${ai.message.trim().slice(0, 700)}\n\n${COMMUNITY_ORDER_IN_PROGRESS_NOTE}` :
      buildCommunityClarificationMessage(errors, partialFields);

  return { message, source: typeof ai.message === "string" ? "ai" : "deterministic" };
}

/** Wrap AI-04 clarifying question with optional order form fallback. */
export function buildCommunityFreeTextClarificationMessage(
  clarifyingQuestion: string,
): string {
  return [
    clarifyingQuestion,
    "",
    "Kung mas madali, pwede mo rin gamitin ang order form:",
    "",
    buildCommunityOrderTemplateMessage(),
  ].join("\n");
}

/** Customer chose Edit on confirm — resend guidance. */
export function buildCommunityOrderEditPromptMessage(): string {
  return [
    "Sige po — i-send ulit ang tamang details, o kopyahin ang form below:",
    "",
    buildCommunityOrderTemplateMessage(),
    "",
    "Salamat po! 🙏",
  ].join("\n");
}
