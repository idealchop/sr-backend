/** Blank order block customers fill in (CP-02 / order-template-spec). */
export const COMMUNITY_ORDER_TEMPLATE_BLOCK = `Name:
Quantity:
Water:
Address:
Email:
Phone Number:`;

export const COMMUNITY_DELIVERY_LOCATION_TIP =
  "Tip for delivery: type your full address in Address: (street/landmark, barangay, city).";

import { COMMUNITY_CANCEL_WHILE_WAITING_HINT } from "./community-messenger-customer-notifier";

const COMMUNITY_TAGLINE =
  "Pure water, delivered with care — connecting you with trusted refilling stations in your community.";

/** First message — greeting, brand tagline, delivery tip, and order-form instructions. */
export function buildCommunityWelcomeMessage(): string {
  return [
    "Welcome to River Smart Refill ✨",
    "",
    COMMUNITY_TAGLINE,
    "",
    COMMUNITY_DELIVERY_LOCATION_TIP,
    "",
    "Here's your River Smart Refill order form.",
    "",
    "Please copy it, complete each line, and send it back when ready.",
    "",
    COMMUNITY_CANCEL_WHILE_WAITING_HINT,
    "",
    "Salamat po — we're glad you're here! 🙏",
  ].join("\n");
}

/** Second message — pure order form (no marketing copy). */
export function buildCommunityOrderFormMessage(): string {
  return COMMUNITY_ORDER_TEMPLATE_BLOCK;
}

/** @deprecated Use buildCommunityWelcomeMessage + buildCommunityOrderFormMessage. */
export function buildCommunityWelcomeWithTemplateMessage(): string {
  return `${buildCommunityWelcomeMessage()}\n\n${buildCommunityOrderFormMessage()}`;
}

/** Embedded form only — use in clarification/repair replies (not new-conversation entry). */
export function buildCommunityOrderTemplateMessage(): string {
  return buildCommunityOrderFormMessage();
}

export const META_POSTBACK_GET_STARTED = "GET_STARTED";
export const META_POSTBACK_ORDER_START = "ORDER_START";
export const META_POSTBACK_WIZARD_START = "WIZARD_START";
export const META_POSTBACK_ORDER_FORM = "ORDER_FORM";
export const META_POSTBACK_WIZARD_DELIVERY_YES = "WIZARD_DELIVERY_YES";
export const META_POSTBACK_WIZARD_DELIVERY_NO = "WIZARD_DELIVERY_NO";
export const META_POSTBACK_ORDER_CONFIRM_YES = "ORDER_CONFIRM_YES";
export const META_POSTBACK_ORDER_CONFIRM_NO = "ORDER_CONFIRM_NO";

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
