import { test, expect } from "@playwright/test";
import { API_PATH, MOCK_TOKEN, ensureOwnerWorkspace } from "./bdd-api";

test.describe("Business Management Lifecycle (BDD)", () => {
  test("Scenario: Owner manages station portfolio", async ({ request }) => {
    // 1. Resolve owner workspace (201 if new, 200 if seeded / already exists)
    const alpha = await ensureOwnerWorkspace(request, {
      name: "Station Alpha",
      email: "alpha@test.com",
    });

    // 2. Second create is idempotent — same workspace, no duplicate doc
    const beta = await ensureOwnerWorkspace(request, {
      name: "Station Beta",
      email: "beta@test.com",
    });
    expect(beta.status).toBe(200);
    expect(beta.alreadyExists).toBe(true);
    expect(beta.businessId).toBe(alpha.businessId);

    // 3. List Businesses
    const listRes = await request.get(`${API_PATH}/business`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.data.length).toBeGreaterThanOrEqual(1);

    // 4. Get one business
    const { businessId } = alpha;
    const getRes = await request.get(`${API_PATH}/business/${businessId}`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(getRes.status()).toBe(200);

    // 5. Update Station Details
    if (listData.data.length > 0) {
      const bizId = listData.data[0].id;
      const updateRes = await request.put(`${API_PATH}/business/${bizId}`, {
        headers: { Authorization: MOCK_TOKEN },
        data: { name: "Station Alpha Refined" },
      });
      expect(updateRes.status()).toBe(200);
    }
  });

  test("Scenario: Unauthorized access prevention", async ({ request }) => {
    const res = await request.get(`${API_PATH}/business/foreign-biz-id`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(res.status()).toBe(404);
  });
});
