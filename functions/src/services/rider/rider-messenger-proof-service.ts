import { storage } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { resolveMetaPageAccessToken } from "../meta/meta-messenger-send-service";

/** Download image bytes from a Messenger attachment URL. */
export async function downloadMessengerImageAttachment(
  attachmentUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const url = attachmentUrl.trim();
  if (!url) return null;

  const token = await resolveMetaPageAccessToken();
  const fetchUrl = new URL(url);
  if (token) {
    fetchUrl.searchParams.set("access_token", token);
  }

  try {
    const response = await fetch(fetchUrl.toString());
    if (!response.ok) {
      logger.warn("downloadMessengerImageAttachment http_error", {
        status: response.status,
      });
      return null;
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (error) {
    logger.warn("downloadMessengerImageAttachment failed", { error });
    return null;
  }
}

export async function uploadRiderMessengerDeliveryProof(params: {
  businessId: string;
  referenceId: string;
  imageBuffer: Buffer;
  contentType?: string;
}): Promise<string | null> {
  const bucketName =
    process.env.SMARTREFILL_FIREBASE_STORAGE_BUCKET?.trim() ||
    "smartrefill-singapore";
  const bucket = storage.bucket(bucketName);
  const safeRef = params.referenceId.replace(/[^\w-]+/g, "_") || "job";
  const ext = params.contentType?.includes("png") ? "png" : "jpg";
  const objectPath =
    `rider-messenger-proofs/${params.businessId}/${safeRef}-${Date.now()}.${ext}`;
  const file = bucket.file(objectPath);

  try {
    await file.save(params.imageBuffer, {
      contentType: params.contentType || "image/jpeg",
      metadata: { cacheControl: "private, max-age=31536000" },
    });
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
  } catch (error) {
    logger.error("uploadRiderMessengerDeliveryProof failed", {
      businessId: params.businessId,
      referenceId: params.referenceId,
      error,
    });
    return null;
  }
}
