/**
 * Team Hub is on paid plans and the Scale trial (rider + staff apps for the
 * full trial window). Free stays locked. Team Chat still has its own 3-day preview.
 */
const TEAM_HUB_STATUSES = new Set(["active", "grace_period", "trial"]);

export function teamHubInviteDeniedReason(sub: {
  status?: string;
  planCode?: string;
  billingCycle?: string;
}): string | null {
  const plan = String(sub.planCode || "starter").toLowerCase();
  const status = String(sub.status || "").toLowerCase();
  if (plan === "free") {
    return "Team invitations are not available on the Free plan.";
  }
  if (TEAM_HUB_STATUSES.has(status)) {
    return null;
  }
  return "Team invitations require an active subscription.";
}
