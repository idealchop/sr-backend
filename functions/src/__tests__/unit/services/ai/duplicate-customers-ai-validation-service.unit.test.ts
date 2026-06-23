import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateDuplicateCustomerGroupsWithAi } from "../../../../services/ai/duplicate-customers-ai-validation-service";
import type { DuplicateGroup } from "../../../../services/ai/duplicate-customers-service";

const geminiGenerateJson = vi.fn();

vi.mock("../../../../services/ai/gemini-client", () => ({
  geminiGenerateJson: (...args: unknown[]) => geminiGenerateJson(...args),
}));

vi.mock("../../../../services/ai/gemini-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../services/ai/gemini-config")>();
  return {
    ...actual,
    getGeminiApiKey: vi.fn(() => "test-key"),
  };
});

function group(
  partial: Partial<DuplicateGroup> & Pick<DuplicateGroup, "customers" | "reason">,
): DuplicateGroup {
  return {
    customers: partial.customers,
    reason: partial.reason,
  };
}

describe("validateDuplicateCustomerGroupsWithAi", () => {
  beforeEach(() => {
    geminiGenerateJson.mockReset();
  });

  it("filters confident false positives", async () => {
    const input = [
      group({
        reason: "Same phone",
        customers: [
          { id: "a", name: "Juan Dela Cruz", phone: "09171234567" },
          { id: "b", name: "Maria Santos", phone: "09171234567" },
        ],
      }),
      group({
        reason: "Name 82% match",
        customers: [
          { id: "c", name: "Hey Lucky Cafe", phone: "09170000001" },
          { id: "d", name: "Hey Lucky Kafe", phone: "09170000002" },
        ],
      }),
    ];

    geminiGenerateJson.mockResolvedValue({
      groups: [
        {
          groupIndex: 0,
          isLikelyDuplicate: false,
          confidencePercent: 78,
          summary: "Different people sharing a family phone.",
          recommendedPrimaryId: "a",
        },
        {
          groupIndex: 1,
          isLikelyDuplicate: true,
          confidencePercent: 91,
          summary: "Same cafe with a spelling variant.",
          recommendedPrimaryId: "c",
        },
      ],
    });

    const result = await validateDuplicateCustomerGroupsWithAi(input);

    expect(result).toHaveLength(1);
    expect(result[0].customers[0].id).toBe("c");
    expect(result[0].aiValidation?.summary).toContain("spelling variant");
  });

  it("keeps heuristic groups when Gemini is unavailable", async () => {
    geminiGenerateJson.mockImplementation(async ({ fallback }) => fallback);

    const input = [
      group({
        reason: "Same email",
        customers: [
          { id: "a", name: "Store A", email: "shop@example.com" },
          { id: "b", name: "Store B", email: "shop@example.com" },
        ],
      }),
    ];

    const result = await validateDuplicateCustomerGroupsWithAi(input);

    expect(result).toHaveLength(1);
    expect(result[0].aiValidation?.isLikelyDuplicate).toBe(true);
  });
});
