import type { Customer } from "../customers/customer-service";
import type { RawSubmissionPayload } from "./raw-submission-types";

export type PortalCustomerStatus = "recognized" | "new";

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function normDigits(value: unknown): string {
  return norm(value).replace(/\D/g, "");
}

function normEmail(value: unknown): string {
  return norm(value).toLowerCase();
}

function coordsEqual(a: unknown, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) {
    return norm(a) === norm(b);
  }
  return Math.abs(na - nb) < 0.00001;
}

function expectedCustomerType(
  sukiType: string | undefined,
): "residential" | "commercial" | undefined {
  if (sukiType === "commercial") return "commercial";
  if (sukiType === "personal") return "residential";
  return undefined;
}

/**
 * Whether the portal submission is tied to a known suki (QR link) or anonymous.
 * @param {string} customerId Linked customer id from the portal session, if any.
 * @return {PortalCustomerStatus}
 */
export function resolvePortalCustomerStatus(
  customerId: string | undefined,
): PortalCustomerStatus {
  return norm(customerId) ? "recognized" : "new";
}

/**
 * Human-readable field labels for portal profile diffs.
 * @param {string} field Internal field key.
 * @return {string}
 */
export function portalProfileFieldLabel(field: string): string {
  switch (field) {
  case "name":
    return "name";
  case "phone":
    return "phone";
  case "email":
    return "email";
  case "address":
    return "address";
  case "location":
    return "map pin";
  case "sukiType":
    return "suki type";
  case "companyName":
    return "company";
  default:
    return field;
  }
}

/**
 * Returns changed profile/address fields when a recognized suki submits portal data.
 * Empty when there is nothing meaningful to update.
 * @param {Customer | null | undefined} customer Stored suki profile.
 * @param {RawSubmissionPayload} payload Portal submission payload.
 * @return {string[]} Changed field keys.
 */
export function listPortalProfileChanges(
  customer: Customer | null | undefined,
  payload: RawSubmissionPayload,
): string[] {
  if (!customer) return [];

  const profile = payload.profile || {};
  const addr = payload.address || {};
  const changes: string[] = [];

  const submittedName = norm(profile.name);
  if (submittedName && submittedName !== norm(customer.name)) {
    changes.push("name");
  }

  const submittedPhone = normDigits(profile.phone);
  const storedPhone = normDigits(customer.phone);
  if (submittedPhone.length >= 8 && submittedPhone !== storedPhone) {
    changes.push("phone");
  }

  const submittedEmail = normEmail(profile.email);
  const storedEmail = normEmail(customer.email);
  if (submittedEmail.length > 3 && submittedEmail !== storedEmail) {
    changes.push("email");
  }

  const submittedAddr = norm(addr.line);
  if (submittedAddr && submittedAddr !== norm(customer.address)) {
    changes.push("address");
  }

  if (
    (addr.latitude !== undefined || addr.longitude !== undefined) &&
    (!coordsEqual(addr.latitude, customer.latitude) ||
      !coordsEqual(addr.longitude, customer.longitude))
  ) {
    changes.push("location");
  }

  const expectedType = expectedCustomerType(profile.sukiType);
  if (expectedType && expectedType !== customer.type) {
    changes.push("sukiType");
  }

  const submittedCompany = norm(profile.companyName);
  if (
    profile.sukiType === "commercial" &&
    submittedCompany &&
    submittedCompany !== norm(customer.companyName)
  ) {
    changes.push("companyName");
  }

  return changes;
}

/**
 * @param {string[]} fields Changed field keys from `listPortalProfileChanges`.
 * @return {string} Short summary for notification copy.
 */
export function summarizePortalProfileChanges(fields: string[]): string {
  if (fields.length === 0) return "";
  return fields.map(portalProfileFieldLabel).join(", ");
}
