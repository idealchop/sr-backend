import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

test.describe("Customer Consumption Analysis (BDD)", () => {
  test("Scenario: Owner views customer consumption profile", async ({
    request,
  }) => {
    // 1. Identify a customer (using 'test-customer-id' which is often seeded)
    const customerId = "test-customer-id";
    const businessId = "test-id";

    // 2. Fetch single customer stats (this feeds the summary cards next to the chart)
    const statsRes = await request.get(
      `${API_PATH}/business/${businessId}/customers/${customerId}/stats`,
      { headers: { Authorization: MOCK_TOKEN } },
    );

    expect(statsRes.status()).toBe(200);
    const statsData = await statsRes.json();

    expect(statsData.data).toHaveProperty("totalRevenue");
    expect(statsData.data).toHaveProperty("totalOrders");
    expect(statsData.data).toHaveProperty("lastOrderAt");

    // 3. Fetch transactions (this feeds the chart itself)
    const txRes = await request.get(
      `${API_PATH}/business/${businessId}/transactions?customerId=${customerId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );

    expect(txRes.status()).toBe(200);
    const txData = await txRes.json();

    expect(Array.isArray(txData.data)).toBe(true);

    // Validate that if there are transactions, they have the required fields for the chart
    if (txData.data.length > 0) {
      const firstTx = txData.data[0];
      expect(firstTx).toHaveProperty("createdAt");
      // The chart in frontend uses waterRefills quantity
      expect(firstTx).toHaveProperty("waterRefills");
    }
  });
});
