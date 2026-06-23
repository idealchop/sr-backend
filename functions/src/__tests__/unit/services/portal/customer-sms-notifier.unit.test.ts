import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertWithinCap, recordUsage } = vi.hoisted(() => ({
  assertWithinCap: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("firebase-functions", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../../utils/brevo", () => ({
  brevo: { SendTransacSms: { TypeEnum: { Transactional: "transactional" } } },
  getBrevoSmsApi: vi.fn(),
}));

vi.mock("../../../../services/channels/channel-usage-service", () => ({
  ChannelUsageLimitError: class ChannelUsageLimitError extends Error {
    code = "CHANNEL_USAGE_LIMIT_EXCEEDED";
    constructor(
      message: string,
      public readonly metric: string,
      public readonly used: number,
      public readonly cap: number,
    ) {
      super(message);
    }
  },
  ChannelUsageService: {
    assertWithinCap,
    recordUsage,
  },
}));

import { getBrevoSmsApi } from "../../../../utils/brevo";
import { ChannelUsageLimitError } from "../../../../services/channels/channel-usage-service";
import { maybeSendCustomerTxnSms } from "../../../../services/portal/customer-sms-notifier";

describe("customer-sms-notifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FUNCTIONS_EMULATOR;
    process.env.SMARTREFILL_SMS_ENABLED = "true";
    assertWithinCap.mockResolvedValue(undefined);
    recordUsage.mockResolvedValue(undefined);
  });

  it("blocks send when SMS quota is exceeded", async () => {
    assertWithinCap.mockRejectedValue(
      new ChannelUsageLimitError("cap", "smsSegments", 50, 50),
    );

    const sendTransacSms = vi.fn();
    vi.mocked(getBrevoSmsApi).mockReturnValue({ sendTransacSms } as never);

    const result = await maybeSendCustomerTxnSms({
      businessId: "biz1",
      customer: { phone: "09171234567" } as never,
      referenceId: "TX-1",
      statusLabel: "Completed",
      trackUrl: "https://example.com/order",
    });

    expect(result.sent).toBe(false);
    expect(sendTransacSms).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
