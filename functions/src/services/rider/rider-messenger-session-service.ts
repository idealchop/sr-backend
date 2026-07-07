import { db, FieldValue } from "../../config/firebase-admin";
import type {
  RiderMessengerJobRow,
  RiderMessengerNearbyGroup,
  RiderMessengerNearbyRow,
  RiderMessengerActiveList,
  RiderMessengerSessionDoc,
} from "./rider-messenger-types";

const SESSION_COLLECTION = "rider_messenger_sessions";

export async function getRiderMessengerSession(
  psid: string,
): Promise<(RiderMessengerSessionDoc & { psid: string }) | null> {
  const snap = await db.collection(SESSION_COLLECTION).doc(psid.trim()).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as RiderMessengerSessionDoc), psid: psid.trim() };
}

export async function saveRiderMessengerSession(params: {
  psid: string;
  businessId: string;
  riderId: string;
  lastJobs?: RiderMessengerJobRow[];
  lastNearbyGroups?: RiderMessengerNearbyGroup[];
  lastNearby?: RiderMessengerNearbyRow[];
  activeList?: RiderMessengerActiveList;
  activeGroupNumber?: number;
  lastRiderLat?: number;
  lastRiderLng?: number;
  chatMode?: boolean;
  pending?: RiderMessengerSessionDoc["pending"];
}): Promise<void> {
  await db.collection(SESSION_COLLECTION).doc(params.psid.trim()).set(
    {
      businessId: params.businessId,
      riderId: params.riderId,
      ...(params.lastJobs !== undefined ? { lastJobs: params.lastJobs } : {}),
      ...(params.lastNearbyGroups !== undefined ?
        { lastNearbyGroups: params.lastNearbyGroups } :
        {}),
      ...(params.lastNearby !== undefined ? { lastNearby: params.lastNearby } : {}),
      ...(params.activeList !== undefined ? { activeList: params.activeList } : {}),
      ...(params.activeGroupNumber !== undefined ?
        { activeGroupNumber: params.activeGroupNumber } :
        {}),
      ...(params.lastRiderLat !== undefined ? { lastRiderLat: params.lastRiderLat } : {}),
      ...(params.lastRiderLng !== undefined ? { lastRiderLng: params.lastRiderLng } : {}),
      ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
      ...(params.pending !== undefined ? { pending: params.pending } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearRiderMessengerPending(psid: string): Promise<void> {
  await db.collection(SESSION_COLLECTION).doc(psid.trim()).set(
    { pending: null, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
