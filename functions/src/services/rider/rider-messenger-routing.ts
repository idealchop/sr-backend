import { RiderMessengerLinkService } from "./rider-messenger-link-service";
import { parseRiderMessengerPostback } from "./rider-messenger-command-service";
import {
  handleRiderMessengerInboundText,
  handleRiderMessengerPostback,
} from "./rider-messenger-intake-service";

export type MetaMessagingEventLike = {
  sender?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
    quick_reply?: { payload?: string };
  };
  postback?: { payload?: string };
};

const RIDER_VERB_RE =
  /^(LINK|JOBS|START|DONE|FAIL|CANCEL|CLAIM|REPORT|HELP|STATS|YES|NO|OO|HINDI|MENU|CONFIRM)(\s|$)/i;

function readSenderPsid(event: MetaMessagingEventLike): string | undefined {
  const id = event.sender?.id?.trim();
  return id || undefined;
}

function readMessengerPayload(event: MetaMessagingEventLike): string | undefined {
  return (
    event.postback?.payload?.trim() ||
    event.message?.quick_reply?.payload?.trim() ||
    undefined
  );
}

/** True when this event should use rider ops (not community customer intake). */
export async function shouldRouteToRiderMessenger(
  event: MetaMessagingEventLike,
): Promise<boolean> {
  const psid = readSenderPsid(event);
  if (!psid) return false;

  const linked = await RiderMessengerLinkService.resolveLinkedRider(psid);
  if (linked) return true;

  const payload = readMessengerPayload(event);
  if (payload && parseRiderMessengerPostback(payload)) return true;

  const text = event.message?.text?.trim();
  if (text && RIDER_VERB_RE.test(text)) return true;

  return false;
}

/** Handle rider Messenger event on the shared community Page. */
export async function handleRiderMessengerEvent(
  event: MetaMessagingEventLike,
): Promise<void> {
  const psid = readSenderPsid(event);
  if (!psid) return;

  const payload = readMessengerPayload(event);
  if (payload) {
    const handled = await handleRiderMessengerPostback({
      psid,
      payload,
      metaMessageId: event.message?.mid?.trim(),
    });
    if (handled) return;
  }

  if (event.postback?.payload?.trim()) return;
  if (event.message?.is_echo === true) return;

  const text = event.message?.text?.trim();
  if (text) {
    await handleRiderMessengerInboundText({
      psid,
      text,
      metaMessageId: event.message?.mid?.trim(),
    });
  }
}
