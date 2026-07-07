import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";

const COLLECTION = "community_messenger_sessions";
const SESSION_TTL_MS = 30 * 60 * 1000;

export type CommunityMessengerWizardStep =
  | "name"
  | "qty"
  | "delivery"
  | "phone"
  | "address"
  | "confirm";

export type CommunityMessengerSession = {
  psid: string;
  sourceChannel?: "community_messenger" | "community_whatsapp";
  fields: CommunityOrderFields;
  rawMessage: string;
  awaitingConfirmation?: "delivery" | "order";
  repairAwait?: "address" | "order";
  missingFields?: string[];
  wizardStep?: CommunityMessengerWizardStep;
  flow?: "wizard" | "template" | "ai";
  expiresAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue;
};

function mergeDefinedFields(
  base: CommunityOrderFields,
  patch: CommunityOrderFields,
): CommunityOrderFields {
  return {
    ...(base.name ? { name: base.name } : {}),
    ...(base.delivery !== undefined ? { delivery: base.delivery } : {}),
    ...(base.qty !== undefined ? { qty: base.qty } : {}),
    ...(base.preferredWaterType ?
      { preferredWaterType: base.preferredWaterType } :
      {}),
    ...(base.location ? { location: base.location } : {}),
    ...(base.email ? { email: base.email } : {}),
    ...(base.number ? { number: base.number } : {}),
    ...(base.orderRaw ? { orderRaw: base.orderRaw } : {}),
    ...(base.orderLines?.length ? { orderLines: base.orderLines } : {}),
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
    ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
    ...(patch.preferredWaterType ?
      { preferredWaterType: patch.preferredWaterType } :
      {}),
    ...(patch.location ? { location: patch.location } : {}),
    ...(patch.email ? { email: patch.email } : {}),
    ...(patch.number ? { number: patch.number } : {}),
    ...(patch.orderRaw ? { orderRaw: patch.orderRaw } : {}),
    ...(patch.orderLines?.length ? { orderLines: patch.orderLines } : {}),
  };
}

export function isShortAffirmation(text: string): boolean {
  return /^(yes|y|oo|opo|sure|okay|ok|tama|correct|confirmed)$/i.test(text.trim());
}

export function isShortDenial(text: string): boolean {
  return /^(no|n|hindi|wrong|mali|hindi po)$/i.test(text.trim());
}

export async function getCommunityMessengerSession(
  psid: string,
): Promise<CommunityMessengerSession | null> {
  const snap = await db.collection(COLLECTION).doc(psid).get();
  if (!snap.exists) return null;

  const data = snap.data() as CommunityMessengerSession | undefined;
  if (!data?.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
    await clearCommunityMessengerSession(psid);
    return null;
  }

  return data;
}

export async function saveCommunityMessengerSession(params: {
  psid: string;
  sourceChannel?: "community_messenger" | "community_whatsapp";
  fields: CommunityOrderFields;
  rawMessage: string;
  awaitingConfirmation?: "delivery" | "order";
  repairAwait?: "address" | "order";
  missingFields?: string[];
  wizardStep?: CommunityMessengerWizardStep;
  flow?: "wizard" | "template" | "ai";
}): Promise<void> {
  const doc: CommunityMessengerSession = {
    psid: params.psid,
    ...(params.sourceChannel ? { sourceChannel: params.sourceChannel } : {}),
    fields: params.fields,
    rawMessage: params.rawMessage.slice(0, 4000),
    ...(params.awaitingConfirmation ? { awaitingConfirmation: params.awaitingConfirmation } : {}),
    ...(params.wizardStep ? { wizardStep: params.wizardStep } : {}),
    ...(params.flow ? { flow: params.flow } : {}),
    expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection(COLLECTION).doc(params.psid).set(
    {
      ...doc,
      ...(params.repairAwait ?
        { repairAwait: params.repairAwait } :
        { repairAwait: FieldValue.delete() }),
      ...(params.missingFields?.length ?
        { missingFields: params.missingFields } :
        { missingFields: FieldValue.delete() }),
    },
    { merge: true },
  );
}

export async function clearCommunityMessengerSession(psid: string): Promise<void> {
  await db.collection(COLLECTION).doc(psid).delete();
}

export function applySessionFollowUp(
  session: CommunityMessengerSession,
  text: string,
): CommunityOrderFields {
  const trimmed = text.trim();
  if (session.awaitingConfirmation === "delivery") {
    if (isShortAffirmation(trimmed)) {
      return mergeDefinedFields(session.fields, { delivery: true });
    }
    if (isShortDenial(trimmed)) {
      return mergeDefinedFields(session.fields, { delivery: false });
    }
  }

  return session.fields;
}

export function isOrderConfirmationAffirmation(
  session: CommunityMessengerSession,
  text: string,
): boolean {
  return session.awaitingConfirmation === "order" && isShortAffirmation(text);
}

export function isOrderConfirmationDenial(
  session: CommunityMessengerSession,
  text: string,
): boolean {
  return session.awaitingConfirmation === "order" && isShortDenial(text);
}

export { mergeDefinedFields };
