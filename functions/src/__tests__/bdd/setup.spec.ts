import { test, expect } from "@playwright/test";
import { API_PATH, MOCK_TOKEN, ensureOwnerWorkspace } from "./bdd-api";

test("Global Setup: Grant workspace access for primary BDD user", async ({
  request,
}) => {
  const signupRes = await request.post(`${API_PATH}/auth/signup`, {
    headers: { Authorization: MOCK_TOKEN },
    data: { appBaseUrl: "http://127.0.0.1:3000", fullName: "BDD Tester" },
  });
  expect([201, 409]).toContain(signupRes.status());
});

test("Global Setup: Seed test business", async ({ request }) => {
  const { businessId } = await ensureOwnerWorkspace(request);
  console.log(`OWNER WORKSPACE ID: ${businessId}`);
});
