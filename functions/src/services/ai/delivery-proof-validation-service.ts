import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";

export type DeliveryProofValidation = {
  jugsVisible: boolean;
  estimatedJugCount: number | null;
  blankImage: boolean;
  wrongSubject: boolean;
  confidence: number;
  notes?: string;
};

/** AI-10 — delivery proof photo validation stub. */
export async function validateDeliveryProofPhoto(params: {
  imageDataUri: string;
}): Promise<DeliveryProofValidation> {
  const fallback: DeliveryProofValidation = {
    jugsVisible: false,
    estimatedJugCount: null,
    blankImage: false,
    wrongSubject: false,
    confidence: 0,
  };
  if (!getGeminiApiKey()) return fallback;

  const raw = await geminiGenerateJson<DeliveryProofValidation>({
    system:
      "Validate water delivery proof photo. JSON: jugsVisible, estimatedJugCount, blankImage, " +
      "wrongSubject, confidence 0-1, notes.",
    user: `Image URI length ${params.imageDataUri.length}`,
    fallback,
  });
  return {
    jugsVisible: raw?.jugsVisible === true,
    estimatedJugCount:
      raw?.estimatedJugCount != null ? Number(raw.estimatedJugCount) : null,
    blankImage: raw?.blankImage === true,
    wrongSubject: raw?.wrongSubject === true,
    confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || 0)),
    notes: typeof raw?.notes === "string" ? raw.notes : undefined,
  };
}
