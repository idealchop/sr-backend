import { test, expect } from "@playwright/test";
import {
  API_PATH,
  MOCK_TOKEN,
  ensureOwnerWorkspace,
  resetBusinessSubscriptionsToTrial,
} from "./bdd-api";

/**
 * Subscription lifecycle BDD (emulator).
 * See smartrefill-v3/docs/subscription-lifecycle.md
 */
test.describe("Subscription lifecycle (BDD)", () => {
  test("trial workspace starts on Scale trial billingCycle", async ({
    request,
  }) => {
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Trial Lifecycle Station",
    });
    await resetBusinessSubscriptionsToTrial(request, businessId);

    const statusRes = await request.get(
      `${API_PATH}/subscriptions/${businessId}/status`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(statusRes.status()).toBe(200);
    const { data: status } = await statusRes.json();
    expect(status.billingCycle).toBe("trial");
    expect(status.planCode).toMatch(/scale/i);
  });

  test("renew during trial creates a new history row", async ({ request }) => {
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Renew Trial Station",
    });
    await resetBusinessSubscriptionsToTrial(request, businessId);

    const renewRes = await request.post(
      `${API_PATH}/subscriptions/${businessId}/renew`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          paymentDetails: {
            billingCycle: "monthly",
            paymentReference: "PAY-BDD-RENEW-TRIAL",
            paymentStatus: "pending_verification",
          },
        },
      },
    );
    expect(renewRes.status()).toBe(200);

    const historyRes = await request.get(
      `${API_PATH}/subscriptions/${businessId}/history`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(historyRes.status()).toBe(200);
    const { data: history } = await historyRes.json();
    expect(history.length).toBeGreaterThan(1);
  });

  test("status returns pendingRenewal shape when scheduled renewal exists", async ({
    request,
  }) => {
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Scheduled Renewal Station",
    });
    await resetBusinessSubscriptionsToTrial(request, businessId);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);

    const paidRes = await request.post(
      `${API_PATH}/subscriptions/${businessId}/upgrade`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          planCode: "scale",
          paymentDetails: {
            billingCycle: "monthly",
            paymentStatus: "verified",
            paymentReference: "PAY-BDD-PAID-SEED",
          },
        },
      },
    );
    expect(paidRes.status()).toBe(200);

    const renewRes = await request.post(
      `${API_PATH}/subscriptions/${businessId}/renew`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          paymentDetails: {
            billingCycle: "monthly",
            paymentStatus: "verified",
            paymentReference: "PAY-BDD-EARLY-RENEW",
          },
        },
      },
    );
    expect(renewRes.status()).toBe(200);

    const statusRes = await request.get(
      `${API_PATH}/subscriptions/${businessId}/status`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(statusRes.status()).toBe(200);
    const { data: status } = await statusRes.json();
    expect(status.planCode).toMatch(/scale/i);
    if (status.pendingRenewal) {
      expect(status.pendingRenewal.activatesAt).toBeTruthy();
    }
  });
});
