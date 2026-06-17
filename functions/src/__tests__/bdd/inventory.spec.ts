import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

// Note: Assumes a business with ID 'test-id' exists.
test.describe("Inventory Management Lifecycle (BDD)", () => {
  test("Scenario: Owner manages warehouse assets", async ({ request }) => {
    // 1. Create a new inventory item
    const createRes = await request.post(`${API_PATH}/inventory/test-id`, {
      headers: { Authorization: MOCK_TOKEN },
      data: {
        name: "5 Gallon Round Bottle",
        categoryId: "containers",
        stock: { current: 100, min: 20 },
        cost: 150,
      },
    });
    expect(createRes.status()).toBe(201);
    const createData = await createRes.json();
    const itemId = createData.itemId;
    expect(itemId).toBeDefined();

    // 2. Get the inventory item
    const getRes = await request.get(
      `${API_PATH}/inventory/test-id/${itemId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(getRes.status()).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(itemId);

    // 3. Update the inventory item
    const updateRes = await request.patch(
      `${API_PATH}/inventory/test-id/${itemId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { stock: 90 },
      },
    );
    expect(updateRes.status()).toBe(200);

    // 4. List all inventory items
    const listRes = await request.get(`${API_PATH}/inventory/test-id`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.data.some((item: any) => item.id === itemId)).toBe(true);

    // 5. Delete the inventory item
    const deleteRes = await request.delete(
      `${API_PATH}/inventory/test-id/${itemId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(deleteRes.status()).toBe(200);
  });

  test("Scenario: Unauthorized access to inventory", async ({ request }) => {
    const res = await request.get(`${API_PATH}/inventory/foreign-biz-id`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    // Assuming the mock token only has access to 'test-id' or 'parent-id'
    expect(res.status()).toBe(403);
  });
});
