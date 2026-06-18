import { createHash, randomBytes } from "crypto";
import { db, FieldValue } from "../config/firebase-admin";

export type PlantConfig = {
  staffQrToken?: string;
  tdsMaxProduct?: number;
  phMinProduct?: number;
  phMaxProduct?: number;
};

export function readPlantConfig(
  businessData: Record<string, unknown>,
): PlantConfig {
  const raw = businessData.plantConfig;
  if (!raw || typeof raw !== "object") return {};
  return raw as PlantConfig;
}

export function generateStaffQrToken(): string {
  return randomBytes(24).toString("hex");
}

export function tokenMatches(
  plantConfig: PlantConfig,
  token: string | undefined,
): boolean {
  const expected = String(plantConfig.staffQrToken || "").trim();
  const provided = String(token || "").trim();
  if (!expected || !provided) return false;
  return createHash("sha256").update(provided).digest("hex") ===
    createHash("sha256").update(expected).digest("hex");
}

/**
 * Ensures `plantConfig.staffQrToken` exists; returns the token.
 */
export async function ensureStaffQrToken(businessId: string): Promise<string> {
  const ref = db.collection("businesses").doc(businessId);
  const doc = await ref.get();
  const data = doc.data() ?? {};
  const plantConfig = readPlantConfig(data);
  if (plantConfig.staffQrToken) return plantConfig.staffQrToken;

  const token = generateStaffQrToken();
  await ref.set(
    {
      plantConfig: { ...plantConfig, staffQrToken: token },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return token;
}
