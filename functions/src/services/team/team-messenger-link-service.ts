import { randomBytes } from "node:crypto";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { TeamMessengerLinkCodeDoc, TeamMessengerLinkDoc } from "./team-messenger-types";

const LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_CODE_PREFIX = "TMR-";
const LINK_CODE_INDEX_COLLECTION = "team_messenger_link_codes";

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function generateLinkCodeValue(): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
  return `${LINK_CODE_PREFIX}${suffix}`;
}

async function readBusinessStationLabel(businessId: string): Promise<string> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const data = snap.data() as { publicName?: string; name?: string } | undefined;
  return (data?.publicName || data?.name || "Station").trim();
}

async function readMemberLinkMeta(
  businessId: string,
  userId: string,
): Promise<{ memberName: string; role: "owner" | "admin" }> {
  const businessSnap = await db.collection("businesses").doc(businessId).get();
  const ownerId = String(businessSnap.data()?.ownerId || "");
  if (ownerId === userId) {
    const name = String(businessSnap.data()?.name || "Station owner").trim();
    return { memberName: name, role: "owner" };
  }

  const memberSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(userId)
    .get();
  const data = memberSnap.data();
  const role = String(data?.role || "").toLowerCase();
  if (role !== "admin") {
    throw new Error("Only owner or admin can link Messenger for team chat.");
  }
  const memberName = String(data?.name || data?.displayName || "Admin").trim();
  return { memberName, role: "admin" };
}

export class TeamMessengerLinkService {
  static async createLinkCode(params: {
    businessId: string;
    userId: string;
  }): Promise<{ code: string; expiresAt: string }> {
    const meta = await readMemberLinkMeta(params.businessId, params.userId);
    const code = generateLinkCodeValue();
    const expiresAt = Timestamp.fromMillis(Date.now() + LINK_CODE_TTL_MS);

    const codeDoc: TeamMessengerLinkCodeDoc & { businessId: string } = {
      businessId: params.businessId,
      userId: params.userId,
      memberName: meta.memberName,
      role: meta.role,
      expiresAt,
      usedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(
      db
        .collection("businesses")
        .doc(params.businessId)
        .collection("team_messenger_link_codes")
        .doc(code),
      codeDoc,
    );
    batch.set(db.collection(LINK_CODE_INDEX_COLLECTION).doc(code), codeDoc);
    await batch.commit();

    return { code, expiresAt: expiresAt.toDate().toISOString() };
  }

  static async unlinkMember(params: {
    businessId: string;
    userId: string;
  }): Promise<void> {
    const memberSnap = await db
      .collection("businesses")
      .doc(params.businessId)
      .collection("members")
      .doc(params.userId)
      .get();
    const psid = (memberSnap.data() as { messengerPsid?: string } | undefined)
      ?.messengerPsid?.trim();
    if (psid) {
      await db.collection("team_messenger_links").doc(psid).delete();
    }

    const businessSnap = await db.collection("businesses").doc(params.businessId).get();
    if (businessSnap.data()?.ownerId === params.userId) {
      await db.collection("businesses").doc(params.businessId).update({
        ownerMessengerPsid: FieldValue.delete(),
        ownerMessengerLinkedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (memberSnap.exists) {
      await memberSnap.ref.update({
        messengerPsid: FieldValue.delete(),
        messengerLinkedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  static async getLinkStatus(params: {
    businessId: string;
    userId: string;
  }): Promise<{ linked: boolean; messengerPsid?: string; linkedAt?: string }> {
    const businessSnap = await db.collection("businesses").doc(params.businessId).get();
    if (businessSnap.data()?.ownerId === params.userId) {
      const psid = String(businessSnap.data()?.ownerMessengerPsid || "").trim();
      const linkedAtRaw = businessSnap.data()?.ownerMessengerLinkedAt;
      return {
        linked: Boolean(psid),
        messengerPsid: psid || undefined,
        linkedAt: serializeOptionalTimestamp(linkedAtRaw),
      };
    }

    const memberSnap = await db
      .collection("businesses")
      .doc(params.businessId)
      .collection("members")
      .doc(params.userId)
      .get();
    const data = memberSnap.data() as
      | { messengerPsid?: string; messengerLinkedAt?: unknown }
      | undefined;
    const psid = data?.messengerPsid?.trim();
    return {
      linked: Boolean(psid),
      messengerPsid: psid || undefined,
      linkedAt: serializeOptionalTimestamp(data?.messengerLinkedAt),
    };
  }

  static async bindPsidWithCode(params: {
    psid: string;
    codeRaw: string;
  }): Promise<TeamMessengerLinkDoc & { psid: string }> {
    const code = normalizeCode(params.codeRaw);
    if (!code.startsWith(LINK_CODE_PREFIX)) {
      throw new Error("Invalid link code. Ask for a team code like TMR-7K2M.");
    }

    const existing = await db.collection("team_messenger_links").doc(params.psid).get();
    if (existing.exists) {
      return { ...(existing.data() as TeamMessengerLinkDoc), psid: params.psid };
    }

    const codeRef = db.collection(LINK_CODE_INDEX_COLLECTION).doc(code);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      throw new Error("Link code not found. Generate a new code in Team Hub.");
    }

    const codeData = codeSnap.data() as TeamMessengerLinkCodeDoc & { businessId: string };
    if (codeData.usedAt) {
      throw new Error("This link code was already used. Generate a new code.");
    }
    if (Date.now() > codeData.expiresAt.toMillis()) {
      throw new Error("Link code expired. Generate a new code.");
    }

    const stationLabel = await readBusinessStationLabel(codeData.businessId);
    const linkDoc: TeamMessengerLinkDoc = {
      businessId: codeData.businessId,
      userId: codeData.userId,
      memberName: codeData.memberName,
      role: codeData.role,
      stationLabel,
      linkedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const indexRef = db.collection(LINK_CODE_INDEX_COLLECTION).doc(code);
      const bizCodeRef = db
        .collection("businesses")
        .doc(codeData.businessId)
        .collection("team_messenger_link_codes")
        .doc(code);
      const freshCode = await tx.get(indexRef);
      if (!freshCode.exists) throw new Error("Link code not found.");
      const fresh = freshCode.data() as TeamMessengerLinkCodeDoc;
      if (fresh.usedAt) throw new Error("This link code was already used.");

      tx.set(db.collection("team_messenger_links").doc(params.psid), linkDoc);
      tx.update(indexRef, { usedAt: FieldValue.serverTimestamp() });
      tx.update(bizCodeRef, { usedAt: FieldValue.serverTimestamp() });

      if (codeData.role === "owner") {
        tx.update(db.collection("businesses").doc(codeData.businessId), {
          ownerMessengerPsid: params.psid,
          ownerMessengerLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.update(
          db
            .collection("businesses")
            .doc(codeData.businessId)
            .collection("members")
            .doc(codeData.userId),
          {
            messengerPsid: params.psid,
            messengerLinkedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        );
      }
    });

    logger.info("team_messenger_linked", {
      businessId: codeData.businessId,
      userId: codeData.userId,
      psid: params.psid,
    });

    return { ...linkDoc, psid: params.psid };
  }

  static async resolveLinkedMember(
    psid: string,
  ): Promise<(TeamMessengerLinkDoc & { psid: string }) | null> {
    const snap = await db.collection("team_messenger_links").doc(psid.trim()).get();
    if (!snap.exists) return null;
    return { ...(snap.data() as TeamMessengerLinkDoc), psid: psid.trim() };
  }
}

function serializeOptionalTimestamp(value: unknown): string | undefined {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}
