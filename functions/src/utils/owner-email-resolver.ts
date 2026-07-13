import { auth } from "../config/firebase-admin";
import { logger } from "firebase-functions";

export async function resolveOwnerEmailForBusiness(
  businessData: Record<string, unknown>,
): Promise<{ email: string; name: string } | null> {
  const businessEmail = String(businessData.email || "").trim();
  const businessName = String(businessData.name || "Station").trim();
  const ownerId = String(businessData.ownerId || "").trim();

  if (businessEmail) {
    return { email: businessEmail, name: businessName };
  }

  if (!ownerId) return null;

  try {
    const user = await auth.getUser(ownerId);
    const email = user.email?.trim();
    if (!email) return null;
    const name = user.displayName?.trim() || businessName;
    return { email, name };
  } catch (error) {
    logger.warn("resolveOwnerEmailForBusiness failed", { ownerId, error });
    return null;
  }
}

/**
 * Owner Auth email only when Firebase `emailVerified` is true.
 * Used for product announcement mail (tutorials) so unverified inboxes are skipped.
 */
export async function resolveVerifiedOwnerEmailForBusiness(
  businessData: Record<string, unknown>,
): Promise<{ email: string; name: string } | null> {
  const businessName = String(businessData.name || "Station").trim();
  const ownerId = String(businessData.ownerId || "").trim();
  if (!ownerId) return null;

  try {
    const user = await auth.getUser(ownerId);
    if (user.emailVerified !== true) return null;
    const email = user.email?.trim();
    if (!email) return null;
    const name = user.displayName?.trim() || businessName;
    return { email, name };
  } catch (error) {
    logger.warn("resolveVerifiedOwnerEmailForBusiness failed", { ownerId, error });
    return null;
  }
}
