import { db, FieldValue } from "../../config/firebase-admin";

export type StaffCertificationRecord = {
  id: string;
  userId: string;
  trackId: string;
  trackLabel: string;
  status: "in_progress" | "completed";
  completedAt?: string;
  score?: number;
  createdAt: string;
};

export type CreateStaffCertificationInput = {
  userId: string;
  trackId: string;
  trackLabel: string;
};

const TRACKS: Record<string, string> = {
  delivery_proof: "Delivery proof & rider QA",
  pm_checklist: "PM checklist & plant safety",
  water_quality: "Water quality logging (TDS/pH)",
  counter_ops: "Counter staff fundamentals",
};

function collection(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("staff_certifications");
}

/**
 * SC-06 — staff certification CRUD.
 */
export class StaffCertificationService {
  static listTracks(): Array<{ id: string; label: string }> {
    return Object.entries(TRACKS).map(([id, label]) => ({ id, label }));
  }

  static async list(businessId: string): Promise<StaffCertificationRecord[]> {
    const snap = await collection(businessId).orderBy("createdAt", "desc").limit(100).get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt?.toDate ?
        d.createdAt.toDate().toISOString() :
        new Date().toISOString();
      const completedAt = d.completedAt?.toDate ?
        d.completedAt.toDate().toISOString() :
        undefined;
      return {
        id: doc.id,
        userId: String(d.userId || ""),
        trackId: String(d.trackId || ""),
        trackLabel: String(d.trackLabel || TRACKS[d.trackId as string] || d.trackId),
        status: d.status === "completed" ? "completed" : "in_progress",
        completedAt,
        score: d.score != null ? Number(d.score) : undefined,
        createdAt,
      };
    });
  }

  static async create(
    businessId: string,
    input: CreateStaffCertificationInput,
  ): Promise<StaffCertificationRecord> {
    const trackLabel = TRACKS[input.trackId] || input.trackLabel || input.trackId;
    const ref = await collection(businessId).add({
      userId: input.userId,
      trackId: input.trackId,
      trackLabel,
      status: "in_progress",
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      id: ref.id,
      userId: input.userId,
      trackId: input.trackId,
      trackLabel,
      status: "in_progress",
      createdAt: new Date().toISOString(),
    };
  }

  static async complete(
    businessId: string,
    certId: string,
    score?: number,
  ): Promise<void> {
    await collection(businessId).doc(certId).update({
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      ...(score != null ? { score: Math.min(100, Math.max(0, score)) } : {}),
    });
  }

  static async remove(businessId: string, certId: string): Promise<void> {
    await collection(businessId).doc(certId).delete();
  }
}
