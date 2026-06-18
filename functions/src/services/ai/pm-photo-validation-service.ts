import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";

export type PmPhotoValidation = {
  showsFilterHousing: boolean;
  showsUvLamp: boolean;
  showsLogContext: boolean;
  confidence: number;
  notes?: string;
};

/** AI-11 — PM checklist photo validation stub. */
export async function validatePmChecklistPhoto(params: {
  imageDataUri: string;
}): Promise<PmPhotoValidation> {
  const fallback: PmPhotoValidation = {
    showsFilterHousing: false,
    showsUvLamp: false,
    showsLogContext: false,
    confidence: 0,
  };
  if (!getGeminiApiKey()) return fallback;

  const raw = await geminiGenerateJson<PmPhotoValidation>({
    system:
      "Validate PM maintenance photo for water refilling plant. JSON: showsFilterHousing, " +
      "showsUvLamp, showsLogContext, confidence 0-1, notes.",
    user: `Image URI length ${params.imageDataUri.length}`,
    fallback,
  });
  return {
    showsFilterHousing: raw?.showsFilterHousing === true,
    showsUvLamp: raw?.showsUvLamp === true,
    showsLogContext: raw?.showsLogContext === true,
    confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || 0)),
    notes: typeof raw?.notes === "string" ? raw.notes : undefined,
  };
}
