import { expect, type APIRequestContext } from "@playwright/test";

export const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";

export const MOCK_TOKEN = "Bearer MOCK_TOKEN";

/** Seeded in seed-emulator.js for the primary BDD user (user123). */
export const SEEDED_BUSINESS_ID = "test-id";

export type OwnerWorkspaceResult = {
  businessId: string;
  status: number;
  alreadyExists?: boolean;
};

/**
 * Ensures the mock owner has a workspace. Accepts 201 (created) or 200 (idempotent).
 * @param {APIRequestContext} request - The API Request context
 * @param {Object} data - Business data
 * @return {Promise<OwnerWorkspaceResult>} The owner workspace
 */
export async function ensureOwnerWorkspace(
  request: APIRequestContext,
  data: { name: string; email?: string } = {
    name: "Test Business",
    email: "test@business.com",
  },
): Promise<OwnerWorkspaceResult> {
  const res = await request.post(`${API_PATH}/business/create`, {
    headers: { Authorization: MOCK_TOKEN },
    data,
  });

  expect([200, 201]).toContain(res.status());

  const body = await res.json();
  expect(body.businessId).toBeDefined();

  return {
    businessId: body.businessId as string,
    status: res.status(),
    alreadyExists: body.alreadyExists as boolean | undefined,
  };
}

/**
 * Emulator-only: clears subscription rows and seeds one Scale trial (BDD isolation).
 * @param {APIRequestContext} request Playwright API context.
 * @param {string} businessId Target business.
 */
export async function resetBusinessSubscriptionsToTrial(
  request: APIRequestContext,
  businessId: string,
): Promise<void> {
  const res = await request.post(
    `${API_PATH}/subscriptions/${businessId}/dev/reset-trial`,
    { headers: { Authorization: MOCK_TOKEN } },
  );
  expect(res.status()).toBe(200);
}
