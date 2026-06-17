import { storage, db, FieldValue } from "../../config/firebase-admin";
import sharp from "sharp";
import { logger } from "../observability/logging/logger";

export interface UploadedFile {
  id: string;
  urls: {
    thumbnail: string;
    web: string;
    original: string;
  };
  path: string;
  mimeType: string;
  size: number;
  metadata?: any;
}

export type FileParentType = "business" | "user";

export class FileService {
  /**
   * Processes and uploads an image in 3 variants (thumbnail, web, original).
   * @param {string} parentId Parent ID for pathing (business id or user uid).
   * @param {string} category Category (e.g. transactions, support_attachments).
   * @param {string} filename Base filename.
   * @param {Buffer} buffer Image buffer.
   * @param {string} mimeType Original mime type.
   * @param {object} [opts] Storage target — never infer business from uid length.
   * @param {FileParentType} [opts.parentType] business or user Firestore path.
   * @return {Promise<UploadedFile>} Uploaded file metadata and public URLs.
   */
  static async uploadImage(
    parentId: string,
    category: string,
    filename: string,
    buffer: Buffer,
    mimeType: string,
    opts?: { parentType?: FileParentType },
  ): Promise<UploadedFile> {
    try {
      const bucket = storage.bucket();

      // Verify bucket exists early to avoid confusing error later (Skip in emulator)
      const [exists] = process.env.FUNCTIONS_EMULATOR ?
        [true] :
        await bucket.exists();
      if (!exists) {
        throw new Error(
          `Storage bucket "${bucket.name}" does not exist. Please check your configuration.`,
        );
      }

      const baseName = filename.split(".")[0];
      const timestamp = Date.now();
      const folderPath = `${parentId}/images/${category}/${timestamp}_${baseName}`;

      // 1. Original (converted to WebP)
      const originalBuffer = await sharp(buffer)
        .webp({ quality: 90 })
        .toBuffer();

      // 2. Web (1200px wide)
      const webBuffer = await sharp(buffer)
        .resize(1200, null, { withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      // 3. Thumbnail (200x200)
      const thumbnailBuffer = await sharp(buffer)
        .resize(200, 200, { fit: "cover" })
        .webp({ quality: 70 })
        .toBuffer();

      const variants = [
        { name: "original", buffer: originalBuffer },
        { name: "web", buffer: webBuffer },
        { name: "thumbnail", buffer: thumbnailBuffer },
      ];

      const urls: any = {};

      for (const variant of variants) {
        const filePath = `${folderPath}-${variant.name}.webp`;
        const file = bucket.file(filePath);

        await file.save(variant.buffer, {
          metadata: {
            contentType: "image/webp",
            cacheControl: "public, max-age=31536000",
          },
        });

        // Make public (or get signed URL if private, but protocol says public for now)
        // For simplicity in v3, we use public URLs for attachments
        await file.makePublic();
        urls[variant.name] =
          `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      }

      // Record metadata in Firestore (Top level or nested)
      const fileId = `${timestamp}_${baseName}`;
      const fileData = {
        parentId,
        category,
        urls,
        path: folderPath,
        originalMimeType: mimeType,
        mimeType: "image/webp",
        size: buffer.length,
        createdAt: FieldValue.serverTimestamp(),
      };

      const parentType = opts?.parentType ?? "business";
      if (parentType === "business") {
        await db
          .collection("businesses")
          .doc(parentId)
          .collection("files")
          .doc(fileId)
          .set(fileData);
      } else {
        await db.collection("files").doc(fileId).set({
          ...fileData,
          parentType: "user",
        });
      }

      return {
        id: fileId,
        urls,
        path: folderPath,
        mimeType: "image/webp",
        size: buffer.length,
      };
    } catch (error) {
      logger.error("Error in FileService.uploadImage", error);
      throw error;
    }
  }

  /**
   * Stores a video or other non-image binary as-is (e.g. support chat recordings).
   * @param {string} parentId Parent ID for pathing (business id or user uid).
   * @param {string} category Category (e.g. support_attachments).
   * @param {string} filename Base filename.
   * @param {Buffer} buffer Media buffer.
   * @param {string} mimeType Original mime type.
   * @param {object} [opts] Storage target — never infer business from uid length.
   * @param {FileParentType} [opts.parentType] business or user Firestore path.
   * @return {Promise<UploadedFile>} Uploaded file metadata and public URLs.
   */
  static async uploadMedia(
    parentId: string,
    category: string,
    filename: string,
    buffer: Buffer,
    mimeType: string,
    opts?: { parentType?: FileParentType },
  ): Promise<UploadedFile> {
    try {
      const bucket = storage.bucket();
      const [exists] = process.env.FUNCTIONS_EMULATOR ?
        [true] :
        await bucket.exists();
      if (!exists) {
        throw new Error(
          `Storage bucket "${bucket.name}" does not exist. Please check your configuration.`,
        );
      }

      const ext = FileService.mediaExtension(mimeType, filename);
      const baseName = (filename.split(".")[0] || "recording").replace(/\s+/g, "_");
      const timestamp = Date.now();
      const filePath = `${parentId}/videos/${category}/${timestamp}_${baseName}.${ext}`;
      const file = bucket.file(filePath);
      const contentType = mimeType.split(";")[0].trim() || "video/mp4";

      await file.save(buffer, {
        metadata: {
          contentType,
          cacheControl: "public, max-age=31536000",
        },
      });
      await file.makePublic();

      const publicUrl =
        `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      const fileId = `${timestamp}_${baseName}`;
      const fileData = {
        parentId,
        category,
        urls: {
          original: publicUrl,
          web: publicUrl,
          thumbnail: publicUrl,
        },
        path: filePath,
        originalMimeType: mimeType,
        mimeType: contentType,
        size: buffer.length,
        createdAt: FieldValue.serverTimestamp(),
      };

      const parentType = opts?.parentType ?? "business";
      if (parentType === "business") {
        await db
          .collection("businesses")
          .doc(parentId)
          .collection("files")
          .doc(fileId)
          .set(fileData);
      } else {
        await db.collection("files").doc(fileId).set({
          ...fileData,
          parentType: "user",
        });
      }

      return {
        id: fileId,
        urls: fileData.urls,
        path: filePath,
        mimeType: contentType,
        size: buffer.length,
      };
    } catch (error) {
      logger.error("Error in FileService.uploadMedia", error);
      throw error;
    }
  }

  private static mediaExtension(mimeType: string, filename: string): string {
    const mime = mimeType.split(";")[0].trim().toLowerCase();
    const map: Record<string, string> = {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "video/3gpp": "3gp",
      "video/mpeg": "mpeg",
    };
    if (map[mime]) return map[mime];
    const fromName = filename.split(".").pop()?.toLowerCase();
    if (fromName && fromName.length <= 5) return fromName;
    return "mp4";
  }
}
