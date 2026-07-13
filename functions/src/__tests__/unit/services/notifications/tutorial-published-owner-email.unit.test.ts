import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getUser = vi.fn();
const sendTransacEmail = vi.fn().mockResolvedValue({});

vi.mock("../../../../config/firebase-admin", () => ({
  auth: {
    getUser: (...args: unknown[]) => getUser(...args),
  },
}));

vi.mock("../../../../utils/brevo", () => ({
  brevo: {
    SendSmtpEmail: class {
      sender?: unknown;
      to?: unknown;
      subject?: string;
      htmlContent?: string;
      textContent?: string;
      tags?: string[];
    },
  },
  getBrevoApi: () => ({
    sendTransacEmail: (...args: unknown[]) => sendTransacEmail(...args),
  }),
}));

vi.mock("../../../../utils/app-base-url", () => ({
  resolveAppBaseUrlForEmail: () => "https://app.smartrefill.io",
}));

import { sendTutorialPublishedOwnerEmail } from "../../../../services/notifications/tutorial-published-owner-email-service";

describe("sendTutorialPublishedOwnerEmail", () => {
  const prevEmulator = process.env.FUNCTIONS_EMULATOR;

  beforeEach(() => {
    getUser.mockReset();
    sendTransacEmail.mockClear();
    delete process.env.FUNCTIONS_EMULATOR;
  });

  afterEach(() => {
    if (prevEmulator === undefined) {
      delete process.env.FUNCTIONS_EMULATOR;
    } else {
      process.env.FUNCTIONS_EMULATOR = prevEmulator;
    }
  });

  it("sends Brevo mail only when Auth emailVerified is true", async () => {
    getUser.mockResolvedValue({
      email: "owner@example.com",
      emailVerified: true,
      displayName: "Ana",
    });

    await expect(
      sendTutorialPublishedOwnerEmail({
        businessId: "biz-1",
        businessData: { ownerId: "owner-1", name: "River Station" },
        tutorialName: "How to add a delivery",
        videoId: "vid-1",
      }),
    ).resolves.toBe(true);

    expect(sendTransacEmail).toHaveBeenCalledTimes(1);
    const payload = sendTransacEmail.mock.calls[0]?.[0] as {
      subject?: string;
      to?: Array<{ email: string }>;
      tags?: string[];
    };
    expect(payload.subject).toBe("New tutorial: How to add a delivery");
    expect(payload.to?.[0]?.email).toBe("owner@example.com");
    expect(payload.tags).toContain("tutorial_published_owner_email");
  });

  it("skips email when Auth email is unverified", async () => {
    getUser.mockResolvedValue({
      email: "owner@example.com",
      emailVerified: false,
      displayName: "Ana",
    });

    await expect(
      sendTutorialPublishedOwnerEmail({
        businessId: "biz-1",
        businessData: { ownerId: "owner-1", name: "River Station" },
        tutorialName: "How to add a delivery",
        videoId: "vid-1",
      }),
    ).resolves.toBe(false);

    expect(sendTransacEmail).not.toHaveBeenCalled();
  });

  it("logs only in emulator even when verified", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    getUser.mockResolvedValue({
      email: "owner@example.com",
      emailVerified: true,
      displayName: "Ana",
    });

    await expect(
      sendTutorialPublishedOwnerEmail({
        businessId: "biz-1",
        businessData: { ownerId: "owner-1", name: "River Station" },
        tutorialName: "How to add a delivery",
        videoId: "vid-1",
      }),
    ).resolves.toBe(true);

    expect(sendTransacEmail).not.toHaveBeenCalled();
  });
});
