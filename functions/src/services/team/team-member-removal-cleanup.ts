import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function shouldDeleteTeamInviteForRemovedMember(
  invite: { inviteeEmail?: string; acceptedByUid?: string },
  userId: string,
  normalizedMemberEmail: string,
): boolean {
  if (String(invite.acceptedByUid || "") === userId) return true;
  if (!normalizedMemberEmail) return false;
  return normalizeEmail(String(invite.inviteeEmail || "")) === normalizedMemberEmail;
}

export type RemovedMemberCleanupCounts = {
  riders: number;
  invites: number;
  presence: number;
};

/**
 * Deletes rider roster rows, team invites, and presence heartbeat for a removed member.
 * @param {object} params Cleanup inputs.
 * @param {string} params.businessId Business id.
 * @param {string} params.userId Removed member uid.
 * @param {string} [params.memberEmail] Member email for invite matching.
 * @return {Promise<RemovedMemberCleanupCounts>} Deleted row counts.
 */
export async function purgeRemovedMemberWorkspaceData(params: {
  businessId: string;
  userId: string;
  memberEmail?: string;
}): Promise<RemovedMemberCleanupCounts> {
  const { businessId, userId } = params;
  const normalizedMemberEmail = normalizeEmail(params.memberEmail || "");
  const businessRef = db.collection("businesses").doc(businessId);

  const [ridersSnap, invitesSnap, presenceSnap] = await Promise.all([
    businessRef.collection("riders").where("userId", "==", userId).get(),
    businessRef.collection("team_invites").get(),
    businessRef.collection("team_presence").doc(userId).get(),
  ]);

  const batch = db.batch();
  let riders = 0;
  let invites = 0;
  let presence = 0;

  for (const doc of ridersSnap.docs) {
    batch.delete(doc.ref);
    riders++;
  }

  for (const doc of invitesSnap.docs) {
    const data = doc.data();
    if (
      shouldDeleteTeamInviteForRemovedMember(
        {
          inviteeEmail: data.inviteeEmail as string | undefined,
          acceptedByUid: data.acceptedByUid as string | undefined,
        },
        userId,
        normalizedMemberEmail,
      )
    ) {
      batch.delete(doc.ref);
      invites++;
    }
  }

  if (presenceSnap.exists) {
    batch.delete(presenceSnap.ref);
    presence = 1;
  }

  if (riders + invites + presence > 0) {
    await batch.commit();
  }

  logger.info("Purged removed member workspace artifacts", {
    businessId,
    userId,
    riders,
    invites,
    presence,
  });

  return { riders, invites, presence };
}
