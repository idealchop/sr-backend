/** Blank order block customers fill in (CP-02 / order-template-spec). */
import { COMMUNITY_OPTIONAL_CONTACT_HINT } from "./community-messenger-copy";

export const COMMUNITY_ORDER_TEMPLATE_BLOCK = `Name:
Address:
Email:
Number:
Order:`;

export const COMMUNITY_ORDER_FORM_SAMPLE_ADDRESS =
  "12 Jasmine St, Brgy. San Roque, Antipolo City";

/** Filled example shown after the blank form — nudges container + water choices. */
export const COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK = `Name: John Doe
Address: ${COMMUNITY_ORDER_FORM_SAMPLE_ADDRESS}
Email:
Number:
Order: 3 slim - alkaline, 4 round - purified`;

export const COMMUNITY_DELIVERY_LOCATION_TIP =
  "Tip: Ilagay ang buong address (street/landmark, barangay, city) sa Address line.";

const COMMUNITY_TAGLINE =
  "Pure water, delivered with care — connecting you with trusted refilling stations in your community.";

export type CommunityWelcomeMessageOptions = {
  isReturningUser?: boolean;
};

/** Two-line greeting headline — new vs returning Messenger / WhatsApp customer. */
export function buildCommunityWelcomeGreeting(
  options: CommunityWelcomeMessageOptions = {},
): string {
  const headline = options.isReturningUser ?
    "Welcome Back to River Smart Refill ✨" :
    "Welcome to River Smart Refill ✨";
  return [headline, "", COMMUNITY_TAGLINE].join("\n");
}

/** Greeting only — service selection follows in the next message. */
export function buildCommunityWelcomeMessage(
  options: CommunityWelcomeMessageOptions = {},
): string {
  const closing = options.isReturningUser ?
    "Salamat po — good to see you again! 🙏" :
    "Salamat po — we're glad you're here! 🙏";

  return [buildCommunityWelcomeGreeting(options), "", closing].join("\n");
}

export function buildCommunityServiceChoicePrompt(): string {
  return "What can we help you with today?";
}

export function buildCommunityWaterDeliveryIntroMessage(): string {
  return [
    "Ito ang order form ng River Smart Refill.",
    "I-copy mo, punan ang bawat line, tapos i-send dito kapag ready ka na.",
  ].join("\n");
}

/** One-time handoff — after this, no automated bot replies in inquiry mode. */
export function buildCommunityInquiryHandoffMessage(): string {
  return [
    "Thank you for reaching out.",
    "",
    "A River Smart Refill team member will reply here shortly.",
    "Please type your question or concern below.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityServiceChoiceReminder(): string {
  return [
    "Please choose a service so we can assist you:",
    "",
    "• Water Delivery — place a refill order",
    "• Inquiry / Others — chat with our team",
  ].join("\n");
}

/** Second message — pure order form (no marketing copy). */
export function buildCommunityOrderFormMessage(): string {
  return COMMUNITY_ORDER_TEMPLATE_BLOCK;
}

/** Third message — sample order + tips (container and water type nudges). */
export function buildCommunityOrderFormExampleMessage(): string {
  return [
    "Example:",
    "",
    COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK,
    "",
    "Tips:",
    "• Container: round o slim",
    "• Tubig: alkaline, mineral, o purified",
    "• Maraming items? Paghiwalayin ng comma — hal. 2 round - mineral, 1 slim - alkaline",
    "",
    COMMUNITY_OPTIONAL_CONTACT_HINT,
    "",
    COMMUNITY_DELIVERY_LOCATION_TIP,
    "",
    "Ready ka na?",
    "I-send dito ang filled form mo. Iche-check namin ang address, tapos ipapaalam sa malapit na stations.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** @deprecated Use buildCommunityWelcomeMessage + buildCommunityOrderFormMessage. */
export function buildCommunityWelcomeWithTemplateMessage(
  options: CommunityWelcomeMessageOptions = {},
): string {
  return `${buildCommunityWelcomeMessage(options)}\n\n${buildCommunityOrderFormMessage()}`;
}

/** Embedded form only — use in clarification/repair replies (not new-conversation entry). */
export function buildCommunityOrderTemplateMessage(): string {
  return buildCommunityOrderFormMessage();
}

export const META_POSTBACK_GET_STARTED = "GET_STARTED";
export const META_POSTBACK_ORDER_START = "ORDER_START";
export const META_POSTBACK_SERVICE_WATER_DELIVERY = "SERVICE_WATER_DELIVERY";
export const META_POSTBACK_SERVICE_INQUIRY = "SERVICE_INQUIRY";
export const META_POSTBACK_WIZARD_START = "WIZARD_START";
export const META_POSTBACK_ORDER_FORM = "ORDER_FORM";
export const META_POSTBACK_WIZARD_DELIVERY_YES = "WIZARD_DELIVERY_YES";
export const META_POSTBACK_WIZARD_DELIVERY_NO = "WIZARD_DELIVERY_NO";
export const META_POSTBACK_ORDER_CONFIRM_YES = "ORDER_CONFIRM_YES";
export const META_POSTBACK_ORDER_CONFIRM_NO = "ORDER_CONFIRM_NO";
export const META_POSTBACK_DELIVERY_CHAT = "DELIVERY_CHAT";

const GREETING_PATTERN = new RegExp(
  "^(" +
    "hi+|hello+|hey+|good\\s+(morning|afternoon|evening)|salamat|thanks|" +
    "thank\\s+you|maraming\\s+salamat|opo|ok+|order|help|start" +
  ")$",
  "i",
);

/** Casual chat that should receive welcome + template (CP-02). */
export function isCasualMessengerGreeting(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (trimmed.includes(":")) return false;
  return GREETING_PATTERN.test(trimmed);
}
