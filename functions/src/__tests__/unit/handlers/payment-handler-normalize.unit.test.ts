import { describe, expect, it } from "vitest";
import { normalizePaymentAccountType } from "../../../handlers/payment-handler";

describe("normalizePaymentAccountType", () => {
  it("keeps canonical types", () => {
    expect(normalizePaymentAccountType("bank_transfer")).toBe("bank_transfer");
    expect(normalizePaymentAccountType("digital_wallet")).toBe("digital_wallet");
    expect(normalizePaymentAccountType("credit_card")).toBe("credit_card");
  });

  it("maps legacy Bank labels", () => {
    expect(normalizePaymentAccountType("Bank")).toBe("bank_transfer");
    expect(normalizePaymentAccountType("bank transfer")).toBe("bank_transfer");
  });

  it("infers digital wallets from provider name", () => {
    expect(normalizePaymentAccountType(undefined, "GCASH")).toBe("digital_wallet");
    expect(normalizePaymentAccountType("Bank", "Maya")).toBe("digital_wallet");
  });
});
