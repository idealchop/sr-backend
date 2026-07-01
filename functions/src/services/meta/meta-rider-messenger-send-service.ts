import { logger } from "../observability/logging/logger";
import {
  sendMetaMessengerQuickReplies,
  sendMetaMessengerText,
  type MessengerQuickReply,
  type SendTextResult,
} from "./meta-messenger-send-service";

/** Rider replies use the same River community Page token as customer Messenger. */
export async function sendMetaRiderMessengerText(
  recipientPsid: string,
  text: string,
): Promise<SendTextResult> {
  return sendMetaMessengerText(recipientPsid, text);
}

export async function sendMetaRiderMessengerQuickReplies(params: {
  recipientPsid: string;
  text: string;
  quickReplies: MessengerQuickReply[];
}): Promise<SendTextResult> {
  return sendMetaMessengerQuickReplies(params);
}

export async function sendRiderMessengerPrefixedText(params: {
  recipientPsid: string;
  stationLabel: string;
  riderName: string;
  body: string;
}): Promise<SendTextResult> {
  const prefix = `📍 ${params.stationLabel} · ${params.riderName}\n`;
  const text = `${prefix}${params.body}`.slice(0, 2000);
  const result = await sendMetaRiderMessengerText(params.recipientPsid, text);
  if (!result.ok) {
    logger.warn("sendRiderMessengerPrefixedText failed", { reason: result.reason });
  }
  return result;
}
