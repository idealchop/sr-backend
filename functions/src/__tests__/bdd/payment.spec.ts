import { test, expect } from "@playwright/test";
import { API_PATH, MOCK_TOKEN, ensureOwnerWorkspace } from "./bdd-api";

test.describe("Revenue Dispatch Management (BDD)", () => {
  test("Scenario: Owner configures multiple payment channels", async ({
    request,
  }) => {
    // 1. Resolve owner workspace
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Payment Station",
      email: "payment@test.com",
    });

    // 2. Add Primary Payment Channel (BDO)
    const addBdo = await request.post(
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
    expect(addBdo.status()).toBe(201);
    const { paymentId: primaryId } = await addBdo.json();

    // 3. Add Secondary Payment Channel (GCash)
    const addGcash = await request.post(
      `${API_PATH}/business/payment-info/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          bankName: "GCash",
          accountName: "John Doe",
          accountNumber: "09171234567",
          isPrimary: false,
        },
      },
    );
    expect(addGcash.status()).toBe(201);

    // 4. List channels and verify primary
    const listRes = await request.get(
      `${API_PATH}/business/payment-info/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(listRes.status()).toBe(200);
    const { data: channels } = await listRes.json();

    const bdo = channels.find((c: any) => c.bankName === "BDO");
    const gcash = channels.find((c: any) => c.bankName === "GCash");

    expect(bdo.isPrimary).toBe(true);
    expect(gcash.isPrimary).toBe(false);

    // 5. Update GCash to be primary (Simplified: standard update)
    const updateRes = await request.put(
      `${API_PATH}/business/payment-info/${businessId}/${gcash.id}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { isPrimary: true },
      },
    );
    expect(updateRes.status()).toBe(200);

    // 6. Delete BDO channel
    const deleteRes = await request.delete(
      `${API_PATH}/business/payment-info/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { paymentIds: [primaryId] },
      },
    );
    expect(deleteRes.status()).toBe(200);
  });
});
