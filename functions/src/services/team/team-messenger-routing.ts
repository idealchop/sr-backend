import { TeamMessengerLinkService } from "./team-messenger-link-service";
import { TEAM_LINK_RE, handleTeamMessengerInboundText } from "./team-messenger-intake-service";

type MetaMessagingEventLike = {
  sender?: { id?: string };
  message?: { text?: string; is_echo?: boolean };
};

function readSenderPsid(event: MetaMessagingEventLike): string | undefined {
  const id = event.sender?.id?.trim();
  return id || undefined;
}

export async function shouldRouteToTeamMessenger(
  event: MetaMessagingEventLike,
): Promise<boolean> {
  const psid = readSenderPsid(event);
  if (!psid) return false;

  const linked = await TeamMessengerLinkService.resolveLinkedMember(psid);
  if (linked) return true;

  const text = event.message?.text?.trim();
  if (text && TEAM_LINK_RE.test(text)) return true;

  return false;
}

export async function handleTeamMessengerEvent(
  event: MetaMessagingEventLike,
): Promise<void> {
  const psid = readSenderPsid(event);
  if (!psid) return;
  if (event.message?.is_echo === true) return;

  const text = event.message?.text?.trim();
  if (!text) return;

  await handleTeamMessengerInboundText({ psid, text });
}

export { TEAM_LINK_RE };
