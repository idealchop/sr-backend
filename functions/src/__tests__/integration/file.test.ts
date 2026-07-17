import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileService } from "../../services/files/file-service";

// --- Mocks ---
const mockFileSave = vi.fn().mockResolvedValue({});
const mockFileMakePublic = vi.fn().mockResolvedValue({});
const mockBucketFile = vi.fn().mockReturnValue({
  save: mockFileSave,
  makePublic: mockFileMakePublic,
});

vi.mock("../../config/firebase-admin", () => ({
  storage: {
    bucket: vi.fn(() => ({
      file: mockBucketFile,
      name: "test-bucket",
      exists: vi.fn().mockResolvedValue([true]),
    })),
  },
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: vi.fn().mockResolvedValue({}),
          })),
        })),
        set: vi.fn().mockResolvedValue({}),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("sharp", () => {
  const sharpMock = vi.fn(() => ({
    webp: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-buffer")),
  }));
  return { default: sharpMock };
});

vi.mock("../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("FileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadImage", () => {
    it("should process and upload 3 variants of an image", async () => {
      const parentId = "biz_123";
      const category = "test";
      const filename = "test.jpg";
      const buffer = Buffer.from("fake-image-content");
      const mimeType = "image/jpeg";

      const result = await FileService.uploadImage(
        parentId,
        category,
        filename,
        buffer,
        mimeType,
      );

      expect(result).toBeDefined();
      expect(result.id).toContain("test");
      expect(result.urls.original).toBeDefined();
      expect(result.urls.web).toBeDefined();
      expect(result.urls.thumbnail).toBeDefined();

      // Verify bucket interaction
      expect(mockBucketFile).toHaveBeenCalledTimes(3);
      expect(mockFileSave).toHaveBeenCalledTimes(3);
      expect(mockFileMakePublic).toHaveBeenCalledTimes(3);
    });

    it("should record metadata in business subcollection for business parentId", async () => {
      const { db } = await import("../../config/firebase-admin");
      const parentId = "biz_123";

      await FileService.uploadImage(
        parentId,
        "test",
        "test.jpg",
        Buffer.from("fake"),
        "image/jpeg",
      );

      expect(db.collection).toHaveBeenCalledWith("businesses");
    });

    it("should record metadata in top-level collection for user parentType", async () => {
      const { db } = await import("../../config/firebase-admin");
      const parentId = "abcdefghijklmnopqrstuvwxyz12";

      await FileService.uploadImage(
        parentId,
        "test",
        "test.jpg",
        Buffer.from("fake"),
        "image/jpeg",
        { parentType: "user" },
      );

      expect(db.collection).toHaveBeenCalledWith("files");
    });

    it("should not treat long Firebase uids as business ids without parentType", async () => {
      const { db } = await import("../../config/firebase-admin");
      const firebaseUid = "abcdefghijklmnopqrstuvwxyz12";

      await FileService.uploadImage(
        firebaseUid,
        "test",
        "test.jpg",
        Buffer.from("fake"),
        "image/jpeg",
        { parentType: "user" },
      );

      expect(db.collection).not.toHaveBeenCalledWith("businesses");
    });
  });
});
