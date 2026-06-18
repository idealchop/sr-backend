import crypto from "crypto";
import { db, FieldValue } from "../../config/firebase-admin";

export type PartnerWebhookRecord = {
  id: string;
  url: string;
  events: string[];
  secretHint: string;
  active: boolean;
  createdAt: string;
};

export type RegisterWebhookInput = {
  url: string;
  events: string[];
};

function collection(businessId: string) {
  return db.collection("businesses").doc(businessId).collection("partner_webhooks");
}

/**
 * SC-07 — partner webhook registration (evolution of BL-28).
 */
export class PartnerWebhookService {
  static async list(businessId: string): Promise<PartnerWebhookRecord[]> {
    const snap = await collection(businessId).orderBy("createdAt", "desc").limit(20).get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt?.toDate ?
        d.createdAt.toDate().toISOString() :
        new Date().toISOString();
      return {
        id: doc.id,
        url: String(d.url || ""),
        events: Array.isArray(d.events) ? d.events.map(String) : [],
        secretHint: String(d.secretHint || "****"),
        active: d.active !== false,
        createdAt,
      };
    });
  }

  static async register(
    businessId: string,
    input: RegisterWebhookInput,
  ): Promise<{ webhook: PartnerWebhookRecord; signingSecret: string }> {
    const url = input.url.trim().slice(0, 500);
    if (!url.startsWith("https://")) throw new Error("INVALID_URL");
    const events = (input.events || []).slice(0, 12).map((e) => e.trim()).filter(Boolean);
    const signingSecret = crypto.randomBytes(24).toString("hex");
    const secretHint = `${signingSecret.slice(0, 4)}…${signingSecret.slice(-4)}`;

    const ref = await collection(businessId).add({
      url,
      events,
      signingSecret,
      secretHint,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      webhook: {
        id: ref.id,
        url,
        events,
        secretHint,
        active: true,
        createdAt: new Date().toISOString(),
      },
      signingSecret,
    };
  }

  static async deactivate(businessId: string, webhookId: string): Promise<void> {
    await collection(businessId).doc(webhookId).update({ active: false });
  }

  static signPayload(secret: string, body: string): string {
    return crypto.createHmac("sha256", secret).update(body).digest("hex");
  }
}
