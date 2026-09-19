export type PlanMapCapability = "full" | "locate_only";

export type PlanCapabilities = {
  map: PlanMapCapability;
  teamHub: boolean;
  teamHubAdmins: boolean;
  directoryStaff: boolean;
  scalePlatform: boolean;
  qrPortal: boolean;
  riverAiBuddy: boolean;
  selfServe: boolean;
  showOnPricing: boolean;
};

const DEFAULT_FREE: PlanCapabilities = {
  map: "locate_only",
  teamHub: false,
  teamHubAdmins: false,
  directoryStaff: false,
  scalePlatform: false,
  qrPortal: false,
  riverAiBuddy: false,
  selfServe: true,
  showOnPricing: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function defaultCapabilitiesForPlanCode(
  planCode: string | undefined | null,
): PlanCapabilities {
  const code = String(planCode || "free").toLowerCase().trim();
  if (code === "enterprise") {
    return {
      map: "full",
      teamHub: true,
      teamHubAdmins: true,
      directoryStaff: true,
      scalePlatform: true,
      qrPortal: true,
      riverAiBuddy: true,
      selfServe: false,
      showOnPricing: false,
    };
  }
  if (code === "scale") {
    return {
      map: "full",
      teamHub: true,
      teamHubAdmins: true,
      directoryStaff: true,
      scalePlatform: true,
      qrPortal: true,
      riverAiBuddy: true,
      selfServe: true,
      showOnPricing: true,
    };
  }
  if (code === "grow" || code === "pro") {
    return {
      map: "full",
      teamHub: true,
      teamHubAdmins: false,
      directoryStaff: false,
      scalePlatform: false,
      qrPortal: true,
      riverAiBuddy: false,
      selfServe: true,
      showOnPricing: true,
    };
  }
  if (code === "starter") {
    return {
      ...DEFAULT_FREE,
      qrPortal: true,
    };
  }
  return { ...DEFAULT_FREE };
}

export function parsePlanCapabilities(
  raw: unknown,
  planCode?: string | null,
): PlanCapabilities {
  const fallback = defaultCapabilitiesForPlanCode(planCode);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const data = raw as Record<string, unknown>;
  const map =
    data.map === "full" || data.map === "locate_only" ? data.map : fallback.map;
  return {
    map,
    teamHub: asBoolean(data.teamHub, fallback.teamHub),
    teamHubAdmins: asBoolean(data.teamHubAdmins, fallback.teamHubAdmins),
    directoryStaff: asBoolean(data.directoryStaff, fallback.directoryStaff),
    scalePlatform: asBoolean(data.scalePlatform, fallback.scalePlatform),
    qrPortal: asBoolean(data.qrPortal, fallback.qrPortal),
    riverAiBuddy: asBoolean(data.riverAiBuddy, fallback.riverAiBuddy),
    selfServe: asBoolean(data.selfServe, fallback.selfServe),
    showOnPricing: asBoolean(data.showOnPricing, fallback.showOnPricing),
  };
}

export function isSelfServePricingPlan(
  data: Record<string, unknown>,
  planCode?: string | null,
): boolean {
  const caps = parsePlanCapabilities(data.capabilities, planCode || String(data.code || ""));
  if (data.selfServe === false || caps.selfServe === false) return false;
  if (data.showOnPricing === false || caps.showOnPricing === false) return false;
  const code = String(planCode || data.code || "").toLowerCase();
  return code !== "enterprise" && code !== "custom";
}
