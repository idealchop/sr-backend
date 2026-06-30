import { logger } from "../observability/logging/logger";
import { fetchMetaSecretFromManager } from "./meta-secret-resolver";

const GRAPH_API_VERSION = "v21.0";

export function readMetaPageAccessToken(): string | null {
  const token = process.env.META_COMMUNITY_PAGE_ACCESS_TOKEN?.trim();
  return token || null;
}

export async function resolveMetaPageAccessToken(): Promise<string | null> {
  const fromEnv = readMetaPageAccessToken();
  if (fromEnv) return fromEnv;
  return fetchMetaSecretFromManager("META_COMMUNITY_PAGE_ACCESS_TOKEN");
}

export function readMetaCommunityPageId(): string | null {
  const pageId = process.env.META_COMMUNITY_PAGE_ID?.trim();
  return pageId || null;
}

async function resolveMetaCommunityPageId(): Promise<string | null> {
  const fromEnv = readMetaCommunityPageId();
  if (fromEnv) return fromEnv;
  return fetchMetaSecretFromManager("META_COMMUNITY_PAGE_ID");
}

export type SendTextResult = { ok: true } | { ok: false; reason: string };

export type MessengerPostbackButton = {
  title: string;
  payload: string;
};

function buildMessagesSendUrl(accessToken: string, pageId: string | null): string {
  const resource = pageId ?? "me";
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${resource}/messages`);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

async function postMessengerPayloadOnce(
  url: string,
  body: Record<string, unknown>,
): Promise<SendTextResult & { messageId?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      error?: { message?: string; code?: number; error_subcode?: number };
      message_id?: string;
    };

    if (!response.ok || payload.error) {
      logger.warn("postMessengerPayload graph_error", {
        status: response.status,
        error: payload.error?.message,
        code: payload.error?.code,
        subcode: payload.error?.error_subcode,
      });
      return {
        ok: false,
        reason: payload.error?.message ?? `http_${response.status}`,
      };
    }

    return { ok: true, messageId: payload.message_id };
  } catch (error) {
    logger.error("postMessengerPayload failed", error);
    return { ok: false, reason: "network_error" };
  }
}

function shouldRetryWithoutMessagingType(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("messaging_type") ||
    normalized.includes("(#100)") ||
    normalized.includes("invalid parameter")
  );
}

async function postMessengerPayload(body: Record<string, unknown>): Promise<SendTextResult> {
  const accessToken = await resolveMetaPageAccessToken();
  if (!accessToken) {
    return { ok: false, reason: "missing_page_token" };
  }

  const pageId = await resolveMetaCommunityPageId();
  const url = buildMessagesSendUrl(accessToken, pageId);
  const withType = { messaging_type: "RESPONSE", ...body };

  let result = await postMessengerPayloadOnce(url, withType);
  if (!result.ok && shouldRetryWithoutMessagingType(result.reason)) {
    logger.info("postMessengerPayload retry_without_messaging_type", {
      reason: result.reason,
    });
    result = await postMessengerPayloadOnce(url, body);
  }

  if (result.ok) {
    logger.info("postMessengerPayload sent", {
      messageId: result.messageId,
      pageId: pageId ?? "me",
    });
  }

  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/**
 * Send a plain-text Messenger reply via Graph API (CP-02).
 */
export async function sendMetaMessengerText(
  recipientPsid: string,
  text: string,
): Promise<SendTextResult> {
  const psid = recipientPsid.trim();
  if (!psid) {
    return { ok: false, reason: "missing_recipient" };
  }

  const result = await postMessengerPayload({
    recipient: { id: psid },
    message: { text },
  });

  if (result.ok) {
    logger.info("sendMetaMessengerText sent", { recipientPsid: psid });
  } else if (result.reason === "missing_page_token") {
    logger.warn("sendMetaMessengerText: META_COMMUNITY_PAGE_ACCESS_TOKEN missing");
  }

  return result;
}

/** CP-20 — button template with postback actions (Proceed / Look for more). */
export async function sendMetaMessengerButtonTemplate(params: {
  recipientPsid: string;
  text: string;
  buttons: MessengerPostbackButton[];
}): Promise<SendTextResult> {
  const psid = params.recipientPsid.trim();
  if (!psid) {
    return { ok: false, reason: "missing_recipient" };
  }

  const buttons = params.buttons
    .slice(0, 3)
    .map((button) => ({
      type: "postback",
      title: button.title.slice(0, 20),
      payload: button.payload.slice(0, 1000),
    }));

  if (!buttons.length) {
    return sendMetaMessengerText(psid, params.text);
  }

  return postMessengerPayload({
    recipient: { id: psid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: params.text.slice(0, 640),
          buttons,
        },
      },
    },
  });
}

export type MessengerQuickReply = {
  title: string;
  payload: string;
};

/** Fallback when button templates are unavailable — quick replies carry postback payloads. */
export async function sendMetaMessengerQuickReplies(params: {
  recipientPsid: string;
  text: string;
  quickReplies: MessengerQuickReply[];
}): Promise<SendTextResult> {
  const psid = params.recipientPsid.trim();
  if (!psid) {
    return { ok: false, reason: "missing_recipient" };
  }

  const quickReplies = params.quickReplies
    .slice(0, 13)
    .map((reply) => ({
      content_type: "text",
      title: reply.title.slice(0, 20),
      payload: reply.payload.slice(0, 1000),
    }));

  if (!quickReplies.length) {
    return sendMetaMessengerText(psid, params.text);
  }

  return postMessengerPayload({
    recipient: { id: psid },
    message: {
      text: params.text.slice(0, 2000),
      quick_replies: quickReplies,
    },
  });
}

/** Send a file attachment (e.g. PDF receipt) via publicly accessible HTTPS URL. */
export async function sendMetaMessengerFileUrl(params: {
  recipientPsid: string;
  fileUrl: string;
  isReusable?: boolean;
}): Promise<SendTextResult> {
  const psid = params.recipientPsid.trim();
  const fileUrl = params.fileUrl.trim();
  if (!psid) {
    return { ok: false, reason: "missing_recipient" };
  }
  if (!fileUrl) {
    return { ok: false, reason: "missing_file_url" };
  }

  const result = await postMessengerPayload({
    recipient: { id: psid },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: fileUrl,
          is_reusable: params.isReusable ?? false,
        },
      },
    },
  });

  if (result.ok) {
    logger.info("sendMetaMessengerFileUrl sent", { recipientPsid: psid });
  }

  return result;
}
