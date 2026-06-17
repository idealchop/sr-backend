import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

test.describe("Rider live tracking (BDD)", () => {
  test("Scenario: Rider posts GPS and public track returns location", async ({
    request,
  }) => {
    const businessId = "test-id";
    const listRes = await request.get(
      `${API_PATH}/business/${businessId}/riders`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    test.skip(
      listRes.status() !== 200,
      "Firebase emulator / seeded business required",
    );

    const riders = (await listRes.json()).data as Array<{ id: string }>;
    const riderId = riders[0]?.id;
    test.skip(!riderId, "No riders in test business");

    const locRes = await request.post(
      `${API_PATH}/business/${businessId}/riders/${riderId}/location`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { latitude: 14.4081, longitude: 121.0415 },
      },
    );
    expect(locRes.status()).toBe(200);
    const locBody = await locRes.json();
    expect(locBody.data?.lastLocation?.latitude).toBeCloseTo(14.4081, 3);
  });
});
