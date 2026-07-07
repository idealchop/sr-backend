import { db, FieldValue } from "../../config/firebase-admin";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import {
  type CommunityChannelContact,
  channelContactFields,
} from "./community-channel-contact";

const COLLECTION = "community_messenger_contacts";

/** After this idle window, the next customer message restarts greeting + service choice. */
export const COMMUNITY_MESSENGER_INACTIVITY_RESET_MS = 24 * 60 * 60 * 1000;

export type CommunityMessengerServiceMode = "water_delivery" | "inquiry";

/** Saved when 24h idle interrupts an in-progress order. */
export type CommunityPendingOrderIntent = {
  fields: CommunityOrderFields;
  missingFields?: string[];
  repairAwait?: "address" | "order";
  awaitingConfirmation?: "order";
};

function readFirestoreTimestampMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { toMillis?: () => number };
  if (typeof maybe.toMillis === "function") {
    return maybe.toMillis();
  }
  return null;
}

function contactDocId(contact: CommunityChannelContact): string {
  return `${contact.sourceChannel}:${contact.contactId}`;
}

function contactRef(contact: CommunityChannelContact) {
  return db.collection(COLLECTION).doc(contactDocId(contact));
}

/** True when this PSID / WhatsApp id has greeted the community channel before. */
export async function hasCommunityMessengerContact(
  contact: CommunityChannelContact,
): Promise<boolean> {
  const snap = await contactRef(contact).get();
  return snap.exists;
}

export async function getCommunityMessengerServiceMode(
  contact: CommunityChannelContact,
): Promise<CommunityMessengerServiceMode | null> {
  const snap = await contactRef(contact).get();
  if (!snap.exists) return null;
  const mode = snap.data()?.serviceMode;
  if (mode === "water_delivery" || mode === "inquiry") return mode;
  return null;
}

export async function setCommunityMessengerServiceMode(
  contact: CommunityChannelContact,
  serviceMode: CommunityMessengerServiceMode,
): Promise<void> {
  await contactRef(contact).set(
    {
      ...channelContactFields(contact),
      serviceMode,
      serviceModeUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearCommunityMessengerServiceMode(
  contact: CommunityChannelContact,
): Promise<void> {
  await contactRef(contact).set(
    {
      serviceMode: FieldValue.delete(),
      serviceModeUpdatedAt: FieldValue.delete(),
    },
    { merge: true },
  );
}

/**
 * True when the customer has been idle longer than 24h since their last inbound message
 * (falls back to last/first greet timestamps for older contact docs).
 */
export async function isCommunityMessengerSessionExpired(
  contact: CommunityChannelContact,
  nowMs = Date.now(),
): Promise<boolean> {
  const snap = await contactRef(contact).get();
  if (!snap.exists) return false;

  const data = snap.data();
  const lastMs =
    readFirestoreTimestampMs(data?.lastInboundAt) ??
    readFirestoreTimestampMs(data?.lastGreetedAt) ??
    readFirestoreTimestampMs(data?.firstGreetedAt);
  if (lastMs == null) return false;

  return nowMs - lastMs >= COMMUNITY_MESSENGER_INACTIVITY_RESET_MS;
}

/** Bump last customer activity — used to enforce the 24h session window. */
export async function touchCommunityMessengerInboundActivity(
  contact: CommunityChannelContact,
): Promise<void> {
  await contactRef(contact).set(
    {
      ...channelContactFields(contact),
      lastInboundAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Record greeting so the next hello uses the returning-user template. */
export async function markCommunityMessengerContactGreeted(
  contact: CommunityChannelContact,
): Promise<void> {
  const ref = contactRef(contact);
  const snap = await ref.get();
  await ref.set(
    {
      ...channelContactFields(contact),
      lastGreetedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { firstGreetedAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
}

export async function saveCommunityPendingOrderIntent(
  contact: CommunityChannelContact,
  intent: CommunityPendingOrderIntent,
): Promise<void> {
  await contactRef(contact).set(
    {
      pendingOrderIntent: intent,
      pendingOrderSavedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loadCommunityPendingOrderIntent(
  contact: CommunityChannelContact,
): Promise<CommunityPendingOrderIntent | null> {
  const snap = await contactRef(contact).get();
  if (!snap.exists) return null;
  const raw = snap.data()?.pendingOrderIntent;
  if (!raw || typeof raw !== "object") return null;
  return raw as CommunityPendingOrderIntent;
}

export async function clearCommunityPendingOrderIntent(
  contact: CommunityChannelContact,
): Promise<void> {
  await contactRef(contact).set(
    {
      pendingOrderIntent: FieldValue.delete(),
      pendingOrderSavedAt: FieldValue.delete(),
    },
    { merge: true },
  );
}
