import type { Request } from "express";
import { RiderService } from "../riders/rider-service";

export async function resolveSelfRiderIdForBusiness(
  businessId: string,
  userId: string,
): Promise<string | null> {
  const rider = await RiderService.getRiderByUserId(businessId, userId);
  return rider?.id ?? null;
}

/** Owner may manage any rider; app riders may manage only their own profile. */
export async function canManageRiderMessengerLink(
  req: Request,
  targetRiderId: string,
): Promise<boolean> {
  const role = (req as { businessRole?: string }).businessRole;
  if (role === "owner") return true;

  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid || role !== "rider") return false;

  const selfRiderId = await resolveSelfRiderIdForBusiness(req.params.businessId, uid);
  return selfRiderId === targetRiderId;
}
