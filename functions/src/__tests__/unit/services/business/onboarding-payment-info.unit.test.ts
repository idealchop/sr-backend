import { describe, expect, it } from "vitest";
import { parseOnboardingPaymentAccounts } from "../../../../services/business/onboarding-payment-info";

describe("parseOnboardingPaymentAccounts", () => {
  it("returns empty for missing or invalid payloads", () => {
    expect(parseOnboardingPaymentAccounts(undefined)).toEqual([]);
    expect(parseOnboardingPaymentAccounts("GCash")).toEqual([]);
    expect(parseOnboardingPaymentAccounts([null, 12])).toEqual([]);
  });

  it("skips blank suggested rows", () => {
    expect(
      parseOnboardingPaymentAccounts([
        {
          bankName: "GCash",
          accountName: "  ",
          accountNumber: "",
          type: "digital_wallet",
        },
        {
          bankName: "  ",
          accountName: "Juan",
          accountNumber: "1",
          type: "bank_transfer",
        },
      ]),
    ).toEqual([]);
  });

  it("normalizes wallets and marks the first complete account primary", () => {
    expect(
      parseOnboardingPaymentAccounts([
        {
          bankName: "  GCash  ",
          accountName: "Maria",
          accountNumber: "0917",
          type: "Bank",
        },
        {
          bankName: "BDO",
          accountName: "Station",
          accountNumber: "0001",
          type: "bank_transfer",
          isPrimary: true,
        },
      ]),
    ).toEqual([
      {
        bankName: "GCash",
        accountName: "Maria",
        accountNumber: "0917",
        type: "digital_wallet",
        isPrimary: false,
        qrCode: "",
      },
      {
        bankName: "BDO",
        accountName: "Station",
        accountNumber: "0001",
        type: "bank_transfer",
        isPrimary: true,
        qrCode: "",
      },
    ]);
  });

  it("keeps https QR codes and drops data URLs", () => {
    const parsed = parseOnboardingPaymentAccounts([
      {
        bankName: "GCash",
        accountName: "Maria",
        accountNumber: "0917",
        type: "digital_wallet",
        qrCode: "data:image/png;base64,abc",
      },
      {
        bankName: "BDO",
        accountName: "Station",
        accountNumber: "0001",
        type: "bank_transfer",
        qrCode: "https://cdn.example/qr.png",
        isPrimary: true,
      },
    ]);
    expect(parsed[0].qrCode).toBe("");
    expect(parsed[1].qrCode).toBe("https://cdn.example/qr.png");
  });

  it("sets primary on the first row when none is flagged", () => {
    const parsed = parseOnboardingPaymentAccounts([
      { bankName: "Maya", accountNumber: "09", type: "digital_wallet" },
    ]);
    expect(parsed).toEqual([
      {
        bankName: "Maya",
        accountName: "",
        accountNumber: "09",
        type: "digital_wallet",
        isPrimary: true,
        qrCode: "",
      },
    ]);
  });
});
