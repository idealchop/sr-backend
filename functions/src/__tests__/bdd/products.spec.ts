import { test, expect } from "@playwright/test";

const API_PATH =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";
const MOCK_TOKEN = "Bearer MOCK_TOKEN";

test.describe("Delivery products catalog (BDD)", () => {
  test("Scenario: Owner creates and updates a product", async ({ request }) => {
    const createRes = await request.post(`${API_PATH}/products/test-id`, {
      headers: { Authorization: MOCK_TOKEN },
      data: {
        name: "Alkaline Round",
        unitPrice: 35,
        active: true,
        showInCustomerOrder: true,
        iconId: "round-gallon",
        components: [],
      },
    });
    expect(createRes.status()).toBe(201);
    const createData = await createRes.json();
    const productId = createData.productId as string;
    expect(productId).toBeDefined();

    const getRes = await request.get(
      `${API_PATH}/products/test-id/${productId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    expect(getRes.status()).toBe(200);
    const getData = await getRes.json();
    expect(getData.data?.id || getData.id).toBe(productId);

    const patchRes = await request.patch(
      `${API_PATH}/products/test-id/${productId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { showInCustomerOrder: false, active: true },
      },
    );
    expect(patchRes.status()).toBe(200);

    const listRes = await request.get(`${API_PATH}/products/test-id`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.data.some((item: { id: string }) => item.id === productId)).toBe(
      true,
    );

    const defaultRes = await request.patch(
      `${API_PATH}/products/test-id/${productId}`,
      {
        headers: { Authorization: MOCK_TOKEN },
        data: { defaultForOrder: true },
      },
    );
    expect(defaultRes.status()).toBe(200);
    const afterDefault = await request.get(
      `${API_PATH}/products/test-id/${productId}`,
      { headers: { Authorization: MOCK_TOKEN } },
    );
    const afterDefaultData = await afterDefault.json();
    expect(afterDefaultData.data?.defaultForOrder || afterDefaultData.defaultForOrder).toBe(
      true,
    );
  });

  test("Scenario: Public product icons are readable without auth", async ({
    request,
  }) => {
    const res = await request.get(`${API_PATH}/public/product-icons`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("Scenario: Unauthorized access to products", async ({ request }) => {
    const res = await request.get(`${API_PATH}/products/foreign-biz-id`, {
      headers: { Authorization: MOCK_TOKEN },
    });
    expect(res.status()).toBe(403);
  });
});
