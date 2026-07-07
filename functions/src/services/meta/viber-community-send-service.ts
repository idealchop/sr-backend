import { logger } from "../observability/logging/logger";
import { fetchMetaSecretFromManager } from "./meta-secret-resolver";

const VIBER_PA_API = "https://chatapi.viber.com/pa/send_message";

export type SendTextResult = { ok: true } | { ok: false; reason: string };

export type ViberReplyButton = {
  id: string;
  title: string;
};

export function readViberCommunityAuthToken(): string | null {
  const token = process.env.VIBER_COMMUNITY_AUTH_TOKEN?.trim();
  return token || null;
}

async function resolveViberCommunityAuthToken(): Promise<string | null> {
  const fromEnv = readViberCommunityAuthToken();
  if (fromEnv) return fromEnv;
  return fetchMetaSecretFromManager("VIBER_COMMUNITY_AUTH_TOKEN");
}

async function postViberPayload(body: Record<string, unknown>): Promise<SendTextResult> {
  const authToken = await resolveViberCommunityAuthToken();
  if (!authToken) {
    return { ok: false, reason: "missing_viber_config" };
  }

  try {
    const response = await fetch(VIBER_PA_API, {
      method: "POST",
      headers: {
        "X-Viber-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      status?: number;
      status_message?: string;
    };

    if (!response.ok || payload.status !== 0) {
      logger.warn("postViberPayload viber_error", {
        status: response.status,
        viberStatus: payload.status,
        message: payload.status_message,
      });
      return {
        ok: false,
        reason: payload.status_message ?? `http_${response.status}`,
      };
    }

    return { ok: true };
  } catch (error) {
    logger.error("postViberPayload failed", error);
    return { ok: false, reason: "network_error" };
  }
}

export async function sendViberCommunityText(
  viberUserId: string,
  text: string,
): Promise<SendTextResult> {
  const receiver = viberUserId.trim();
  if (!receiver) return { ok: false, reason: "missing_recipient" };

  return postViberPayload({
    receiver,
    type: "text",
    text: text.slice(0, 7000),
  });
}

/** CP-31 — keyboard reply buttons (ActionBody maps to wizard / confirm postback ids). */
export async function sendViberCommunityButtons(params: {
  viberUserId: string;
  text: string;
  buttons: ViberReplyButton[];
}): Promise<SendTextResult> {
  const receiver = params.viberUserId.trim();
  if (!receiver) return { ok: false, reason: "missing_recipient" };

  const buttons = params.buttons.slice(0, 6).map((button) => ({
    ActionType: "reply",
    ActionBody: button.id.slice(0, 250),
    Text: button.title.slice(0, 250),
    Columns: 3,
    Rows: 1,
  }));

  if (!buttons.length) {
    return sendViberCommunityText(receiver, params.text);
  }

  return postViberPayload({
    receiver,
    type: "text",
    text: params.text.slice(0, 7000),
    keyboard: {
      Type: "keyboard",
      DefaultHeight: true,
      Buttons: buttons,
    },
  });
}
