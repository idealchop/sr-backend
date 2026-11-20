import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { createProvisionedTeamMemberForHub } from "./team-hub-service";
import { createStaffLink } from "./team-staff-link-service";
import { completeStaffOnboarding } from "./team-invite-accept-service";

/**
 * Barbers.ph-style "Add staff" (Jimboy 2026-11-04): the owner types a name (and an
 * optional phone) and gets a private no-login link to share. No email or password.
 *
 * Reuses the existing provisioning path (plan gate + seat check live there, untouched)
 * with a placeholder address on a reserved `.invalid` domain, so it can never receive
 * mail or collide with a real account, and a random 256-bit password nobody keeps.
 * The member is then marked `linkOnly` and the staff link is created.
 */
export const LINK_STAFF_EMAIL_DOMAIN = "staff-link.smartrefill.invalid";

export const isLinkStaffEmail = (email: unknown) =>
  typeof email === "string" && email.toLowerCase().endsWith(`@${LINK_STAFF_EMAIL_DOMAIN}`);

const cleanPhone = (v: unknown) =>
  typeof v === "string" ? v.replace(/[^\d+ ]/g, "").trim().slice(0, 16) : "";

export async function addLinkStaffMember(params: {
  businessId: string;
  ownerUid: string;
  name: string;
  phone?: string;
}): Promise<
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      member: { id: string; name: string; role: "rider" };
      token: string;
      expiresAt: number;
    }
> {
  const name = (params.name || "").trim().slice(0, 80);
  if (!name) return { ok: false, status: 400, message: "Name is required." };
  const phone = cleanPhone(params.phone);

  const email = `s-${randomBytes(9).toString("hex")}@${LINK_STAFF_EMAIL_DOMAIN}`;
  const created = await createProvisionedTeamMemberForHub({
    businessId: params.businessId,
    email,
    password: randomBytes(32).toString("base64url"),
    name,
    role: "rider",
  });
  if (!created.ok) return created;

  const uid = created.member.id;
  const businessRef = db.collection("businesses").doc(params.businessId);
  await businessRef.collection("members").doc(uid).set(
    {
      linkOnly: true,
      ...(phone ? { phone } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  // The owner already named this staff member, so skip the "confirm your profile"
  // step: opening the link lands straight in My Deliveries.
  await completeStaffOnboarding(uid, params.businessId);
  if (phone) {
    const riders = await businessRef
      .collection("riders").where("userId", "==", uid).limit(1).get();
    const doc = riders.docs?.[0];
    if (doc) await doc.ref.set({ phone }, { merge: true });
  }

  const link = await createStaffLink({
    businessId: params.businessId,
    memberUid: uid,
    ownerUid: params.ownerUid,
  });
  if (!link.ok) return link;
  return {
    ok: true,
    member: { id: uid, name, role: "rider" },
    token: link.token,
    expiresAt: link.expiresAt,
  };
}
