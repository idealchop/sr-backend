import { isSmartrefillDevMode } from "../../utils/smartrefill-env-mode";
import { MockPaymentProvider } from "./mock-payment-provider";
import { PaymongoPaymentProvider } from "./paymongo-payment-provider";
import type { PaymentProviderAdapter } from "./payment-provider-types";
import type { PaymentProviderId } from "./payment-intent-types";

const mockProvider = new MockPaymentProvider();
const paymongoProvider = new PaymongoPaymentProvider();

export function resolvePaymentProvider(
  preferred?: PaymentProviderId,
): PaymentProviderAdapter {
  if (preferred === "mock") return mockProvider;
  if (preferred === "paymongo") return paymongoProvider;

  const hasPaymongo = Boolean(process.env.PAYMONGO_SECRET_KEY?.trim());
  const emulator = process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.FUNCTIONS_EMULATOR === "1";

  if (emulator || isSmartrefillDevMode() || !hasPaymongo) {
    return mockProvider;
  }
  return paymongoProvider;
}

export function getPaymentProviderById(
  id: PaymentProviderId,
): PaymentProviderAdapter {
  return id === "paymongo" ? paymongoProvider : mockProvider;
}
