import { CustomerService } from "../customers/customer-service";
import { RiderService } from "../riders/rider-service";
import { TransactionService } from "../transactions/transaction-service";
import { NEARBY_STOP_RADIUS_KM } from "../transactions/claim-nearby-stop-service";
import { buildNearbyQuietCustomers } from "../transactions/nearby-quiet-customers";
import { buildNearbyRouteGroups } from "../../utils/geo-clustering";
import { loadRiderMessengerJobs } from "./rider-messenger-jobs-service";
import type { RiderMessengerNearbyRow } from "./rider-messenger-types";

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function customerCoords(
  customer: {
    latitude?: number;
    longitude?: number;
    coordinates?: { lat?: number; lng?: number };
  } | null | undefined,
): { lat: number; lng: number } | null {
  if (!customer) return null;
  const lat = customer.coordinates?.lat ?? customer.latitude;
  const lng = customer.coordinates?.lng ?? customer.longitude;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return { lat, lng };
}

function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(km < 10 ? 1 : 0)}km`;
}

type NearbyStopRaw = Omit<RiderMessengerNearbyRow, "index">;

export async function loadRiderMessengerNearbyGroups(params: {
  businessId: string;
  riderId: string;
  riderLat: number;
  riderLng: number;
}) {
  const jobs = await loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: "all",
  });
  const todoIds = new Set(
    jobs.filter((j) => j.isTodo).map((j) => j.transactionId),
  );

  const transactions = await TransactionService.getTransactionsByBusiness(
    params.businessId,
    { limit: 500, orderBy: "scheduledAt" },
  );

  const [customers, riders] = await Promise.all([
    CustomerService.getCustomersByBusiness(params.businessId),
    RiderService.getRidersByBusiness(params.businessId),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c] as const));
  const riderById = new Map(riders.map((r) => [r.id, r] as const));

  const rows: NearbyStopRaw[] = [];
  const orderCustomerIds = new Set<string>();
  const seenTxIds = new Set<string>();

  for (const job of jobs.filter((j) => j.isTodo)) {
    const tx = transactions.find((row) => row.id === job.transactionId);
    if (!tx?.customerId || !tx.id) continue;
    const customer = customerById.get(tx.customerId);
    const pos = customerCoords(customer);
    if (!pos) continue;
    const d = haversineKm(params.riderLat, params.riderLng, pos.lat, pos.lng);
    if (d > NEARBY_STOP_RADIUS_KM) continue;
    seenTxIds.add(tx.id);
    orderCustomerIds.add(tx.customerId);
    rows.push({
      source: "order",
      customerId: tx.customerId,
      transactionId: tx.id,
      referenceId: tx.referenceId || tx.id,
      customerName: tx.customerName || customer?.name || "Customer",
      type: tx.type as "delivery" | "collection",
      distanceKm: d,
      assignedRiderName: riderById.get(params.riderId)?.name ?? "You",
      isOverride: false,
      lat: pos.lat,
      lng: pos.lng,
    });
  }

  for (const tx of transactions) {
    const txId = tx.id;
    if (!txId) continue;
    if (tx.type !== "delivery" && tx.type !== "collection") continue;
    const ds = tx.deliveryStatus;
    if (ds !== "pending" && ds !== "placed") continue;
    if (!tx.customerId) continue;
    if (tx.riderId === params.riderId) continue;
    if (todoIds.has(txId)) continue;
    if (seenTxIds.has(txId)) continue;

    const customer = customerById.get(tx.customerId);
    const pos = customerCoords(customer);
    if (!pos) continue;

    const d = haversineKm(params.riderLat, params.riderLng, pos.lat, pos.lng);
    if (d > NEARBY_STOP_RADIUS_KM) continue;

    orderCustomerIds.add(tx.customerId);
    const other = tx.riderId ? riderById.get(tx.riderId) : undefined;
    rows.push({
      source: "order",
      customerId: tx.customerId,
      transactionId: txId,
      referenceId: tx.referenceId || txId,
      customerName: tx.customerName || customer?.name || "Customer",
      type: tx.type as "delivery" | "collection",
      distanceKm: d,
      assignedRiderName: other?.name ?? null,
      isOverride: Boolean(tx.riderId),
      lat: pos.lat,
      lng: pos.lng,
    });
  }

  const quietCustomers = buildNearbyQuietCustomers({
    customers,
    transactions,
    excludeCustomerIds: orderCustomerIds,
  });

  for (const quiet of quietCustomers) {
    const customer = customerById.get(quiet.customerId);
    const pos = customerCoords(customer);
    if (!pos) continue;

    const d = haversineKm(params.riderLat, params.riderLng, pos.lat, pos.lng);
    if (d > NEARBY_STOP_RADIUS_KM) continue;

    rows.push({
      source: "dormant",
      customerId: quiet.customerId,
      referenceId: "QUIET",
      customerName: quiet.customerName,
      type: quiet.lastOrderType,
      distanceKm: d,
      assignedRiderName: null,
      isOverride: false,
      lat: pos.lat,
      lng: pos.lng,
      daysSinceLastOrder: quiet.daysSinceLastOrder,
    });
  }

  rows.sort((a, b) => a.distanceKm - b.distanceKm);

  const clustered = buildNearbyRouteGroups(rows, (row) => ({
    lat: row.lat,
    lng: row.lng,
  }));

  return clustered.map((group, idx) => {
    const sortedMembers = [...group.members].sort(
      (a, b) => a.distanceKm - b.distanceKm,
    );
    const nearestDistanceKm = sortedMembers[0]?.distanceKm ?? 0;
    const quietCount = sortedMembers.filter((m) => m.source === "dormant").length;
    return {
      groupNumber: idx + 1,
      label: group.label,
      stopCount: sortedMembers.length,
      spanM: group.spanM,
      nearestDistanceKm,
      quietCount,
      members: sortedMembers,
    };
  });
}

/** Step 1 — NEARBY: numbered group summary only. */
export function formatNearbyIndexMessage(
  groups: Awaited<ReturnType<typeof loadRiderMessengerNearbyGroups>>,
): string {
  if (!groups.length) {
    return `Walang malapit na stop within ${NEARBY_STOP_RADIUS_KM} km. I-send ang JOBS para sa list mo.`;
  }

  const lines: string[] = [
    `📍 NEARBY — within ${NEARBY_STOP_RADIUS_KM} km`,
    "",
  ];

  for (const group of groups) {
    const spread = group.spanM > 0 ? ` · ~${group.spanM}m spread` : "";
    const quietLabel =
      group.quietCount > 0 ?
        ` · ${group.quietCount} quiet 7d+` :
        "";
    lines.push(
      `${group.groupNumber}. ${group.label} · ${group.stopCount} stop${group.stopCount === 1 ? "" : "s"}${spread}${quietLabel} · nearest ${formatDistanceKm(group.nearestDistanceKm)}`,
    );
  }

  lines.push("");
  lines.push("I-send GROUP # para makita ang customers (hal. GROUP 1).");
  lines.push("Share location ulit kung lumipat ka na.");
  return lines.join("\n").slice(0, 1900);
}

/** Step 2 — GROUP #: customers in one group, numbered for CLAIM. */
export function formatGroupDetailMessage(
  group: Awaited<ReturnType<typeof loadRiderMessengerNearbyGroups>>[number],
): string {
  const spread = group.spanM > 0 ? ` · ~${group.spanM}m spread` : "";
  const lines: string[] = [
    `${group.label} · ${group.stopCount} stop${group.stopCount === 1 ? "" : "s"}${spread}`,
    "",
  ];

  group.members.forEach((row, idx) => {
    const n = idx + 1;
    const typeLabel = row.type === "collection" ? "COL" : "DEL";
    if (row.source === "dormant") {
      lines.push(
        `${n}. ${row.customerName} (${typeLabel}) · ${formatDistanceKm(row.distanceKm)} · quiet ${row.daysSinceLastOrder ?? 7}d`,
      );
      return;
    }
    const assignLabel = row.isOverride ?
      `was ${row.assignedRiderName || "assigned"}` :
      row.assignedRiderName === "You" ?
        "sa'yo" :
        "unassigned";
    lines.push(
      `${n}. ${row.referenceId} · ${row.customerName} (${typeLabel}) · ${formatDistanceKm(row.distanceKm)} · ${assignLabel}`,
    );
  });

  lines.push("");
  lines.push("CLAIM # — idagdag sa route mo");
  lines.push("DONE GROUP # · FAIL GROUP # · CANCEL GROUP # — lahat ng sa'yo sa group");
  lines.push("ORDER # — schedule quiet suki (hal. ORDER 2 DEL 3 slim alkaline, 2 round purified)");
  lines.push("DETAILS # — full info");
  lines.push("NEARBY — balik sa group list");
  return lines.join("\n").slice(0, 1900);
}

export function groupDetailRows(
  group: Awaited<ReturnType<typeof loadRiderMessengerNearbyGroups>>[number],
): RiderMessengerNearbyRow[] {
  return group.members.map((row, idx) => ({ ...row, index: idx + 1 }));
}

export function resolveNearbyGroup(
  groups: Awaited<ReturnType<typeof loadRiderMessengerNearbyGroups>>,
  token: string,
) {
  const raw = token.trim();
  if (!raw) return null;
  const asIndex = Number.parseInt(raw, 10);
  if (Number.isFinite(asIndex) && asIndex > 0) {
    return groups.find((g) => g.groupNumber === asIndex) ?? null;
  }
  return null;
}

export function resolveNearbyTarget(
  rows: RiderMessengerNearbyRow[],
  token: string,
): RiderMessengerNearbyRow | null {
  const raw = token.trim();
  if (!raw) return null;
  const asIndex = Number.parseInt(raw, 10);
  if (Number.isFinite(asIndex) && asIndex > 0) {
    return rows.find((r) => r.index === asIndex) ?? null;
  }
  const upper = raw.toUpperCase();
  return (
    rows.find((r) => r.referenceId.toUpperCase() === upper) ??
    rows.find((r) => r.transactionId === raw) ??
    rows.find((r) => r.customerId === raw) ??
    null
  );
}
