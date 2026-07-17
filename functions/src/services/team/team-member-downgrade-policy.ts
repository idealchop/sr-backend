import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { RiderService } from "../riders/rider-service";
import { isActiveStaffMemberForLimit } from "./workspace-member-access";
import { TEAM_DIRECTORY_RECORDS } from "./staff-seat-usage";

export type TeamDeactivationResult = {
  members: number;
  recordOnlyRiders: number;
  directoryRecords: number;
};

/**
 * Sets all non-owner workspace members inactive, plus record-only riders and
 * directory personnel. Used when a plan downgrade takes effect (including
 * Scale trial → Starter).
 * @param {string} businessId Business id.
 * @return {Promise<TeamDeactivationResult>} Counts deactivated per bucket.
 */
export async function deactivateAllNonOwnerWorkspaceMembers(
  businessId: string,
): Promise<TeamDeactivationResult> {
  const empty: TeamDeactivationResult = {
    members: 0,
    recordOnlyRiders: 0,
    directoryRecords: 0,
  };

  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) return empty;

  const ownerId = String(businessSnap.data()?.ownerId || "");
  const [membersSnap, riders, directorySnap] = await Promise.all([
    businessRef.collection("members").get(),
    RiderService.getRidersByBusiness(businessId),
    businessRef.collection(TEAM_DIRECTORY_RECORDS).get(),
  ]);

  const memberBatch = db.batch();
  let members = 0;
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    if (!isActiveStaffMemberForLimit(doc.id, data, ownerId)) continue;
    memberBatch.update(doc.ref, {
      isActive: false,
      deactivatedAt: FieldValue.serverTimestamp(),
      deactivatedReason: "plan_downgrade",
      updatedAt: FieldValue.serverTimestamp(),
    });
    members++;
  }
  if (members > 0) {
    await memberBatch.commit();
  }

  let recordOnlyRiders = 0;
  for (const rider of riders) {
    const userId = String(rider.userId || "").trim();
    if (userId) continue;
    if (rider.status === "inactive") continue;
    if (!rider.id) continue;
    await RiderService.updateRider(businessId, rider.id, {
      status: "inactive",
    });
    recordOnlyRiders++;
  }

  const directoryBatch = db.batch();
  let directoryRecords = 0;
  for (const doc of directorySnap.docs) {
    const data = doc.data();
    if (data.status === "inactive") continue;
    directoryBatch.update(doc.ref, {
      status: "inactive",
      deactivatedAt: FieldValue.serverTimestamp(),
      deactivatedReason: "plan_downgrade",
      updatedAt: FieldValue.serverTimestamp(),
    });
    directoryRecords++;
  }
  if (directoryRecords > 0) {
    await directoryBatch.commit();
  }

  const total = members + recordOnlyRiders + directoryRecords;
  if (total === 0) return empty;

  logger.info("Deactivated workspace team after plan downgrade", {
    businessId,
    members,
    recordOnlyRiders,
    directoryRecords,
  });

  if (ownerId) {
    await NotificationService.send({
      userId: ownerId,
      businessId,
      title: "Team access paused after plan change",
      message:
        `${total} team seat${total === 1 ? "" : "s"} ${total === 1 ? "was" : "were"} ` +
        "set to inactive (including directory-only records). " +
        "Reactivate seats from Team Hub when you upgrade.",
      type: "warning",
    });
  }

  return { members, recordOnlyRiders, directoryRecords };
}
