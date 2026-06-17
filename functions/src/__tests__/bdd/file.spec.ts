import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

test.describe("File Upload Lifecycle (BDD)", () => {
  test("Scenario: User uploads a valid image for a business", async ({
    request,
  }) => {
    // 1. Prepare a mock file (real small PNG)
    const filePath = path.join(__dirname, "mock-image.png");
    const smallPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP" +
        "8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(filePath, smallPng);

    // 2. Upload the file via multipart/form-data
    const uploadRes = await request.post(`${API_PATH}/files/upload`, {
      headers: {
        Authorization: MOCK_TOKEN,
      },
      multipart: {
        file: fs.createReadStream(filePath),
        parentId: "biz_test_123",
        category: "bdd_test",
      },
    });

    expect(uploadRes.status()).toBe(201);
    const data = await uploadRes.json();
    expect(data.data.urls.web).toBeDefined();
    expect(data.data.urls.thumbnail).toBeDefined();

    // Cleanup
    fs.unlinkSync(filePath);
  });

  test("Scenario: User fails to upload without category", async ({
    request,
  }) => {
    const filePath = path.join(__dirname, "mock-fail.png");
    fs.writeFileSync(filePath, "data");

    const uploadRes = await request.post(`${API_PATH}/files/upload`, {
      headers: { Authorization: MOCK_TOKEN },
      multipart: {
        file: fs.createReadStream(filePath),
        parentId: "biz_test_123",
        // category missing
      },
    });

    expect(uploadRes.status()).toBe(400);
    fs.unlinkSync(filePath);
  });
});
