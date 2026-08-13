import * as brevo from "@getbrevo/brevo";
import { logger } from "firebase-functions";
import {
  applyDevOutboundEmailRedirect,
} from "./outbound-email-safety";
import {
  assertSmartrefillDevNotEnabledInProd,
  isSmartrefillDevMode,
} from "./smartrefill-env-mode";

function resolveBrevoApiKey(): string {
  assertSmartrefillDevNotEnabledInProd("Brevo");

  const apiKey = process.env.SMARTREFILL_BREVO_API_KEY?.trim();
  if (apiKey) {
    return apiKey;
  }

  if (isSmartrefillDevMode()) {
    logger.error(
      "Brevo (dev): SMARTREFILL_BREVO_API_KEY missing. Set it in functions/.env " +
      "while SMARTREFILL_ENV_DEV=true.",
    );
  } else {
    logger.error(
      "Brevo (production): SMARTREFILL_BREVO_API_KEY missing. Define it in Secret Manager " +
      "and list it under onRequest({ secrets: ['SMARTREFILL_BREVO_API_KEY'] }).",
    );
  }
  throw new Error("Brevo API key not configured");
}

/**
 * Authenticated Brevo client.
 *
 * - Dev (`SMARTREFILL_ENV_DEV=true`): key from `.env` → `SMARTREFILL_BREVO_API_KEY`.
 * - Prod: same env var name, value injected from Secret Manager by Firebase Functions.
 * - Local / Dev / emulator: every `sendTransacEmail` is redirected to
 *   `SUPPORT_EMAIL` (default support@riverph.com).
 *
 * @return {brevo.TransactionalEmailsApi} The authenticated Brevo API instance.
 */
export const getBrevoApi = (): brevo.TransactionalEmailsApi => {
  const apiKey = resolveBrevoApiKey();

  const api = new brevo.TransactionalEmailsApi();

  api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  const originalSend = api.sendTransacEmail.bind(api);
  api.sendTransacEmail = ((sendSmtpEmail: brevo.SendSmtpEmail, opts?: unknown) => {
    const redirect = applyDevOutboundEmailRedirect(sendSmtpEmail);
    if (redirect.redirected) {
      logger.info("dev_outbound_email_redirect", {
        sink: redirect.sink,
        originalRecipients: redirect.originalRecipients,
        subject: sendSmtpEmail.subject,
      });
    }
    return originalSend(sendSmtpEmail, opts as never);
  }) as typeof api.sendTransacEmail;

  return api;
};

/** NT-40 — Brevo transactional SMS (same API key as email). */
export const getBrevoSmsApi = (): brevo.TransactionalSMSApi => {
  const apiKey = resolveBrevoApiKey();
  const api = new brevo.TransactionalSMSApi();
  api.setApiKey(brevo.TransactionalSMSApiApiKeys.apiKey, apiKey);
  return api;
};

export { brevo };
