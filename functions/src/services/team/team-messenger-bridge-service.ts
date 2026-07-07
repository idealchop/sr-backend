import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import { sendMetaMessengerText } from "../meta/meta-messenger-send-service";
import { sendRiderMessengerPrefixedText } from "../meta/meta-rider-messenger-send-service";
import { sendTeamChatMessage } from "./team-chat-service";
import { TeamMessengerLinkService } from "./team-messenger-link-service";

export type RiderChatModeRow = {
  psid: string;
  riderId: string;
  riderName: string;
};

export async function resolveBusinessOwnerUserId(businessId: string): Promise<string | null> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const ownerId = String(snap.data()?.ownerId || "").trim();
  return ownerId || null;
}

export async function resolveOwnerMessengerPsid(businessId: string): Promise<string | null> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const psid = String(snap.data()?.ownerMessengerPsid || "").trim();
  return psid || null;
}

export async function resolveRiderAuthUserId(
  businessId: string,
  riderId: string,
): Promise<string | null> {
  const rider = await RiderService.getRider(businessId, riderId);
  const userId = String(rider?.userId || "").trim();
  return userId || null;
}

export async function listRidersInChatMode(businessId: string): Promise<RiderChatModeRow[]> {
  const snap = await db
    .collection("rider_messenger_sessions")
    .where("chatMode", "==", true)
    .get();

  const rows: RiderChatModeRow[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (String(data.businessId || "") !== businessId) continue;
    const riderId = String(data.riderId || "").trim();
    if (!riderId) continue;
    rows.push({
      psid: doc.id,
      riderId,
      riderName: String(data.riderName || "Rider").trim(),
    });
  }
  return rows;
}

export async function setRiderMessengerChatMode(params: {
  psid: string;
  businessId: string;
  riderId: string;
  riderName: string;
  chatMode: boolean;
}): Promise<void> {
  await db.collection("rider_messenger_sessions").doc(params.psid.trim()).set(
    {
      businessId: params.businessId,
      riderId: params.riderId,
      riderName: params.riderName,
      chatMode: params.chatMode,
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

export async function bridgeRiderTextToTeamChat(params: {
  businessId: string;
  riderId: string;
  riderName: string;
  text: string;
}): Promise<void> {
  const ownerUserId = await resolveBusinessOwnerUserId(params.businessId);
  if (!ownerUserId) return;

  const riderUserId = await resolveRiderAuthUserId(params.businessId, params.riderId);
  if (!riderUserId) {
    logger.warn("team_chat_bridge_missing_rider_user", {
      businessId: params.businessId,
      riderId: params.riderId,
    });
    return;
  }

  const body = params.text.trim();
  if (!body) return;

  try {
    await sendTeamChatMessage({
      businessId: params.businessId,
      senderId: riderUserId,
      senderName: params.riderName,
      peerUserId: ownerUserId,
      text: body,
    });
  } catch (error) {
    logger.warn("team_chat_bridge_rider_send_failed", { error, businessId: params.businessId });
  }

  const ownerPsid = await resolveOwnerMessengerPsid(params.businessId);
  if (ownerPsid) {
    const preview = `💬 ${params.riderName}: ${body}`.slice(0, 1900);
    await sendMetaMessengerText(ownerPsid, preview);
  }
}

export async function bridgeOwnerTextToRider(params: {
  businessId: string;
  ownerUserId: string;
  ownerName: string;
  riderId: string;
  riderName: string;
  riderPsid: string;
  text: string;
}): Promise<void> {
  const body = params.text.trim();
  if (!body) return;

  const riderUserId = await resolveRiderAuthUserId(params.businessId, params.riderId);
  if (!riderUserId) return;

  try {
    await sendTeamChatMessage({
      businessId: params.businessId,
      senderId: params.ownerUserId,
      senderName: params.ownerName,
      peerUserId: riderUserId,
      text: body,
    });
  } catch (error) {
    logger.warn("team_chat_bridge_owner_send_failed", { error, businessId: params.businessId });
  }

  await sendRiderMessengerPrefixedText({
    recipientPsid: params.riderPsid,
    stationLabel: "Team chat",
    riderName: params.riderName,
    body: `${params.ownerName}: ${body}`,
  });
}

export async function notifyOwnerRiderOpenedChat(params: {
  businessId: string;
  riderName: string;
}): Promise<void> {
  const ownerPsid = await resolveOwnerMessengerPsid(params.businessId);
  if (!ownerPsid) return;

  await sendMetaMessengerText(
    ownerPsid,
    [
      `💬 ${params.riderName} opened team chat sa Messenger.`,
      "I-send ang CHAT para mag-reply nang libre.",
      "CLOSE CHAT pag tapos na.",
    ].join("\n"),
  );
}

export async function resolveLinkedOwnerForBusiness(
  businessId: string,
): Promise<(Awaited<ReturnType<typeof TeamMessengerLinkService.resolveLinkedMember>>)> {
  const ownerPsid = await resolveOwnerMessengerPsid(businessId);
  if (!ownerPsid) return null;
  return TeamMessengerLinkService.resolveLinkedMember(ownerPsid);
}

/** All owner/admin PSIDs linked via TMR for this station. */
export async function listLinkedTeamMessengerPsids(businessId: string): Promise<string[]> {
  const psids = new Set<string>();
  const ownerPsid = await resolveOwnerMessengerPsid(businessId);
  if (ownerPsid) psids.add(ownerPsid);

  const snap = await db
    .collection("team_messenger_links")
    .where("businessId", "==", businessId)
    .get();

  for (const doc of snap.docs) {
    psids.add(doc.id.trim());
  }

  return [...psids];
}

export function matchRiderChatTarget(
  rows: RiderChatModeRow[],
  token: string,
): RiderChatModeRow | null {
  const raw = token.trim();
  if (!raw) return null;

  const asIndex = Number.parseInt(raw, 10);
  if (Number.isFinite(asIndex) && asIndex > 0 && asIndex <= rows.length) {
    return rows[asIndex - 1] ?? null;
  }

  const lower = raw.toLowerCase();
  return (
    rows.find((row) => row.riderName.toLowerCase().includes(lower)) ??
    rows.find((row) => row.riderId === raw) ??
    null
  );
}
