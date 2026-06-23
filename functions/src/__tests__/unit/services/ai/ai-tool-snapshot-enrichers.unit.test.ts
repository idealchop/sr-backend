import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildPaymentReminderScripts,
  buildWaterQualityAnomalyFacts,
} from "../../../../services/ai/ai-tool-snapshot-enrichers";
import { WaterQualityLogService } from "../../../../services/plant/water-quality-log-service";

vi.mock("../../../../services/plant/water-quality-log-service", () => ({
  WaterQualityLogService: {
    list: vi.fn(),
  },
}));

describe("ai-tool-snapshot-enrichers", () => {
  beforeEach(() => {
    vi.mocked(WaterQualityLogService.list).mockReset();
  });

  describe("buildPaymentReminderScripts (AI-02)", () => {
    it("builds Taglish scripts from reminder queues", () => {
      const scripts = buildPaymentReminderScripts({
        reminderQueue90: [
          { name: "Ana Cruz", amountPhp: 450, oldestDebtDays: 95, reminderTier: 90 },
        ],
        reminderQueue30: [
          { name: "Ben Santos", amountPhp: 120, oldestDebtDays: 32, reminderTier: 30 },
        ],
      });

      expect(scripts).toHaveLength(2);
      const ana = scripts.find((r) => r.name === "Ana Cruz");
      const ben = scripts.find((r) => r.name === "Ben Santos");
      expect(ana?.reminderTier).toBe(90);
      expect(ana?.suggestedScript).toContain("Ana Cruz");
      expect(ana?.suggestedScript?.length).toBeLessThanOrEqual(280);
      expect(ben?.suggestedScript).toContain("Friendly reminder");
    });

    it("returns empty when queues missing", () => {
      expect(buildPaymentReminderScripts({})).toEqual([]);
    });
  });

  describe("buildWaterQualityAnomalyFacts (AI-06)", () => {
    it("flags TDS spike and includes customer comms draft", async () => {
      vi.mocked(WaterQualityLogService.list).mockResolvedValue([
        {
          id: "l1",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 40,
          pass: true,
          loggedAt: "2026-06-20T08:00:00+08:00",
        },
        {
          id: "l2",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 20,
          pass: true,
          loggedAt: "2026-06-19T08:00:00+08:00",
        },
        {
          id: "l3",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 18,
          pass: true,
          loggedAt: "2026-06-18T08:00:00+08:00",
        },
      ]);

      const facts = await buildWaterQualityAnomalyFacts("b1");
      expect(facts?.anomalyActive).toBe(true);
      expect(facts?.customerCommsDraft).toContain("TDS");
      expect(Array.isArray(facts?.suggestedActions)).toBe(true);
    });

    it("returns inactive when sample too small", async () => {
      vi.mocked(WaterQualityLogService.list).mockResolvedValue([
        {
          id: "l1",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 12,
          pass: true,
          loggedAt: "2026-06-20T08:00:00+08:00",
        },
      ]);

      expect(await buildWaterQualityAnomalyFacts("b1")).toBeNull();
    });

    it("flags failed reading without TDS spike", async () => {
      vi.mocked(WaterQualityLogService.list).mockResolvedValue([
        {
          id: "l1",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 12,
          pass: false,
          loggedAt: "2026-06-20T08:00:00+08:00",
        },
        {
          id: "l2",
          businessId: "b1",
          locationTag: "product",
          tdsPpm: 11,
          pass: true,
          loggedAt: "2026-06-19T08:00:00+08:00",
        },
      ]);

      const facts = await buildWaterQualityAnomalyFacts("b1");
      expect(facts?.anomalyActive).toBe(true);
      expect(facts?.customerCommsDraft).toContain("maintenance");
    });
  });
});
