import { randomUUID } from "crypto";
import { db, FieldValue } from "../../../config/firebase-admin";
import type { RiverAiAgentPendingAction, RiverAiAgentToolId } from "./river-ai-agent-types";

const COLLECTION = "river_ai_pending";
const TTL_MS = 30 * 60 * 1000;

function pendingCol(businessId: string) {
  return db.collection("businesses").doc(businessId).collection(COLLECTION);
}

export async function savePendingAction(args: {
  businessId: string;
  userId: string;
  tool: RiverAiAgentToolId;
  payload: Record<string, unknown>;
  preview: RiverAiAgentPendingAction["preview"];
}): Promise<RiverAiAgentPendingAction> {
  const id = randomUUID();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + TTL_MS).toISOString();
  const row: RiverAiAgentPendingAction = {
    id,
    businessId: args.businessId,
    userId: args.userId,
    tool: args.tool,
    payload: args.payload,
    preview: args.preview,
    createdAt,
    expiresAt,
  };
  await pendingCol(args.businessId).doc(id).set({
    ...row,
    expiresAtTs: FieldValue.serverTimestamp(),
  });
  return row;
}

export async function loadPendingAction(
  businessId: string,
  actionId: string,
  userId: string,
): Promise<RiverAiAgentPendingAction | null> {
  const snap = await pendingCol(businessId).doc(actionId).get();
  if (!snap.exists) return null;
  const data = snap.data() as RiverAiAgentPendingAction;
  if (data.userId !== userId) return null;
  if (new Date(data.expiresAt).getTime() < Date.now()) {
    await snap.ref.delete();
    return null;
  }
  return { ...data, id: snap.id };
}

export async function deletePendingAction(businessId: string, actionId: string): Promise<void> {
  await pendingCol(businessId).doc(actionId).delete();
}
