import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

test.describe("Administrative Management (BDD)", () => {
  test("Scenario: User updates account and business UI config", async ({
    request,
  }) => {
    // user123 appAccess is granted in setup.spec.ts

    // 1. Update Account
    const accRes = await request.put(`${API_PATH}/auth/account`, {
      headers: { Authorization: MOCK_TOKEN },
      data: { displayName: "Super Admin", photoURL: "https://avatar.com/123" },
    });
    expect(accRes.status()).toBe(200);
    expect((await accRes.json()).success).toBe(true);

    // 2. Create Business for UI config test
    const bizRes = await request.post(`${API_PATH}/business/create`, {
      headers: { Authorization: MOCK_TOKEN },
      data: { name: "UI Config Biz" },
    });
    const { businessId } = await bizRes.json();

    // 3. Update UI Config
    const uiRes = await request.patch(
      `${API_PATH}/business/${businessId}/ui-config`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          uiConfig: { theme: "dark", language: "fr" },
        },
      },
    );
    expect(uiRes.status()).toBe(200);
  });

  test("Scenario: Business owner manages payment information", async ({
    request,
  }) => {
    // 1. Create Business
    const bizRes = await request.post(`${API_PATH}/business/create`, {
      headers: { Authorization: MOCK_TOKEN },
      data: { name: "Bank Station" },
    });
    const { businessId } = await bizRes.json();

    // 2. Add Payment Info
    const addRes = await request.post(
      `${API_PATH}/business/payment-info/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          bankName: "BDO",
          accountName: "John Doe",
          accountNumber: "123",
          isPrimary: true,
        },
      },
    );
    expect(addRes.status()).toBe(201);
    const { paymentId } = await addRes.json();

    // 3. List Payment Info
    const listRes = await request.get(
      `${API_PATH}/business/payment-info/${businessId}?sortBy=bankName&sortOrder=asc`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(listRes.status()).toBe(200);
    const { data: payments } = await listRes.json();
    expect(payments.some((p: any) => p.bankName === "BDO")).toBe(true);

    // 4. Update Payment Info
    const upRes = await request.put(
      `${API_PATH}/business/payment-info/${businessId}/${paymentId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { accountName: "John H. Doe" },
      },
    );
    expect(upRes.status()).toBe(200);

    // 5. Delete Payment Info
    const delRes = await request.delete(
      `${API_PATH}/business/payment-info/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { paymentIds: [paymentId] },
      },
    );
    expect(delRes.status()).toBe(200);
  });
});
