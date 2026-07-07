import { db, FieldValue } from "../../config/firebase-admin";
import type { TeamMessengerSessionDoc } from "./team-messenger-types";

const SESSION_COLLECTION = "team_messenger_sessions";

export async function getTeamMessengerSession(
  psid: string,
): Promise<(TeamMessengerSessionDoc & { psid: string }) | null> {
  const snap = await db.collection(SESSION_COLLECTION).doc(psid.trim()).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as TeamMessengerSessionDoc), psid: psid.trim() };
}

export async function saveTeamMessengerSession(params: {
  psid: string;
  businessId: string;
  userId: string;
  memberName: string;
  chatMode?: boolean;
  activeRiderPsid?: string | null;
  activeRiderId?: string | null;
  activeRiderName?: string | null;
  deliveryChatMode?: boolean;
  deliveryChatThreadId?: string | null;
  deliveryChatCustomerName?: string | null;
  deliveryChatReferenceId?: string | null;
}): Promise<void> {
  await db.collection(SESSION_COLLECTION).doc(params.psid.trim()).set(
    {
      businessId: params.businessId,
      userId: params.userId,
      memberName: params.memberName,
      ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
      ...(params.activeRiderPsid !== undefined ?
        params.activeRiderPsid ?
          { activeRiderPsid: params.activeRiderPsid } :
          { activeRiderPsid: FieldValue.delete() } :
        {}),
      ...(params.activeRiderId !== undefined ?
        params.activeRiderId ?
          { activeRiderId: params.activeRiderId } :
          { activeRiderId: FieldValue.delete() } :
        {}),
      ...(params.activeRiderName !== undefined ?
        params.activeRiderName ?
          { activeRiderName: params.activeRiderName } :
          { activeRiderName: FieldValue.delete() } :
        {}),
      ...(params.deliveryChatMode !== undefined ?
        { deliveryChatMode: params.deliveryChatMode } :
        {}),
      ...(params.deliveryChatThreadId !== undefined ?
        params.deliveryChatThreadId ?
          { deliveryChatThreadId: params.deliveryChatThreadId } :
          { deliveryChatThreadId: FieldValue.delete() } :
        {}),
      ...(params.deliveryChatCustomerName !== undefined ?
        params.deliveryChatCustomerName ?
          { deliveryChatCustomerName: params.deliveryChatCustomerName } :
          { deliveryChatCustomerName: FieldValue.delete() } :
        {}),
      ...(params.deliveryChatReferenceId !== undefined ?
        params.deliveryChatReferenceId ?
          { deliveryChatReferenceId: params.deliveryChatReferenceId } :
          { deliveryChatReferenceId: FieldValue.delete() } :
        {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
