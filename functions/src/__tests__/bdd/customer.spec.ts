import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

// Note: Assumes a business with ID 'test-id' exists from previous steps or seeds.
test.describe("Customer Management Lifecycle (BDD)", () => {
  test("Scenario: Owner manages customer base", async ({ request }) => {
    // 1. Add a new customer
    const addRes = await request.post(
      `${API_PATH}/business/test-id/customers`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          name: "Alice Wonderland",
          email: "alice@example.com",
          phone: "555-0123",
        },
      },
    );
    expect(addRes.status()).toBe(201);
    const addData = await addRes.json();
    const customerId = addData.data.id;
    expect(customerId).toBeDefined();
    expect(addData.data.hasBalance).toBe(false);

    // 2. Get the customer
    const getRes = await request.get(
      `${API_PATH}/business/test-id/customers/${customerId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(getRes.status()).toBe(200);
    const getData = await getRes.json();
    expect(getData.data.name).toBe("Alice Wonderland");

    // 3. Update the customer
    const updateRes = await request.patch(
      `${API_PATH}/business/test-id/customers/${customerId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          phone: "0987654321",
          isDeliveryEnabled: true,
          deliveryConfig: { frequency: "weekly", preferredDays: [1, 3] },
        },
      },
    );
    expect(updateRes.status()).toBe(200);

    // 4. Verify updated customer
    const getUpdatedRes = await request.get(
      `${API_PATH}/business/test-id/customers/${customerId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(getUpdatedRes.status()).toBe(200);
    const updatedData = await getUpdatedRes.json();
    expect(updatedData.data.isDeliveryEnabled).toBe(true);

    // 5. Delete the customer
    const deleteRes = await request.delete(
      `${API_PATH}/business/test-id/customers/${customerId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(deleteRes.status()).toBe(200);
  });

  test("Scenario: Customer possession affects inventory", async ({
    request,
  }) => {
    const businessId = "test-id";

    const createItemRes = await request.post(
      `${API_PATH}/inventory/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          name: "Slim Container (BDD)",
          categoryId: "containers",
          stock: { current: 100, min: 5 },
          cost: 50,
        },
      },
    );
    expect(createItemRes.status()).toBe(201);
    const itemId = (await createItemRes.json()).itemId as string;
    expect(itemId).toBeDefined();

    const stockBeforeRes = await request.get(
      `${API_PATH}/inventory/${businessId}/${itemId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(stockBeforeRes.status()).toBe(200);
    const stockBefore = (await stockBeforeRes.json()).stock?.current ?? 0;
    expect(stockBefore).toBe(100);

    const addRes = await request.post(
      `${API_PATH}/business/${businessId}/customers`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          name: "Inventory Test User",
          email: "inv@test.com",
          containerPolicy: "wrs_rotation",
          possession: {
            [itemId]: { quantity: 5, itemName: "Slim Container (BDD)" },
          },
        },
      },
    );
    expect(addRes.status()).toBe(201);
    const customerId = (await addRes.json()).data.id;

    const stockAfterAssignRes = await request.get(
      `${API_PATH}/inventory/${businessId}/${itemId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(stockAfterAssignRes.status()).toBe(200);
    const stockAfterAssign =
      (await stockAfterAssignRes.json()).stock?.current ?? 0;
    expect(stockAfterAssign).toBe(95);

    const deleteRes = await request.delete(
      `${API_PATH}/business/${businessId}/customers/${customerId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(deleteRes.status()).toBe(200);

    const stockAfterDeleteRes = await request.get(
      `${API_PATH}/inventory/${businessId}/${itemId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(stockAfterDeleteRes.status()).toBe(200);
    const stockAfterDelete =
      (await stockAfterDeleteRes.json()).stock?.current ?? 0;
    expect(stockAfterDelete).toBe(100);
  });
});
