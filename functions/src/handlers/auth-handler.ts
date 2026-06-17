import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { db, FieldValue, auth } from "../config/firebase-admin";
import { writeUserLoginEvent } from "../services/auth/session-activity-service";
import { logAuditEvent } from "../services/observability/logging/logger";
import {
  isWorkspaceMemberLoginAllowed,
  mergeGrantedSmartrefillAppAccess,
  WORKSPACE_ACCESS_REVOKED_MESSAGE,
} from "../services/team/workspace-member-access";
import {
  hasSmartrefillAccessForEmail,
  normalizeUserEmail,
  resolveSmartrefillAccessForUser,
} from "../utils/smartrefill-app-access";
import { parseAppBaseUrlFromBody } from "../utils/app-base-url";
import { upsertSmartrefillUserProfile } from "../utils/user-profile-sync";
import {
  sendVerificationEmail,
  sendForgotPasswordEmail,
} from "../utils/verification";

/**
 * Handles password reset requests.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  const appBaseUrl = parseAppBaseUrlFromBody(req.body);

  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    await sendForgotPasswordEmail(email, appBaseUrl);
    res.json({ success: true, message: "Password reset email sent" });
  } catch (error: unknown) {
    logger.error(`Failed to send password reset for ${email}:`, error);
    const code =
      error && typeof error === "object" && "code" in error ?
        String((error as { code?: string }).code) :
        "";
    // Always return success to avoid account enumeration (legacy parity).
    if (code === "auth/user-not-found" || code === "auth/invalid-email") {
      res.json({
        success: true,
        message: "If an account exists, a reset link has been sent",
      });
      return;
    }
    res.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
    });
  }
};

function resolveDefaultPath(
  memberRole: string,
  onboardingComplete: boolean,
): string {
  if (memberRole === "owner") {
    return onboardingComplete ? "/dashboard" : "/onboarding";
  }
  if (memberRole === "admin") {
    if (!onboardingComplete) return "/staff-onboarding";
    return "/transactions";
  }
  if (memberRole === "rider" || memberRole === "staff") {
    if (!onboardingComplete) return "/staff-onboarding";
    return "/my-area";
  }
  return onboardingComplete ? "/dashboard" : "/onboarding";
}

async function resolveStaffWorkspaceMemberRef(
  uid: string,
  userData?: FirebaseFirestore.DocumentData,
): Promise<FirebaseFirestore.DocumentReference | null> {
  const appAccess = (userData?.appAccess || []) as Array<{
    appId?: string;
    businessId?: string;
  }>;
  const smartRefillAccess = appAccess.find((a) => a.appId === "smartrefill");
  let businessId = (smartRefillAccess?.businessId as string) || null;

  if (!businessId) {
    const ownedSnap = await db
      .collection("businesses")
      .where("ownerId", "==", uid)
      .limit(1)
      .get();
    if (!ownedSnap.empty) {
      businessId = ownedSnap.docs[0].id;
    }
  }

  if (!businessId) return null;

  return db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(uid);
}

export const getWorkspaceProfile = async (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    const userRef = db.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : undefined;
    const memberRef = await resolveStaffWorkspaceMemberRef(user.uid, userData);
    let memberData: FirebaseFirestore.DocumentData | undefined;
    if (memberRef) {
      const memberSnap = await memberRef.get();
      memberData = memberSnap.exists ? memberSnap.data() : undefined;
    }

    const displayName =
      String(memberData?.displayName || memberData?.name || "").trim() ||
      String(userData?.displayName || user.displayName || "").trim() ||
      String(user.email || "").split("@")[0] ||
      "Team member";
    const phone = String(memberData?.phone || userData?.phone || "").trim();
    const photoURL = String(
      memberData?.photoURL || userData?.photoURL || user.photoURL || "",
    ).trim();

    res.json({
      data: {
        displayName,
        phone,
        photoURL,
        role: String(memberData?.role || "staff"),
      },
    });
  } catch (error: any) {
    logger.error(`Failed to load workspace profile for ${user.uid}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getAuthStatus = async (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    logger.info(`Checking onboarding status for user: ${user.uid}`);

    const userDoc = await db.collection("users").doc(user.uid).get();
    let onboardingComplete = false;
    let memberRole = "owner";
    let businessId: string | null = null;
    let smartRefillAccess:
      | {
        onboardingComplete?: boolean;
        staffOnboardingComplete?: boolean;
        role?: string;
        businessId?: string;
      }
      | undefined;

    if (userDoc.exists) {
      const userData = userDoc.data();
      const appAccess = userData?.appAccess || [];
      smartRefillAccess = appAccess.find(
        (a: { appId?: string }) => a.appId === "smartrefill",
      ) as typeof smartRefillAccess | undefined;

      if (smartRefillAccess) {
        onboardingComplete = !!smartRefillAccess.onboardingComplete;
        businessId = (smartRefillAccess.businessId as string) || null;
        // Legacy appAccess: `staffOnboardingComplete` true means full staff onboarding.
        if (
          smartRefillAccess.staffOnboardingComplete === true &&
          !smartRefillAccess.onboardingComplete
        ) {
          onboardingComplete = true;
        }
        logger.info(
          `Onboarding status for ${user.uid} (appAccess): ${onboardingComplete}`,
        );
      } else {
        logger.info(
          `No 'smartrefill' appAccess found for ${user.uid}. Defaulting to incomplete.`,
        );
      }
    } else {
      logger.info(
        `User document not found for ${user.uid}. Forcing onboarding.`,
      );
    }

    const ownedSnap = await db
      .collection("businesses")
      .where("ownerId", "==", user.uid)
      .limit(1)
      .get();

    let activeWorkspaceMember = false;

    if (businessId) {
      const businessRef = db.collection("businesses").doc(businessId);
      const [bizSnap, memberSnap] = await Promise.all([
        businessRef.get(),
        businessRef.collection("members").doc(user.uid).get(),
      ]);
      const bizData = bizSnap.exists ? bizSnap.data() : null;
      const isOwnerOfWorkspace = bizData?.ownerId === user.uid;

      if (isOwnerOfWorkspace) {
        memberRole = "owner";
        onboardingComplete =
          onboardingComplete || bizData?.onboardingComplete === true;
      } else if (memberSnap.exists) {
        memberRole = (memberSnap.data()?.role as string) || "rider";
        activeWorkspaceMember = memberSnap.data()?.isActive !== false;
      } else {
        const ar = smartRefillAccess?.role as string | undefined;
        memberRole = ar === "owner" ? "owner" : "rider";
      }
    } else {
      if (ownedSnap.empty && memberRole === "owner" && !businessId) {
        onboardingComplete = false;
      } else if (!ownedSnap.empty) {
        memberRole = "owner";
        businessId = ownedSnap.docs[0].id;
        onboardingComplete =
          onboardingComplete ||
          ownedSnap.docs[0].data()?.onboardingComplete === true;
      }
    }

    const accessMarkedRevoked =
      smartRefillAccess &&
      (smartRefillAccess as { accessRevoked?: boolean }).accessRevoked === true;

    if (accessMarkedRevoked && !activeWorkspaceMember) {
      res.json({
        data: {
          onboardingComplete: false,
          memberRole,
          businessId,
          defaultPath: "/login",
          workspaceAccessBlocked: true,
          workspaceAccessMessage: WORKSPACE_ACCESS_REVOKED_MESSAGE,
          workspaceAccessCode: "WORKSPACE_ACCESS_REVOKED",
        },
      });
      return;
    }

    if (accessMarkedRevoked && activeWorkspaceMember && businessId) {
      void db
        .collection("users")
        .doc(user.uid)
        .update({
          appAccess: mergeGrantedSmartrefillAppAccess(
            userDoc.data()?.appAccess,
            { businessId, role: "staff" },
          ),
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch((err) => {
          logger.warn("Failed to heal stale revoked appAccess flag", {
            uid: user.uid,
            businessId,
            err: String(err),
          });
        });
    }

    if (businessId && memberRole !== "owner") {
      const access = await isWorkspaceMemberLoginAllowed(businessId, user.uid);
      if (!access.allowed) {
        res.json({
          data: {
            onboardingComplete: false,
            memberRole,
            businessId,
            defaultPath: "/login",
            workspaceAccessBlocked: true,
            workspaceAccessMessage: access.message,
            workspaceAccessCode: access.code,
          },
        });
        return;
      }
    }

    const defaultPath = resolveDefaultPath(memberRole, onboardingComplete);

    res.json({
      data: {
        onboardingComplete,
        memberRole,
        businessId,
        defaultPath,
      },
    });
  } catch (error: any) {
    logger.error(`Error in /auth/status for ${user.uid}:`, {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
      details: "Check function logs for full stack trace",
    });
  }
};

export const getRegistrationStatus = async (req: Request, res: Response) => {
  const user = (req as { user?: { uid: string; email?: string } }).user;
  if (!user?.uid || !user.email) {
    res.status(400).json({ error: "Authenticated user email is required" });
    return;
  }

  try {
    const access = await resolveSmartrefillAccessForUser(user.uid, user.email);
    res.json({
      data: {
        hasFirestoreDoc: access.hasFirestoreDoc,
        hasSmartrefillAccess: access.hasSmartrefillAccess,
        canRegisterSmartrefill: !access.hasSmartrefillAccess,
      },
    });
  } catch (error: unknown) {
    logger.error("getRegistrationStatus failed", error);
    res.status(500).json({ error: "Failed to read registration status" });
  }
};

/**
 * Pre-auth hint: Firebase Auth may already have this email; Smart Refill access is Firestore-only.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const postRegistrationPreview = async (req: Request, res: Response) => {
  const rawEmail = (req.body as { email?: unknown })?.email;
  const email = typeof rawEmail === "string" ? normalizeUserEmail(rawEmail) : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }

  try {
    let authExists = false;
    try {
      await auth.getUserByEmail(email);
      authExists = true;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err ?
          String((err as { code?: string }).code) :
          "";
      if (code !== "auth/user-not-found") {
        throw err;
      }
    }

    const hasSmartrefillAccess = await hasSmartrefillAccessForEmail(email);
    res.json({
      data: {
        authExists,
        hasSmartrefillAccess,
        canRegisterSmartrefill: !hasSmartrefillAccess,
      },
    });
  } catch (error: unknown) {
    logger.error("postRegistrationPreview failed", error);
    res.status(500).json({ error: "Failed to preview registration" });
  }
};

export const handleSignup = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { uid, email, name } = user;

  if (!email) {
    res.status(400).json({ error: "Email is required for signup" });
    return;
  }

  try {
    const access = await resolveSmartrefillAccessForUser(uid, email);
    if (access.hasSmartrefillAccess) {
      res.status(409).json({
        error:
          "An account with this email already exists for Smart Refill. Please sign in instead.",
        code: "EMAIL_ALREADY_EXISTS",
      });
      return;
    }

    const bodyName =
      typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";

    await upsertSmartrefillUserProfile({
      uid,
      email,
      bodyFullName: bodyName || name,
      idTokenName: name,
      grantSmartrefillAccess: true,
    });

    logger.info(
      `Synced Firestore user ${uid} with Auth profile and smartrefill appAccess`,
    );

    const signupAudience =
      req.body.audience === "staff" ? ("staff" as const) : ("owner" as const);
    // Do not block the signup response on Brevo — client redirects to onboarding immediately.
    void sendVerificationEmail(email, bodyName || name || "Verified User", {
      appBaseUrl: parseAppBaseUrlFromBody(req.body),
      audience: signupAudience,
      uid: user.uid,
    }).catch((emailErr: unknown) => {
      logger.error(`Signup verification email failed for ${email}:`, emailErr);
    });

    logAuditEvent("USER_SIGNUP", {
      userId: user.uid,
      email: user.email,
    });

    res.status(201).json({
      success: true,
      message: "Signup initialization complete and verification email sent",
    });
  } catch (error: any) {
    logger.error("Signup implementation failed", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
};

export const sendVerification = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { email, name } = user;

  if (!email) {
    res.status(400).json({ error: "Email not found in token" });
    return;
  }

  try {
    const bodyAudience =
      req.body.audience === "staff" ?
        ("staff" as const) :
        req.body.audience === "owner" ?
          ("owner" as const) :
          undefined;
    await sendVerificationEmail(email, name || "User", {
      appBaseUrl: parseAppBaseUrlFromBody(req.body),
      audience: bodyAudience,
      uid: user.uid,
    });
    res.json({ success: true, message: "Verification email sent" });
  } catch (error: any) {
    res
      .status(500)
      .json({
        error: "Failed to send verification email",
        details: error.message,
      });
  }
};

export const recordLoginEvent = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { uid } = user;

  const rawAppId = (req.body as { appId?: unknown })?.appId;
  const appId =
    typeof rawAppId === "string" && rawAppId.length > 0 && rawAppId.length <= 64 ?
      rawAppId :
      "smartrefill";

  try {
    if (appId === "smartrefill") {
      const userDoc = await db.collection("users").doc(uid).get();
      const appAccess = (userDoc.data()?.appAccess || []) as Array<{
        appId?: string;
        businessId?: string;
      }>;
      const smartRefillAccess = appAccess.find(
        (a) => a.appId === "smartrefill",
      );
      const businessId = (smartRefillAccess?.businessId as string) || null;
      if (businessId) {
        const access = await isWorkspaceMemberLoginAllowed(businessId, uid);
        if (!access.allowed) {
          res.status(403).json({
            error: access.message,
            code: access.code || "WORKSPACE_MEMBER_INACTIVE",
          });
          return;
        }
      }
    }

    const recorded = await writeUserLoginEvent({
      uid,
      email: user.email,
      decoded: user,
      req,
      kind: "explicit_login",
      provider: user.firebase?.sign_in_provider,
      appId,
    });

    if (recorded) {
      logAuditEvent("USER_EXPLICIT_LOGIN", {
        userId: uid,
        appId,
      });
      logger.info(`Recorded explicit login event for user ${uid}`);
    } else {
      logger.info(
        `Skipped duplicate daily login event for user ${uid} (already recorded today)`,
      );
    }

    res.json({ success: true, message: "Login event recorded" });
  } catch (error: any) {
    logger.error(`Failed to record login event for ${uid}:`, error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
};

/**
 * Updates the user's account details.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const updateAccount = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { displayName, photoURL, phone } = req.body;

  try {
    const userRef = db.collection("users").doc(user.uid);
    const updateData: Record<string, unknown> = {};

    if (displayName !== undefined) {
      updateData.displayName = displayName;
      updateData.fullName = displayName;
    }
    if (photoURL !== undefined) updateData.photoURL = photoURL;
    if (phone !== undefined) updateData.phone = phone;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No update data provided" });
      return;
    }

    await userRef.update({
      ...updateData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userSnap = await userRef.get();
    const memberRef = await resolveStaffWorkspaceMemberRef(
      user.uid,
      userSnap.data(),
    );
    if (memberRef) {
      const memberUpdate: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (displayName !== undefined) {
        memberUpdate.displayName = displayName;
        memberUpdate.name = displayName;
      }
      if (photoURL !== undefined) memberUpdate.photoURL = photoURL;
      if (phone !== undefined) memberUpdate.phone = phone;
      await memberRef.set(memberUpdate, { merge: true });
    }

    logAuditEvent("ACCOUNT_UPDATED", {
      userId: user.uid,
      updates: Object.keys(updateData),
    });

    res.json({ success: true, message: "Account updated successfully" });
  } catch (error: any) {
    logger.error(`Failed to update account for ${user.uid}:`, error);
    res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    res.status(400).json({ error: "Current password is required" });
    return;
  }

  if (!newPassword || newPassword.length < 8) {
    res
      .status(400)
      .json({ error: "New password must be at least 8 characters long" });
    return;
  }

  try {
    // 1. Verify current password via Google Identity Toolkit REST API
    const apiKey = process.env.SMARTREFILL_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("Server configuration error: Missing API Key");
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: currentPassword,
          returnSecureToken: true,
        }),
      },
    );

    if (!verifyResponse.ok) {
      const errorData: any = await verifyResponse.json();
      if (
        errorData.error?.message === "INVALID_PASSWORD" ||
        errorData.error?.message === "INVALID_LOGIN_CREDENTIALS"
      ) {
        res
          .status(401)
          .json({ error: "The current password entered is incorrect" });
        return;
      }
      throw new Error(
        errorData.error?.message || "Failed to verify current password",
      );
    }

    // 2. Update password via Admin SDK
    await auth.updateUser(user.uid, { password: newPassword });

    logAuditEvent("PASSWORD_CHANGED", {
      userId: user.uid,
    });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error: any) {
    logger.error(`Failed to update password for ${user.uid}:`, error);
    res
      .status(500)
      .json({ error: "Failed to update password", details: error.message });
  }
};
