import { test, expect } from "@playwright/test";
import {
  API_PATH,
  MOCK_TOKEN,
  ensureOwnerWorkspace,
  resetBusinessSubscriptionsToTrial,
} from "./bdd-api";

test.describe("Subscription management (BDD)", () => {
  test("Scenario: Owner manages subscription (trial, renewal, history, cancel)", async ({
    request,
  }) => {
    // Prerequisite: Ensure plans exist (usually seeded)
    const plansRes = await request.get(`${API_PATH}/subscriptions/plans`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(plansRes.status()).toBe(200);

    // 1. Resolve owner workspace
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Sub Station",
    });
    await resetBusinessSubscriptionsToTrial(request, businessId);

    // 2. Get initial subscription status (should be in trial)
    const statusRes = await request.get(
      `${API_PATH}/subscriptions/${businessId}/status`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(statusRes.status()).toBe(200);
    const { data: status } = await statusRes.json();
    expect(status.billingCycle).toBe("trial");

    // 3. Renew subscription
    const renewRes = await request.post(
      `${API_PATH}/subscriptions/${businessId}/renew`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          paymentDetails: {
            paymentReference: "PAY-BDD-TEST",
            voucherCode: "WELCOME10",
          },
        },
      },
    );
    expect(renewRes.status()).toBe(200);

    // 4. Check history
    const historyRes = await request.get(
      `${API_PATH}/subscriptions/${businessId}/history`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(historyRes.status()).toBe(200);
    const { data: history } = await historyRes.json();
    expect(history.length).toBeGreaterThan(1); // Trial + Upgrade
    expect(history[0].planName).toContain("Scale");
    expect(history[0].paymentReference).toBe("PAY-BDD-TEST");
    expect(history[0].voucherCode).toBe("WELCOME10");

    // 5. Cancel on trial / Starter is rejected — use Pricing to change plans
    const cancelRes = await request.post(
      `${API_PATH}/subscriptions/${businessId}/cancel`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {},
      },
    );
    expect(cancelRes.status()).toBe(400);
    const cancelBody = await cancelRes.json();
    expect(String(cancelBody.error || "")).toMatch(/starter|trial|cancel/i);
  });
});
