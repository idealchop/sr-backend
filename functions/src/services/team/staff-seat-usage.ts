import { db } from "../../config/firebase-admin";
import { isActiveStaffMemberForLimit } from "./workspace-member-access";

export const TEAM_DIRECTORY_RECORDS = "team_directory_records";

export type StaffSeatUsage = {
  total: number;
  admins: number;
  riders: number;
};

function isRecordOnlyRiderUserId(userId: unknown): boolean {
  return !userId || !String(userId).trim();
}

/**
 * Active directory-only personnel (no Firebase login) — riders + admin contacts.
 * @param {Array} riders Rider rows for the business.
 * @param {Array} directoryRows Directory record fields.
 * @return {StaffSeatUsage} Occupied seats from record-only rows.
 */
export function countRecordOnlyStaffSeats(
  riders: Array<{ userId?: string; status?: string }>,
  directoryRows: Array<{ role?: string; status?: string }>,
): StaffSeatUsage {
  let admins = 0;
  let ridersCount = 0;

  for (const rider of riders) {
    if (!isRecordOnlyRiderUserId(rider.userId)) continue;
    if (rider.status === "inactive") continue;
    ridersCount++;
  }

  for (const row of directoryRows) {
    if (row.status === "inactive") continue;
    const role = String(row.role || "rider").toLowerCase();
    if (role === "admin") admins++;
    else ridersCount++;
  }

  return { total: admins + ridersCount, admins, riders: ridersCount };
}

/**
 * Active workspace members that occupy staff seats (owner excluded).
 * @param {Array} memberDocs Firestore member documents.
 * @param {string} ownerId Business owner uid.
 * @return {StaffSeatUsage} Occupied seats from members.
 */
export function countMemberStaffSeats(
  memberDocs: Array<{ id: string; data: () => Record<string, unknown> }>,
  ownerId: string,
): StaffSeatUsage {
  let admins = 0;
  let ridersCount = 0;
  let total = 0;

  for (const doc of memberDocs) {
    const data = doc.data();
    if (!isActiveStaffMemberForLimit(doc.id, data, ownerId)) continue;
    total++;
    const role = String(data.role || "rider").toLowerCase();
    if (role === "admin") admins++;
    else ridersCount++;
  }

  return { total, admins, riders: ridersCount };
}

/**
 * Merges staff seat usage buckets.
 * @param {...StaffSeatUsage} parts Usage slices to sum.
 * @return {StaffSeatUsage} Combined usage.
 */
export function mergeStaffSeatUsage(...parts: StaffSeatUsage[]): StaffSeatUsage {
  return parts.reduce(
    (acc, part) => ({
      total: acc.total + part.total,
      admins: acc.admins + part.admins,
      riders: acc.riders + part.riders,
    }),
    { total: 0, admins: 0, riders: 0 },
  );
}

/**
 * Active **login** staff seats only (owner excluded).
 * Directory / record-only rows do **not** consume `staffLimit`.
 * @param {string} businessId Business id.
 * @return {Promise<StaffSeatUsage>} Occupied staff seats for plan metering.
 */
export async function countActiveStaffSeatsForBusiness(
  businessId: string,
): Promise<StaffSeatUsage> {
  const businessRef = db.collection("businesses").doc(businessId);
  const [bizSnap, membersSnap] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").get(),
  ]);

  const ownerId = String(bizSnap.data()?.ownerId || "");
  return countMemberStaffSeats(membersSnap.docs, ownerId);
}
