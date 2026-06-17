import { Request, Response, NextFunction } from "express";
import { db } from "../config/firebase-admin";
import { WORKSPACE_MEMBER_DEACTIVATED_MESSAGE } from "../services/team/workspace-member-access";

export const validateBusinessAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  if (!businessId) {
    console.warn(
      "[validateBusinessAccess] Missing businessId in params:",
      req.params,
    );
    return res.status(400).json({ error: "Business ID is required in path" });
  }

  if (!user) {
    console.warn("[validateBusinessAccess] No user in request");
    return res.status(401).json({ error: "Unauthorized: No user session" });
  }

  console.info(
    `[validateBusinessAccess] User ${user.uid} access check: ${businessId}`,
  );

  try {
    const businessRef = db.collection("businesses").doc(businessId);
    const businessDoc = await businessRef.get();

    if (!businessDoc.exists) {
      return res.status(404).json({ error: "Business not found" });
    }

    const data = businessDoc.data();

    // Check if owner
    if (data?.ownerId === user.uid) {
      (req as any).businessRole = "owner";
      return next();
    }

    // Check if member
    const memberDoc = await businessRef
      .collection("members")
      .doc(user.uid)
      .get();
    if (memberDoc.exists) {
      const memberData = memberDoc.data();
      if (memberData?.isActive === false) {
        return res.status(403).json({
          error: WORKSPACE_MEMBER_DEACTIVATED_MESSAGE,
          code: "WORKSPACE_MEMBER_INACTIVE",
        });
      }
      (req as any).businessRole = memberData?.role || "member";
      return next();
    }

    return res
      .status(403)
      .json({ error: "Forbidden: No access to this business" });
  } catch (error) {
    console.error("Error checking business access:", error);
    return res
      .status(500)
      .json({ error: "Internal server error during access check" });
  }
};

/**
 * Only the business owner may manage team invites and directory (workspace owner).
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @param {NextFunction} next The next middleware.
 * @return {void|Response}
 */
export const requireBusinessOwner = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const role = (req as { businessRole?: string }).businessRole;
  if (role !== "owner") {
    return res.status(403).json({
      error: "Only the workspace owner can perform this action.",
    });
  }
  return next();
};
