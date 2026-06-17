import { describe, expect, it } from "vitest";
import { parseChannelUsageQuotas } from "../../../utils/channel-usage-plan-limits";
import { buildChannelUsageStatusSnapshot } from "../../../services/channels/channel-usage-service";
import { EMPTY_CHANNEL_COUNTERS } from "../../../utils/channel-usage-types";

describe("channel-usage-plan-limits", () => {
  it("parses starter channel caps as zero (locked)", () => {
    const quotas = parseChannelUsageQuotas({
      messenger: { max: 0, frequency: "monthly" },
      whatsapp: { max: 0, frequency: "monthly" },
      sms: { max: 0, frequency: "monthly" },
      webhooks: { max: 0, frequency: "monthly" },
    });
    expect(quotas?.messenger?.max).toBe(0);
    expect(quotas?.whatsapp?.max).toBe(0);
  });

  it("parses full channels as unlimited", () => {
    const quotas = parseChannelUsageQuotas("full");
    expect(quotas?.messenger?.max).toBeNull();
    expect(quotas?.webhooks?.max).toBeNull();
  });
});

describe("buildChannelUsageStatusSnapshot", () => {
  it("marks channels enabled when any quota is positive or unlimited", () => {
    const quotas = parseChannelUsageQuotas({
      messenger: { max: 25, frequency: "monthly" },
      whatsapp: { max: 25, frequency: "monthly" },
      sms: { max: 50, frequency: "monthly" },
      webhooks: { max: 500, frequency: "monthly" },
    });
    const snapshot = buildChannelUsageStatusSnapshot(quotas, {
      ...EMPTY_CHANNEL_COUNTERS,
      messengerConversations: 3,
    });
    expect(snapshot.channelsEnabled).toBe(true);
    expect(snapshot.messengerUsed).toBe(3);
    expect(snapshot.rows.find((r) => r.key === "messenger")?.enabled).toBe(true);
  });
});
