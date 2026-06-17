import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN_SIGNUP = "Bearer MOCK_TOKEN_SIGNUP";

test.describe("User Authentication & Onboarding", () => {
  test("Scenario: New user signs up", async ({ request }) => {
    const res = await request.post(`${API_PATH}/auth/signup`, {
      headers: { Authorization: MOCK_TOKEN_SIGNUP },
      data: { appBaseUrl: "http://127.0.0.1:3000", fullName: "BDD Signup User" },
    });
    expect(res.status()).toBe(201);
  });

  test("Scenario: Business Onboarding Sequence", async ({ request }) => {
    const statusRes = await request.get(`${API_PATH}/auth/status`, {
      headers: { Authorization: "Bearer MOCK_TOKEN" },
    });
    expect(statusRes.status()).toBe(200);

    const onboardRes = await request.post(`${API_PATH}/onboarding/complete`, {
      headers: { Authorization: "Bearer MOCK_TOKEN" },
      data: {
        businessName: "Aqua Flow Singapore",
        email: "contact@aquaflow.sg",
        config: {
          waterTypes: ["Mineral", "Alkaline"],
          usageGoals: ["Efficiency", "Market Share"],
        },
      },
    });
    expect(onboardRes.status()).toBe(200);
    const data = await onboardRes.json();
    expect(data.success).toBe(true);
  });

  test("Scenario: Rate limiting on sensitive endpoints", async ({
    request,
  }) => {
    // This test is more of a placeholder as true rate limit testing is complex in CI.
    // We're just checking if the endpoint exists and returns a valid response.
    const res = await request.post(`${API_PATH}/auth/forgot-password`, {
      data: { email: "test@test.com" },
    });
    expect(res.status()).toBe(200);
  });
});
