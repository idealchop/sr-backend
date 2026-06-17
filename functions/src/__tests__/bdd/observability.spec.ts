import { test, expect } from "@playwright/test";
import { API_PATH, MOCK_TOKEN, ensureOwnerWorkspace } from "./bdd-api";

test.describe("Observability & Engagement (BDD)", () => {
  test("Scenario: User manages notifications and views audit trail", async ({
    request,
  }) => {
    // 1. Resolve owner workspace (idempotent when emulator is seeded)
    const { businessId } = await ensureOwnerWorkspace(request, {
      name: "Audit Station",
      email: "audit@test.com",
    });

    // Touch profile so idempotent create still yields notification + audit activity
    const touchRes = await request.put(`${API_PATH}/business/${businessId}`, {
      headers: { Authorization: MOCK_TOKEN },
      data: { name: "Audit Station" },
    });
    expect(touchRes.status()).toBe(200);

    // 2. Fetch Notifications (Requires businessId)
    const notifyRes = await request.get(
      `${API_PATH}/notifications?businessId=${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(notifyRes.status()).toBe(200);
    const { data: notifications } = await notifyRes.json();
    expect(notifications.length).toBeGreaterThan(0);

    // 3. Mark a notification as read
    if (notifications.length > 0) {
      const notificationId = notifications[0].id;
      const readRes = await request.put(`${API_PATH}/notifications/read`, {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          notificationIds: [notificationId],
          businessId,
        },
      });
      expect(readRes.status()).toBe(200);
    }

    // 4. Fetch Audit Trail
    const auditRes = await request.get(
      `${API_PATH}/audit/business/${businessId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    expect(auditRes.status()).toBe(200);
    const { data: logs } = await auditRes.json();

    const hasBusinessAudit = logs.some(
      (l: { message?: string }) =>
        l.message &&
        (l.message.includes("AUDIT: BUSINESS_CREATED") ||
          l.message.includes("AUDIT: BUSINESS_UPDATED")),
    );

    expect(
      hasBusinessAudit,
      `Expected business audit log but found: ${JSON.stringify(logs, null, 2)}`,
    ).toBe(true);
  });

  test("Scenario: Bulk mark notifications as read", async ({ request }) => {
    // 1. Fetch notifications
    const notifyRes = await request.get(
      `${API_PATH}/notifications?businessId=test-id`,
      {
        headers: { Authorization: MOCK_TOKEN },
      },
    );
    const { data: notifications } = await notifyRes.json();

    if (notifications.length > 0) {
      const ids = notifications.map((n: any) => n.id);
      const readRes = await request.put(`${API_PATH}/notifications/read`, {
        headers: { Authorization: MOCK_TOKEN },
        data: {
          notificationIds: ids,
          businessId: "test-id",
        },
      });

      expect(readRes.status()).toBe(200);
      const bulkData = await readRes.json();
      expect(bulkData.success).toBe(true);
    }
  });
});
