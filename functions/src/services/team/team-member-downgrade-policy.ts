import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { isActiveStaffMemberForLimit } from "./workspace-member-access";

/**
 * Sets all non-owner workspace members inactive when a plan downgrade takes effect.
 * @param {string} businessId Business id.
 * @return {Promise<number>} Count of members deactivated.
 */
export async function deactivateAllNonOwnerWorkspaceMembers(
  businessId: string,
): Promise<number> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) return 0;

  const ownerId = String(businessSnap.data()?.ownerId || "");
  const membersSnap = await businessRef.collection("members").get();

  const batch = db.batch();
  let count = 0;
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    if (!isActiveStaffMemberForLimit(doc.id, data, ownerId)) continue;
    batch.update(doc.ref, {
      isActive: false,
      deactivatedAt: FieldValue.serverTimestamp(),
      deactivatedReason: "plan_downgrade",
      updatedAt: FieldValue.serverTimestamp(),
    });
    count++;
  }

  if (count === 0) return 0;

  await batch.commit();
  logger.info("Deactivated workspace members after plan downgrade", {
    businessId,
    count,
  });

  if (ownerId) {
    await NotificationService.send({
      userId: ownerId,
      businessId,
      title: "Team access paused after plan change",
      message:
        `${count} workspace member${count === 1 ? "" : "s"} ${count === 1 ? "was" : "were"} ` +
        "set to inactive. Reactivate seats from Team Hub when ready.",
      type: "warning",
    });
  }

  return count;
}
