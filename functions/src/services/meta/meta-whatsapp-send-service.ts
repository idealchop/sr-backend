import { logger } from "../observability/logging/logger";
import { fetchMetaSecretFromManager } from "./meta-secret-resolver";

const GRAPH_API_VERSION = "v21.0";

export type SendTextResult = { ok: true } | { ok: false; reason: string };

export type WhatsappReplyButton = {
  id: string;
  title: string;
};

export function readWhatsappCommunityPhoneNumberId(): string | null {
  const id = process.env.WHATSAPP_COMMUNITY_PHONE_NUMBER_ID?.trim();
  return id || null;
}

export function readWhatsappCommunityAccessToken(): string | null {
  const token = process.env.WHATSAPP_COMMUNITY_ACCESS_TOKEN?.trim();
  return token || null;
}

async function resolveWhatsappCommunityAccessToken(): Promise<string | null> {
  const fromEnv = readWhatsappCommunityAccessToken();
  if (fromEnv) return fromEnv;
  const metaPageToken = process.env.META_COMMUNITY_PAGE_ACCESS_TOKEN?.trim();
  if (metaPageToken) return metaPageToken;
  return fetchMetaSecretFromManager("WHATSAPP_COMMUNITY_ACCESS_TOKEN");
}

async function resolveWhatsappCommunityPhoneNumberId(): Promise<string | null> {
  const fromEnv = readWhatsappCommunityPhoneNumberId();
  if (fromEnv) return fromEnv;
  return fetchMetaSecretFromManager("WHATSAPP_COMMUNITY_PHONE_NUMBER_ID");
}

async function postWhatsappPayload(body: Record<string, unknown>): Promise<SendTextResult> {
  const accessToken = await resolveWhatsappCommunityAccessToken();
  const phoneNumberId = await resolveWhatsappCommunityPhoneNumberId();
  if (!accessToken || !phoneNumberId) {
    return { ok: false, reason: "missing_whatsapp_config" };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      messages?: Array<{ id?: string }>;
    };

    if (!response.ok || payload.error) {
      logger.warn("postWhatsappPayload graph_error", {
        status: response.status,
        error: payload.error?.message,
      });
      return {
        ok: false,
        reason: payload.error?.message ?? `http_${response.status}`,
      };
    }

    return { ok: true };
  } catch (error) {
    logger.error("postWhatsappPayload failed", error);
    return { ok: false, reason: "network_error" };
  }
}

export async function sendWhatsappCommunityText(
  waId: string,
  text: string,
): Promise<SendTextResult> {
  const to = waId.trim();
  if (!to) return { ok: false, reason: "missing_recipient" };

  return postWhatsappPayload({
    to,
    type: "text",
    text: { body: text.slice(0, 4096) },
  });
}

/** CP-30 — interactive reply buttons (maps to wizard / confirm postback ids). */
export async function sendWhatsappCommunityButtons(params: {
  waId: string;
  text: string;
  buttons: WhatsappReplyButton[];
}): Promise<SendTextResult> {
  const to = params.waId.trim();
  if (!to) return { ok: false, reason: "missing_recipient" };

  const buttons = params.buttons.slice(0, 3).map((button) => ({
    type: "reply",
    reply: {
      id: button.id.slice(0, 256),
      title: button.title.slice(0, 20),
    },
  }));

  if (!buttons.length) {
    return sendWhatsappCommunityText(to, params.text);
  }

  return postWhatsappPayload({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: params.text.slice(0, 1024) },
      action: { buttons },
    },
  });
}
