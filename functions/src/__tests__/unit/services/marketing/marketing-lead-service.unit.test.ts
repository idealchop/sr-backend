import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDemoMeetEvent: vi.fn(),
  sendTransacEmail: vi.fn(),
  inquiriesAdd: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "inquiries") {
        return { add: mocks.inquiriesAdd };
      }
      return { add: vi.fn() };
    }),
  },
}));

vi.mock("../../../../services/marketing/demo-calendar-service", () => ({
  createDemoMeetEvent: mocks.createDemoMeetEvent,
}));

vi.mock("../../../../utils/brevo", () => ({
  brevo: {
    SendSmtpEmail: class SendSmtpEmail {
      subject?: string;
      htmlContent?: string;
      textContent?: string;
      sender?: unknown;
      to?: unknown;
      cc?: unknown;
      tags?: string[];
      attachment?: unknown;
    },
  },
  getBrevoApi: () => ({
    sendTransacEmail: mocks.sendTransacEmail,
  }),
}));

import { submitRequestDemoLead } from "../../../../services/marketing/marketing-lead-service";
import { resolveDemoSlot } from "../../../../services/marketing/demo-slot";

describe("submitRequestDemoLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FUNCTIONS_EMULATOR;
    const slot = resolveDemoSlot(
      "2026-09-20",
      "14:00",
      new Date("2026-09-10T02:00:00.000Z"),
    );
    mocks.createDemoMeetEvent.mockResolvedValue({
      slot,
      slotLabel: "September 20, 2026, 2:00–3:00 PM (Asia/Manila)",
      eventId: "evt_123",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
    mocks.sendTransacEmail.mockResolvedValue({});
    mocks.inquiriesAdd.mockResolvedValue({ id: "inq_1" });
  });

  it("creates Meet metadata, emails team + inquiree with ICS, persists inquiry", async () => {
    await submitRequestDemoLead({
      name: "Juan dela Cruz",
      email: "juan@business.com",
      phone: "09171234567",
      businessName: "Aqua Pure Station",
      stationCount: "3",
      requestedDate: "2026-09-20",
      requestedTime: "14:00",
    });

    expect(mocks.createDemoMeetEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedDate: "2026-09-20",
        requestedTime: "14:00",
      }),
    );
    expect(mocks.sendTransacEmail).toHaveBeenCalledTimes(2);

    const teamMail = mocks.sendTransacEmail.mock.calls[0][0];
    expect(teamMail.to).toEqual([
      { email: "support@riverph.com", name: "Smart Refill Support" },
    ]);
    expect(teamMail.cc).toEqual(
      expect.arrayContaining([
        { email: "jimboy@smartrefill.io" },
        { email: "wina@riverph.com" },
      ]),
    );
    expect(teamMail.attachment?.[0]?.name).toBe("smart-refill-demo.ics");
    expect(teamMail.tags).toContain("marketing-request-demo");

    const confirmMail = mocks.sendTransacEmail.mock.calls[1][0];
    expect(confirmMail.to).toEqual([
      { email: "juan@business.com", name: "Juan dela Cruz" },
    ]);
    expect(confirmMail.tags).toContain("marketing-request-demo-confirm");
    expect(confirmMail.attachment?.[0]?.name).toBe("smart-refill-demo.ics");

    expect(mocks.inquiriesAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request_demo",
        email: "juan@business.com",
        businessName: "Aqua Pure Station",
        meetLink: "https://meet.google.com/abc-defg-hij",
        calendarEventId: "evt_123",
        demoDurationMinutes: 60,
        demoTimezone: "Asia/Manila",
        demoStartsAt: expect.any(String),
        demoEndsAt: expect.any(String),
      }),
    );
  });
});
