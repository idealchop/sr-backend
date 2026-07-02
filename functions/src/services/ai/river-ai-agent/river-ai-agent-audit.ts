import { db, FieldValue } from "../../../config/firebase-admin";

export async function logRiverAiAgentConfirm(args: {
  businessId: string;
  userId: string;
  tool: string;
  summary: string;
  entityIds?: string[];
  pendingActionId: string;
}): Promise<void> {
  try {
    await db
      .collection("businesses")
      .doc(args.businessId)
      .collection("river_ai_audit")
      .add({
        userId: args.userId,
        tool: args.tool,
        summary: args.summary.slice(0, 500),
        entityIds: args.entityIds || [],
        pendingActionId: args.pendingActionId,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch {
    // Audit logging must not block confirm.
  }
}
