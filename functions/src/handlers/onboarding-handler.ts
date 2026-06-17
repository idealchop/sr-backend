import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../config/firebase-admin";
import { logAuditEvent } from "../services/observability/logging/logger";
import { NotificationService } from "../services/notifications/notification-service";
import {
  DEFAULT_GETTING_STARTED,
  DEFAULT_QUICK_TOUR_PAGE,
} from "../services/business/business-onboarding-defaults";
import { ensureScaleTrialSubscription } from "../services/business/onboarding-scale-trial";
import {
  getOrCreateOwnerBusinessRef,
  resolveExistingOwnerBusinessRef,
} from "../services/business/owner-workspace-resolve";
import { upsertSmartrefillUserProfile } from "../utils/user-profile-sync";

async function markUserOnboardingComplete(
  uid: string,
  email: string | undefined,
  businessId: string,
  idTokenName?: string,
): Promise<void> {
  await upsertSmartrefillUserProfile({
    uid,
    email,
    idTokenName,
    businessId,
    markOwnerOnboardingComplete: true,
  });
}

function buildOnboardingBusinessPayload(
  ownerId: string,
  user: { email?: string },
  body: {
    logo?: string;
    businessName: string;
    email?: string;
    phone?: string;
    location?: unknown;
    config?: {
      waterTypes?: unknown[];
      inventoryItems?: unknown[];
      expenseCategories?: unknown[];
      usageGoals?: unknown[];
    };
  },
  includeDefaults: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    logo: body.logo || "",
    name: body.businessName,
    email: body.email || user.email || "",
    phone: body.phone || "",
    location: body.location || {},
    waterTypes: body.config?.waterTypes || [],
    inventoryCategories: body.config?.inventoryItems || [],
    expenseCategories: body.config?.expenseCategories || [],
    usageGoals: body.config?.usageGoals || [],
    onboardingComplete: true,
    ownerId,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (includeDefaults) {
    payload.quickTourPage = { ...DEFAULT_QUICK_TOUR_PAGE };
    payload.gettingStarted = { ...DEFAULT_GETTING_STARTED };
    payload.createdAt = FieldValue.serverTimestamp();
    payload.workspaceOnboardedAt = FieldValue.serverTimestamp();
  }

  return payload;
}

export const completeOnboarding = async (req: Request, res: Response) => {
  const user = (req as any).user as {
    uid: string;
    email?: string;
    name?: string;
  };
  const { logo, businessName, email, phone, location, config } = req.body;

  if (!businessName) {
    res.status(400).json({ error: "Business name is required" });
    return;
  }

  try {
    let businessRef = await resolveExistingOwnerBusinessRef(user.uid);
    let created = false;

    if (!businessRef) {
      const result = await getOrCreateOwnerBusinessRef({
        uid: user.uid,
        email: user.email,
        name: user.name,
      });
      businessRef = result.ref;
      created = result.created;
    }

    const memberRef = businessRef.collection("members").doc(user.uid);
    const memberSnap = await memberRef.get();
    const existingBusiness = await businessRef.get();
    const batch = db.batch();

    const onboardingPayload = buildOnboardingBusinessPayload(
      user.uid,
      user,
      { logo, businessName, email, phone, location, config },
      created,
    );
    if (!existingBusiness.data()?.workspaceOnboardedAt) {
      onboardingPayload.workspaceOnboardedAt = FieldValue.serverTimestamp();
    }

    batch.set(businessRef, onboardingPayload, { merge: true });

    if (!memberSnap.exists) {
      batch.set(memberRef, {
        userId: user.uid,
        email: user.email || "",
        name: user.name || "Owner",
        role: "owner",
        joinedAt: FieldValue.serverTimestamp(),
      });
    }

    batch.set(
      db.collection("users").doc(user.uid),
      { ownerWorkspaceId: businessRef.id },
      { merge: true },
    );

    await batch.commit();
    await ensureScaleTrialSubscription(businessRef);
    await markUserOnboardingComplete(
      user.uid,
      user.email,
      businessRef.id,
      user.name,
    );

    logAuditEvent("ONBOARDING_COMPLETED", {
      userId: user.uid,
      businessId: businessRef.id,
      resumed: !created,
    });

    if (created) {
      await NotificationService.send({
        userId: user.uid,
        businessId: businessRef.id,
        title: "Onboarding Complete",
        message:
          "Congratulations! Your onboarding is complete and you're ready to use SmartRefill.",
        type: "success",
      });
    }

    logger.info(
      `Onboarding complete for user ${user.uid} (Business: ${businessRef.id}, created=${created})`,
    );
    res.json({ success: true, businessId: businessRef.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error completing onboarding for ${user.uid}:`, error);
    res.status(500).json({ error: "Internal Server Error", details: message });
  }
};
