import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

// --- Mocks ---
vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com" };
    next();
  }),
}));

vi.mock("../../services/files/file-service", () => ({
  FileService: {
    uploadImage: vi.fn().mockResolvedValue({
      id: "mock-id",
      urls: { web: "http://test.com/web.webp" },
      path: "path/to/file",
      mimeType: "image/webp",
      size: 1000,
    }),
  },
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("File Handler API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle multipart file upload", async () => {
    const res = await request(app)
      .post("/files/upload")
      .field("parentId", "biz_123")
      .field("category", "transactions")
      .attach("file", Buffer.from("fake-image"), "test.jpg");

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe("mock-id");
    expect(res.body.data.urls.web).toBeDefined();
  });

  it("should return 400 if parentId is missing", async () => {
    const res = await request(app)
      .post("/files/upload")
      .field("category", "transactions")
      .attach("file", Buffer.from("fake-image"), "test.jpg");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("parentId");
  });

  it("should return 400 if no file is uploaded", async () => {
    const res = await request(app)
      .post("/files/upload")
      .field("parentId", "biz_123")
      .field("category", "transactions");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No file uploaded");
  });
});
