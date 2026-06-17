import type { ExtractedCustomerDraft } from "../ai/customer-import-from-file-service";
import type { Customer } from "./customer-service";
import { enrichCustomerDraftsWithGeocoding } from "./customer-address-geocode";
import { countActiveCustomers } from "./customer-active-limit-service";
import { CustomerService } from "./customer-service";
import { namesAreDuplicateLike } from "../ai/name-fuzzy";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { parsePlanLimitations } from "../../utils/subscription-addon-plan-limits";

export type CustomerImportRowStatus = "clean" | "flagged";

export type ProfiledImportRow = {
  index: number;
  customer: ExtractedCustomerDraft;
  status: CustomerImportRowStatus;
  issues: string[];
};

export type CustomerImportLimitCheck = {
  totalRows: number;
  currentCustomerCount: number;
  customerRecordCap: number | null;
  remainingSlots: number | null;
  /** All rows in file would push over plan cap (checked before import). */
  totalExceedsLimit: boolean;
  overBy: number | null;
  /** Clean rows that can be imported without exceeding cap. */
  cleanCount: number;
  canImportClean: boolean;
};

export type CustomerImportProfileResult = {
  limitCheck: CustomerImportLimitCheck;
  rows: ProfiledImportRow[];
  summary: {
    total: number;
    clean: number;
    flagged: number;
  };
  geocodedCount?: number;
  geocodeWarnings?: string[];
};

function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Profiles import rows and resolves subscription active-suki cap for the workspace.
 */
export class CustomerImportProfileService {
  static async resolveCustomerRecordCap(businessId: string): Promise<{
    currentCount: number;
    max: number | null;
  }> {
    const [customers, sub] = await Promise.all([
      CustomerService.getCustomersByBusiness(businessId),
      SubscriptionService.getSubscriptionStatus(businessId),
    ]);
    const planCode = String(
      (sub as { planCode?: string }).planCode || "starter",
    );
    const limitations =
      "limitations" in sub && sub.limitations ?
        sub.limitations as { customersMax?: number | null } :
        null;
    if (limitations && "customersMax" in limitations) {
      return {
        currentCount: countActiveCustomers(customers),
        max: limitations.customersMax ?? null,
      };
    }
    const planRow = await SubscriptionService.lookupPlanRowForCode(planCode);
    const quotas = parsePlanLimitations(planRow?.planData?.limitations);
    return {
      currentCount: countActiveCustomers(customers),
      max: quotas?.customersMax ?? null,
    };
  }

  static profileRows(
    rows: ExtractedCustomerDraft[],
    existingCustomers: Customer[],
  ): ProfiledImportRow[] {
    const existingByPhone = new Map<string, Customer>();
    for (const c of existingCustomers) {
      const key = normalizePhoneKey(c.phone || "");
      if (key.length >= 7 && c.id) existingByPhone.set(key, c);
    }

    const filePhoneSeen = new Map<string, number>();
    const fileNameIndices: { index: number; name: string }[] = [];

    return rows.map((raw, index) => {
      const issues: string[] = [];
      const name = String(raw?.name || "").trim();
      const phone = String(raw?.phone || "").trim();
      const address = String(raw?.address || "").trim();
      const email = raw?.email ? String(raw.email).trim() : "";
      const type = raw?.type;

      const customer: ExtractedCustomerDraft = {
        ...raw,
        name,
        phone,
        address,
        email: email || undefined,
      };

      if (!name) issues.push("Missing customer name");
      if (!phone) issues.push("Missing phone number");
      else if (!isValidPhone(phone)) {
        issues.push("Phone number looks invalid (need at least 7 digits)");
      }

      if (!address) issues.push("Missing address");

      if (email && !isValidEmail(email)) {
        issues.push("Email format looks invalid");
      }

      if (type && type !== "residential" && type !== "commercial") {
        issues.push("Type must be residential or commercial");
      }

      const phoneKey = phone ? normalizePhoneKey(phone) : "";
      if (phoneKey.length >= 7) {
        const firstIdx = filePhoneSeen.get(phoneKey);
        if (firstIdx !== undefined) {
          issues.push(`Duplicate phone in file (same as row ${firstIdx + 1})`);
        } else {
          filePhoneSeen.set(phoneKey, index);
        }

        const existing = existingByPhone.get(phoneKey);
        if (existing) {
          issues.push(
            `Phone already used by existing customer "${existing.name}"`,
          );
        }
      }

      if (name) {
        for (const prev of fileNameIndices) {
          if (namesAreDuplicateLike(name, prev.name)) {
            issues.push(`Similar name to row ${prev.index + 1} in this file`);
            break;
          }
        }
        for (const c of existingCustomers) {
          if (c.name && namesAreDuplicateLike(name, c.name)) {
            const samePhone =
              phoneKey.length >= 7 &&
              normalizePhoneKey(c.phone || "") === phoneKey;
            if (!samePhone) {
              issues.push(
                `Name is very similar to existing customer "${c.name}"`,
              );
              break;
            }
          }
        }
        fileNameIndices.push({ index, name });
      }

      const status: CustomerImportRowStatus = issues.length ?
        "flagged" :
        "clean";
      return { index, customer, status, issues };
    });
  }

  static buildLimitCheck(
    totalRows: number,
    cleanCount: number,
    currentCount: number,
    max: number | null,
  ): CustomerImportLimitCheck {
    const remainingSlots =
      max === null ? null : Math.max(0, max - currentCount);

    const totalExceedsLimit = max !== null && currentCount + totalRows > max;
    const overBy =
      totalExceedsLimit && max !== null ? currentCount + totalRows - max : null;

    const canImportClean =
      !totalExceedsLimit && (max === null || currentCount + cleanCount <= max);

    return {
      totalRows,
      currentCustomerCount: currentCount,
      customerRecordCap: max,
      remainingSlots,
      totalExceedsLimit,
      overBy,
      cleanCount,
      canImportClean,
    };
  }

  static async profileImport(
    businessId: string,
    rows: ExtractedCustomerDraft[],
  ): Promise<CustomerImportProfileResult> {
    const [{ currentCount, max }, existing] = await Promise.all([
      this.resolveCustomerRecordCap(businessId),
      CustomerService.getCustomersByBusiness(businessId),
    ]);

    const geocoded = await enrichCustomerDraftsWithGeocoding(rows);
    const profiled = this.profileRows(geocoded.rows, existing);
    const cleanCount = profiled.filter((r) => r.status === "clean").length;
    const flaggedCount = profiled.length - cleanCount;

    const limitCheck = this.buildLimitCheck(
      geocoded.rows.length,
      cleanCount,
      currentCount,
      max,
    );

    return {
      limitCheck,
      rows: profiled,
      summary: {
        total: profiled.length,
        clean: cleanCount,
        flagged: flaggedCount,
      },
      geocodedCount: geocoded.geocodedCount,
      geocodeWarnings: geocoded.geocodeWarnings.length ?
        geocoded.geocodeWarnings :
        undefined,
    };
  }
}
