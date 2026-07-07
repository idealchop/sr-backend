import {
  customerUsesWrContainerRotation,
  getBusinessContainerDefaultPolicy,
} from "./container-policy";
import { db } from "../../config/firebase-admin";
import { CustomerService } from "./customer-service";
import { DEFAULT_CONTAINER_CUSTODY_VERSION } from "./container-custody-default-content";

export type ContainerCustodyDocumentSource = "default" | "custom";

export type BusinessContainerCustodyAgreement = {
  enabled: boolean;
  documentUrl: string;
  version: string;
  source: ContainerCustodyDocumentSource;
};

export type BusinessContainerCustodySettings = {
  enabled: boolean;
  documentUrl?: string;
  version: string;
  source: ContainerCustodyDocumentSource;
};

export type CustomerContainerCustodyAgreement = {
  status: "accepted";
  versionId: string;
  acceptedAt: string;
  channel: "crm" | "portal";
};

export function parseBusinessContainerCustodySettings(
  value: unknown,
): BusinessContainerCustodySettings | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== true) return null;

  const documentUrl =
    typeof raw.documentUrl === "string" ? raw.documentUrl.trim() : "";
  const version =
    typeof raw.version === "string" && raw.version.trim() ?
      raw.version.trim() :
      DEFAULT_CONTAINER_CUSTODY_VERSION;

  if (documentUrl) {
    return {
      enabled: true,
      documentUrl,
      version,
      source: "custom",
    };
  }

  return {
    enabled: true,
    version,
    source: "default",
  };
}

export function resolveContainerCustodyDocumentUrl(
  businessId: string,
  settings: BusinessContainerCustodySettings,
  publicApiBase: string,
): string {
  if (settings.documentUrl) return settings.documentUrl;
  const base = publicApiBase.replace(/\/$/, "");
  const params = new URLSearchParams({ b: businessId });
  return `${base}/public/portal/container-custody-agreement?${params.toString()}`;
}

export function resolveBusinessContainerCustodyAgreement(
  businessId: string,
  value: unknown,
  publicApiBase: string,
): BusinessContainerCustodyAgreement | null {
  const settings = parseBusinessContainerCustodySettings(value);
  if (!settings) return null;
  return {
    enabled: true,
    documentUrl: resolveContainerCustodyDocumentUrl(
      businessId,
      settings,
      publicApiBase,
    ),
    version: settings.version,
    source: settings.source,
  };
}

/** @deprecated Use parseBusinessContainerCustodySettings + resolve agreement helper */
export function normalizeBusinessContainerCustodyAgreement(
  value: unknown,
): BusinessContainerCustodyAgreement | null {
  const settings = parseBusinessContainerCustodySettings(value);
  if (!settings) return null;
  if (settings.documentUrl) {
    return {
      enabled: true,
      documentUrl: settings.documentUrl,
      version: settings.version,
      source: "custom",
    };
  }
  return null;
}

export function normalizeCustomerContainerCustodyAgreement(
  value: unknown,
): CustomerContainerCustodyAgreement | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "accepted") return null;
  const versionId =
    typeof raw.versionId === "string" ? raw.versionId.trim() : "";
  const acceptedAt =
    typeof raw.acceptedAt === "string" ? raw.acceptedAt.trim() : "";
  const channel = raw.channel === "portal" ? "portal" : "crm";
  if (!versionId || !acceptedAt) return null;
  return { status: "accepted", versionId, acceptedAt, channel };
}

export function businessHasActiveContainerCustodyAgreement(
  business: Record<string, unknown> | null | undefined,
): business is Record<string, unknown> & {
  containerCustodyAgreement: BusinessContainerCustodySettings;
} {
  return parseBusinessContainerCustodySettings(
    business?.containerCustodyAgreement,
  ) !== null;
}

export function customerNeedsContainerCustodyAcceptance(
  customer: { containerPolicy?: unknown; containerCustodyAgreement?: unknown } | null | undefined,
  business: Record<string, unknown> | null | undefined,
): boolean {
  if (!businessHasActiveContainerCustodyAgreement(business)) return false;
  if (!customerUsesWrContainerRotation(customer, getBusinessContainerDefaultPolicy(business))) {
    return false;
  }
  const settings = parseBusinessContainerCustodySettings(
    business?.containerCustodyAgreement,
  );
  if (!settings) return false;
  const accepted = normalizeCustomerContainerCustodyAgreement(
    customer?.containerCustodyAgreement,
  );
  return !accepted || accepted.versionId !== settings.version;
}

export function buildCustomerContainerCustodyAcceptance(
  versionId: string,
  channel: "crm" | "portal",
): CustomerContainerCustodyAgreement {
  return {
    status: "accepted",
    versionId,
    acceptedAt: new Date().toISOString(),
    channel,
  };
}

export async function stampCustomerContainerCustodyAcceptance(
  businessId: string,
  customerId: string,
  channel: "crm" | "portal",
): Promise<CustomerContainerCustodyAgreement> {
  const businessSnap = await db.collection("businesses").doc(businessId).get();
  if (!businessSnap.exists) {
    throw new Error("BUSINESS_NOT_FOUND");
  }
  const business = businessSnap.data() as Record<string, unknown>;
  if (!businessHasActiveContainerCustodyAgreement(business)) {
    throw new Error("CUSTODY_NOT_ENABLED");
  }
  const settings = parseBusinessContainerCustodySettings(
    business.containerCustodyAgreement,
  );
  if (!settings) {
    throw new Error("CUSTODY_INVALID");
  }
  const acceptance = buildCustomerContainerCustodyAcceptance(
    settings.version,
    channel,
  );
  await CustomerService.updateCustomer(businessId, customerId, {
    containerCustodyAgreement: acceptance,
  });
  return acceptance;
}
