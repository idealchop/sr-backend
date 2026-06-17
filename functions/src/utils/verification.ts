import { logger } from "firebase-functions";
import { auth } from "../config/firebase-admin";
import { brevo, getBrevoApi } from "./brevo"; import {
  getEmailVerificationEmail,
  getPasswordResetEmail,
} from "./auth-transactional-email";
import { toAppAuthActionLink } from "./auth-action-links";
import {
  resolveStaffVerificationContext,
  resolveVerificationAudience,
  verificationPathForAudience,
  type VerificationAudience,
} from "./resolve-verification-audience";
import { resolveAppBaseUrlForEmail } from "./app-base-url";

export interface SendVerificationEmailOptions {
  /** Dashboard origin from the active frontend session. */
  appBaseUrl?: string;
  /** @deprecated Use `appBaseUrl`. */
  baseUrl?: string;
  audience?: VerificationAudience;
  uid?: string;
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * Generates an email verification link and sends it via Brevo smtp.
 */
export async function sendVerificationEmail(
  email: string,
  name: string,
  options?: SendVerificationEmailOptions | string,
): Promise<void> {
  try {
    const opts: SendVerificationEmailOptions =
      typeof options === "string" ? { appBaseUrl: options } : (options ?? {});
    const finalBaseUrl = resolveAppBaseUrlForEmail(
      opts.appBaseUrl ?? opts.baseUrl,
    );

    let audience: VerificationAudience = opts.audience ?? "owner";
    if (!opts.audience && opts.uid) {
      audience = await resolveVerificationAudience(opts.uid);
    }

    const verifyPath = verificationPathForAudience(audience);
    const continueQuery = `email=${encodeURIComponent(email)}`;
    const actionCodeSettings = {
      url: `${finalBaseUrl}${verifyPath}?${continueQuery}`,
      handleCodeInApp: true,
    };

    if (process.env.FUNCTIONS_EMULATOR) {
      logger.info(`EMULATOR: Bypassing real email for ${email}`, { audience });
      return;
    }

    const firebaseVerificationLink = await auth.generateEmailVerificationLink(
      email,
      actionCodeSettings,
    );
    const verificationLink = toAppAuthActionLink(
      firebaseVerificationLink,
      `${verifyPath}?${continueQuery}`,
      finalBaseUrl,
    );

    const staffContext =
      audience === "staff" && opts.uid ?
        await resolveStaffVerificationContext(opts.uid) :
        {};

    const api = getBrevoApi();
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    const template = getEmailVerificationEmail({
      displayName: name || "User",
      email,
      verificationLink,
      audience,
      workspaceName: staffContext.workspaceName,
      memberRole: staffContext.memberRole,
    });

    sendSmtpEmail.subject = template.subject;
    sendSmtpEmail.htmlContent = template.html;
    sendSmtpEmail.textContent = template.text;
    sendSmtpEmail.sender = {
      name: "Smart Refill",
      email: "no-reply@smartrefill.io",
    };
    sendSmtpEmail.to = [{ email, name: name || "User" }];
    sendSmtpEmail.tags = [template.brevoTag];

    await api.sendTransacEmail(sendSmtpEmail);
    logger.info(`Verification email sent to ${email}`);
  } catch (error) {
    logger.error(`Failed to send verification email to ${email}:`, error);
    throw error;
  }
}

/**
 * Generates a password reset link and sends it via Brevo smtp.
 * @param {string} email The recipient's email address.
 * @param {string} [appBaseUrl] Dashboard origin from the active frontend session.
 * @return {Promise<void>}
 */
export async function sendForgotPasswordEmail(
  email: string,
  appBaseUrl?: string,
): Promise<void> {
  try {
    const finalBaseUrl = resolveAppBaseUrlForEmail(appBaseUrl);
    const actionCodeSettings = {
      url: `${finalBaseUrl}/reset-password`,
      handleCodeInApp: true,
    };

    if (process.env.FUNCTIONS_EMULATOR) {
      logger.info(`EMULATOR: Bypassing password reset email for ${email}`);
      return;
    }

    const firebaseResetLink = await auth.generatePasswordResetLink(
      email,
      actionCodeSettings,
    );
    const resetLink = toAppAuthActionLink(
      firebaseResetLink,
      "/reset-password",
      finalBaseUrl,
    );

    // Get user details for the template
    const userRecord = await auth.getUserByEmail(email);
    const name = userRecord.displayName || "User";

    const api = getBrevoApi();
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    const template = getPasswordResetEmail({
      displayName: name,
      email,
      resetLink,
    });

    sendSmtpEmail.subject = template.subject;
    sendSmtpEmail.htmlContent = template.html;
    sendSmtpEmail.textContent = template.text;
    sendSmtpEmail.sender = {
      name: "Smart Refill",
      email: "no-reply@smartrefill.io",
    };
    sendSmtpEmail.to = [{ email, name }];
    sendSmtpEmail.tags = [template.brevoTag];

    await api.sendTransacEmail(sendSmtpEmail);
    logger.info(`Password reset email sent to ${email}`);
  } catch (error) {
    logger.error(`Failed to send password reset email to ${email}:`, error);
    throw error;
  }
}
