import { nameDissimilarity, namesAreDuplicateLike } from "./name-fuzzy";
import type { ExtractedLedgerRow } from "./ledger-scan-types";

export type KnownCustomerLite = {
  id: string;
  name: string;
  phone?: string;
  address?: string;
};

export function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function customerLookupKey(name: string, phone?: string): string {
  const phoneKey = phone ? normalizePhoneKey(phone) : "";
  if (phoneKey.length >= 7) return `phone:${phoneKey}`;
  return `name:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function isWalkInCustomerName(name: unknown): boolean {
  const n = String(name ?? "")
    .toLowerCase()
    .trim();
  return (
    !n ||
    n === "walk-in customer" ||
    n === "walkin customer" ||
    n === "walk in" ||
    n === "walk-in"
  );
}

export function rowNeedsCustomerMatch(row: ExtractedLedgerRow): boolean {
  if (row.transactionType === "Expense" || row.transactionType === "expense") {
    return false;
  }
  return !isWalkInCustomerName(row.customerName);
}

export function matchCustomersToLedgerRows(
  rows: ExtractedLedgerRow[],
  existing: KnownCustomerLite[],
): ExtractedLedgerRow[] {
  const byPhone = new Map<string, KnownCustomerLite>();
  for (const c of existing) {
    const key = normalizePhoneKey(c.phone || "");
    if (key.length >= 7 && c.id) byPhone.set(key, c);
  }

  const batchResolved = new Map<
    string,
    { id?: string; name: string; isNew: boolean }
  >();

  return rows.map((row) => {
    if (!rowNeedsCustomerMatch(row)) {
      return { ...row, isNewCustomer: false, matchedExisting: false };
    }

    const phoneKey = row.customerPhone ?
      normalizePhoneKey(row.customerPhone) :
      "";
    const batchKey = customerLookupKey(row.customerName, row.customerPhone);

    const batchHit = batchResolved.get(batchKey);
    if (batchHit) {
      return {
        ...row,
        customerId: batchHit.id,
        isNewCustomer: batchHit.isNew,
        matchedExisting: !batchHit.isNew,
      };
    }

    if (phoneKey.length >= 7) {
      const byPh = byPhone.get(phoneKey);
      if (byPh) {
        batchResolved.set(batchKey, {
          id: byPh.id,
          name: byPh.name,
          isNew: false,
        });
        return {
          ...row,
          customerId: byPh.id,
          isNewCustomer: false,
          matchedExisting: true,
        };
      }
    }

    let bestId: string | undefined;
    let bestScore = 1;
    for (const c of existing) {
      const score = nameDissimilarity(row.customerName, c.name);
      if (score < bestScore) {
        bestScore = score;
        bestId = c.id;
      }
    }
    if (bestId && bestScore < 0.35) {
      batchResolved.set(batchKey, {
        id: bestId,
        name: row.customerName,
        isNew: false,
      });
      return {
        ...row,
        customerId: bestId,
        isNewCustomer: false,
        matchedExisting: true,
      };
    }

    for (const [, val] of batchResolved) {
      if (namesAreDuplicateLike(row.customerName, val.name)) {
        batchResolved.set(batchKey, val);
        return {
          ...row,
          customerId: val.id,
          isNewCustomer: val.isNew,
          matchedExisting: !val.isNew,
        };
      }
    }

    batchResolved.set(batchKey, {
      id: undefined,
      name: row.customerName,
      isNew: true,
    });
    return { ...row, isNewCustomer: true, matchedExisting: false };
  });
}
