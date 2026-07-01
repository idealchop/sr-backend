import { randomBytes } from "node:crypto";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import type { RiderMessengerLinkCodeDoc, RiderMessengerLinkDoc } from "./rider-messenger-types";

const LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_CODE_PREFIX = "RDR-";
const LINK_CODE_INDEX_COLLECTION = "rider_messenger_link_codes";

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

export class RiderMessengerLinkService {
  static async createLinkCode(params: {
    businessId: string;
    riderId: string;
  }): Promise<{ code: string; expiresAt: string }> {
    const rider = await RiderService.getRider(params.businessId, params.riderId);
    if (!rider?.id) {
      throw new Error("Rider not found");
    }
    if (rider.status === "inactive") {
      throw new Error("Cannot link inactive rider");
    }

    const code = generateLinkCodeValue();
    const expiresAt = Timestamp.fromMillis(Date.now() + LINK_CODE_TTL_MS);

    const codeDoc: RiderMessengerLinkCodeDoc & { businessId: string } = {
      businessId: params.businessId,
      riderId: params.riderId,
      riderName: rider.name,
      expiresAt,
      usedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(
      db
        .collection("businesses")
        .doc(params.businessId)
        .collection("rider_messenger_link_codes")
        .doc(code),
      codeDoc,
    );
    batch.set(db.collection(LINK_CODE_INDEX_COLLECTION).doc(code), codeDoc);
    await batch.commit();

    return { code, expiresAt: expiresAt.toDate().toISOString() };
  }

  static async unlinkRider(params: {
    businessId: string;
    riderId: string;
  }): Promise<void> {
    const rider = await RiderService.getRider(params.businessId, params.riderId);
    if (!rider?.id) return;

    const psid = (rider as { messengerPsid?: string }).messengerPsid?.trim();
    if (psid) {
      await db.collection("rider_messenger_links").doc(psid).delete();
    }

    await db
      .collection("businesses")
      .doc(params.businessId)
      .collection("riders")
      .doc(params.riderId)
      .update({
        messengerPsid: FieldValue.delete(),
        messengerLinkedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  static async getLinkStatus(params: {
    businessId: string;
    riderId: string;
  }): Promise<{ linked: boolean; messengerPsid?: string; linkedAt?: string }> {
    const rider = await RiderService.getRider(params.businessId, params.riderId);
    const psid = (rider as { messengerPsid?: string } | null)?.messengerPsid?.trim();
    const linkedAtRaw = (rider as { messengerLinkedAt?: unknown } | null)?.messengerLinkedAt;
    let linkedAt: string | undefined;
    if (linkedAtRaw && typeof (linkedAtRaw as { toDate?: () => Date }).toDate === "function") {
      linkedAt = (linkedAtRaw as { toDate: () => Date }).toDate().toISOString();
    }
    return { linked: Boolean(psid), messengerPsid: psid || undefined, linkedAt };
  }

  static async bindPsidWithCode(params: {
    psid: string;
    codeRaw: string;
  }): Promise<{ businessId: string; riderId: string; riderName: string; stationLabel: string }> {
    const code = normalizeCode(params.codeRaw);
    if (!code.startsWith(LINK_CODE_PREFIX)) {
      throw new Error("Invalid link code format. Ask your owner for a code like RDR-7K2M.");
    }

    const existing = await db.collection("rider_messenger_links").doc(params.psid).get();
    if (existing.exists) {
      const data = existing.data() as RiderMessengerLinkDoc;
      return {
        businessId: data.businessId,
        riderId: data.riderId,
        riderName: data.riderName,
        stationLabel: data.stationLabel,
      };
    }

    const codeRef = db.collection(LINK_CODE_INDEX_COLLECTION).doc(code);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      throw new Error("Link code not found. Ask your owner for a new code.");
    }

    const codeData = codeSnap.data() as RiderMessengerLinkCodeDoc & { businessId: string };
    const businessId = codeData.businessId;
    if (codeData.usedAt) {
      throw new Error("This link code was already used. Ask your owner for a new code.");
    }

    const expiresMs = codeData.expiresAt.toMillis();
    if (Date.now() > expiresMs) {
      throw new Error("Link code expired. Ask your owner for a new code.");
    }

    const rider = await RiderService.getRider(businessId, codeData.riderId);
    if (!rider?.id) {
      throw new Error("Rider no longer exists. Ask your owner.");
    }

    const stationLabel = await readBusinessStationLabel(businessId);
    const linkDoc: RiderMessengerLinkDoc = {
      businessId,
      riderId: codeData.riderId,
      riderName: rider.name,
      stationLabel,
      linkedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const indexRef = db.collection(LINK_CODE_INDEX_COLLECTION).doc(code);
      const bizCodeRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("rider_messenger_link_codes")
        .doc(code);
      const freshCode = await tx.get(indexRef);
      if (!freshCode.exists) throw new Error("Link code not found.");
      const fresh = freshCode.data() as RiderMessengerLinkCodeDoc;
      if (fresh.usedAt) throw new Error("This link code was already used.");

      tx.set(db.collection("rider_messenger_links").doc(params.psid), linkDoc);
      tx.update(indexRef, { usedAt: FieldValue.serverTimestamp() });
      tx.update(bizCodeRef, { usedAt: FieldValue.serverTimestamp() });
      tx.update(
        db.collection("businesses").doc(businessId).collection("riders").doc(codeData.riderId),
        {
          messengerPsid: params.psid,
          messengerLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      );
    });

    logger.info("rider_messenger_linked", {
      businessId,
      riderId: codeData.riderId,
      psid: params.psid,
    });

    return {
      businessId,
      riderId: codeData.riderId,
      riderName: rider.name,
      stationLabel,
    };
  }

  static async resolveLinkedRider(
    psid: string,
  ): Promise<(RiderMessengerLinkDoc & { psid: string }) | null> {
    const snap = await db.collection("rider_messenger_links").doc(psid.trim()).get();
    if (!snap.exists) return null;
    const data = snap.data() as RiderMessengerLinkDoc;
    return { ...data, psid: psid.trim() };
  }
}
