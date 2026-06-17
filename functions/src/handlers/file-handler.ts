import { Request, Response } from "express";
import Busboy from "busboy";
import {
  FileService,
  type FileParentType,
} from "../services/files/file-service";
import { logger } from "firebase-functions";
import {
  SUPPORT_VIDEO_MAX_BYTES,
  supportVideoSizeError,
} from "../services/support/support-chat-media-limits";

/**
 * Handles multipart file upload.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const uploadFile = async (req: Request, res: Response) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // eslint-disable-next-line new-cap
  const busboy = Busboy({ headers: req.headers });
  const fields: any = {};
  let fileBuffer: Buffer | null = null;
  let fileName = "";
  let mimeType = "";

  busboy.on("field", (fieldname: string, val: string) => {
    fields[fieldname] = val;
  });

  busboy.on(
    "file",
    (fieldname: string, file: NodeJS.ReadableStream, info: Busboy.FileInfo) => {
      const { filename, mimeType: fileMimeType } = info;
      fileName = filename;
      mimeType = fileMimeType;

      const chunks: any[] = [];
      file.on("data", (data: Buffer) => {
        chunks.push(data);
      });

      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    },
  );

  busboy.on("finish", async () => {
    try {
      const { parentId, businessId, category, parentType: parentTypeField } =
        fields;
      const finalParentId = (businessId || parentId || "").trim();
      const parentType: FileParentType = businessId ?
        "business" :
        String(parentTypeField || "").toLowerCase() === "user" ?
          "user" :
          String(parentTypeField || "").toLowerCase() === "business" ?
            "business" :
            finalParentId.startsWith("biz_") ?
              "business" :
              "user";

      if (!finalParentId || !category) {
        res
          .status(400)
          .json({
            error: "parentId (or businessId) and category are required",
          });
        return;
      }

      if (!fileBuffer) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
      const isVideo = normalizedMime.startsWith("video/");
      const allowedVideos = new Set([
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/3gpp",
        "video/mpeg",
      ]);
      const maxVideoBytes = SUPPORT_VIDEO_MAX_BYTES;
      const maxImageBytes = 12 * 1024 * 1024;

      if (isVideo) {
        if (!allowedVideos.has(normalizedMime)) {
          res.status(400).json({ error: "Unsupported video format. Use MP4, WebM, or MOV." });
          return;
        }
        if (fileBuffer.length > maxVideoBytes) {
          res.status(400).json({ error: supportVideoSizeError() });
          return;
        }
      } else if (fileBuffer.length > maxImageBytes) {
        res.status(400).json({ error: "Image must be 12 MB or smaller." });
        return;
      }

      const uploadedFile = isVideo ?
        await FileService.uploadMedia(
          finalParentId,
          category,
          fileName || "recording.mp4",
          fileBuffer,
          normalizedMime,
          { parentType },
        ) :
        await FileService.uploadImage(
          finalParentId,
          category,
          fileName || "upload.webp",
          fileBuffer,
          mimeType,
          { parentType },
        );

      res.status(201).json({ data: uploadedFile });
    } catch (error: any) {
      logger.error("File upload failed", error);
      res
        .status(500)
        .json({ error: "Internal Server Error", details: error.message });
    }
  });

  busboy.on("error", (error: any) => {
    logger.error("Busboy error", error);
    res.status(500).json({ error: "Form parsing failed" });
  });

  // Pipe the request into busboy
  if ((req as any).rawBody) {
    busboy.end((req as any).rawBody);
  } else {
    req.pipe(busboy);
  }
};
