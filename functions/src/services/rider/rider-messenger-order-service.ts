import type { CommunityOrderLine } from "../meta/community-dispatch-template-parser";
import {
  claimNearbyDormantForLinkedRider,
  ClaimNearbyDormantError,
} from "../transactions/claim-nearby-dormant-service";
import {
  buildNearbyDormantOrderSpec,
  formatOrderCreatedLinesMessage,
  formatOrderPreviewMessage,
  parseRiderMessengerOrderLineTail,
  type NearbyDormantOrderSpec,
} from "./rider-messenger-order-lines-service";
import type { RiderMessengerNearbyRow } from "./rider-messenger-types";

export type ParsedRiderMessengerOrder = {
  target: string;
  type?: "delivery" | "collection";
  qty?: number;
  orderLines?: CommunityOrderLine[];
  orderRaw?: string;
};

export type RiderMessengerOrderPlan =
  | {
    action: "preview";
    message: string;
    pending: RiderMessengerConfirmOrderPending;
  }
  | {
    action: "create";
    orderSpec: NearbyDormantOrderSpec;
    summaryLines: string[];
    orderType: "delivery" | "collection";
  };

export type RiderMessengerConfirmOrderPending = {
  kind: "confirm_order";
  customerId: string;
  target: string;
  orderSpec: NearbyDormantOrderSpec;
  summaryLines: string[];
  customerName: string;
  orderType: "delivery" | "collection";
  daysSinceLastOrder?: number;
};

export function parseRiderMessengerOrderArg(arg: string): ParsedRiderMessengerOrder | null {
  const trimmed = arg.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\S+)(?:\s+(DELIVERY|DEL|COLLECTION|COL))?(?:\s+(.*))?$/is,
  );
  if (!match?.[1]) return null;

  const target = match[1];
  const typeToken = match[2]?.toUpperCase();
  const tail = match[3]?.trim() ?? "";
  let type: "delivery" | "collection" | undefined;
  if (typeToken === "DELIVERY" || typeToken === "DEL") type = "delivery";
  if (typeToken === "COLLECTION" || typeToken === "COL") type = "collection";

  if (tail) {
    const orderLines = parseRiderMessengerOrderLineTail(tail);
    if (orderLines.length) {
      return {
        target,
        ...(type ? { type } : {}),
        orderLines,
        orderRaw: tail,
      };
    }
    const qtyParsed = Number.parseFloat(tail);
    const qty =
      Number.isFinite(qtyParsed) && qtyParsed > 0 ?
        Math.max(1, Math.floor(qtyParsed)) :
        undefined;
    if (qty != null) {
      return { target, ...(type ? { type } : {}), qty };
    }
  }

  return { target, ...(type ? { type } : {}) };
}

export async function planRiderMessengerOrder(params: {
  businessId: string;
  customerId: string;
  customerName: string;
  daysSinceLastOrder?: number;
  nearby: RiderMessengerNearbyRow;
  order: ParsedRiderMessengerOrder;
}): Promise<RiderMessengerOrderPlan> {
  const orderType =
    params.order.type ??
    (params.nearby.type === "collection" ? "collection" : "delivery");

  const built = await buildNearbyDormantOrderSpec({
    businessId: params.businessId,
    customerId: params.customerId,
    orderType,
    orderLines: params.order.orderLines,
    orderQty: params.order.qty,
    repeatLast: !params.order.orderLines?.length && params.order.qty == null,
  });

  if (built.needsConfirm) {
    if (
      params.order.qty != null &&
      built.summaryLines.length > 1 &&
      !params.order.orderLines?.length
    ) {
      throw new ClaimNearbyDormantError(
        400,
        [
          `Maraming lines ang last order — hindi pwede ang qty-only (${params.order.qty}).`,
          ...built.summaryLines.slice(0, 6),
          "",
          "I-specify per line:",
          "ORDER # DEL 3 slim alkaline, 2 round purified",
        ].join("\n").slice(0, 1900),
      );
    }
    const message = formatOrderPreviewMessage({
      customerName: params.customerName,
      orderType,
      daysSinceLastOrder: params.daysSinceLastOrder,
      lineSummaries: built.summaryLines,
      explicitLines: built.explicitLines,
      needsConfirm: true,
    });
    return {
      action: "preview",
      message,
      pending: {
        kind: "confirm_order",
        customerId: params.customerId,
        target: params.order.target,
        orderSpec: built.orderSpec,
        summaryLines: built.summaryLines,
        customerName: params.customerName,
        orderType,
        daysSinceLastOrder: params.daysSinceLastOrder,
      },
    };
  }

  return {
    action: "create",
    orderSpec: built.orderSpec,
    summaryLines: built.summaryLines,
    orderType,
  };
}

async function claimWithOrderSpec(params: {
  businessId: string;
  customerId: string;
  riderId: string;
  psid: string;
  riderLat: number;
  riderLng: number;
  orderType: "delivery" | "collection";
  orderSpec: NearbyDormantOrderSpec;
}): Promise<{ transactionId: string; referenceId: string }> {
  return claimNearbyDormantForLinkedRider({
    businessId: params.businessId,
    customerId: params.customerId,
    riderId: params.riderId,
    riderLat: params.riderLat,
    riderLng: params.riderLng,
    actorId: `rider_messenger:${params.psid}`,
    orderSpec: {
      type: params.orderType,
      ...(params.orderSpec.deliveryLines ?
        { deliveryLines: params.orderSpec.deliveryLines } :
        {}),
      ...(params.orderSpec.items ? { items: params.orderSpec.items } : {}),
      ...(params.orderSpec.collectionItems ?
        { collectionItems: params.orderSpec.collectionItems } :
        {}),
      ...(params.orderSpec.repeatLast ? { repeatLast: true } : {}),
    },
  });
}

export async function executeRiderMessengerOrder(params: {
  businessId: string;
  riderId: string;
  psid: string;
  customerId: string;
  riderLat: number;
  riderLng: number;
  orderType: "delivery" | "collection";
  orderSpec: NearbyDormantOrderSpec;
}): Promise<{ transactionId: string; referenceId: string; type: "delivery" | "collection" }> {
  const result = await claimWithOrderSpec(params);
  return { ...result, type: params.orderType };
}

export async function createRiderMessengerOrder(params: {
  businessId: string;
  riderId: string;
  psid: string;
  nearby: RiderMessengerNearbyRow;
  order: ParsedRiderMessengerOrder;
  riderLat: number;
  riderLng: number;
}): Promise<
  | { kind: "preview"; message: string; pending: RiderMessengerConfirmOrderPending }
  | {
    kind: "created";
    referenceId: string;
    type: "delivery" | "collection";
    summaryLines: string[];
  }
> {
  if (params.nearby.source !== "dormant") {
    throw new ClaimNearbyDormantError(
      400,
      "ORDER is for quiet sukis lang. Gamitin ang CLAIM # para sa open orders.",
    );
  }

  const plan = await planRiderMessengerOrder({
    businessId: params.businessId,
    customerId: params.nearby.customerId,
    customerName: params.nearby.customerName,
    daysSinceLastOrder: params.nearby.daysSinceLastOrder,
    nearby: params.nearby,
    order: params.order,
  });

  if (plan.action === "preview") {
    return { kind: "preview", message: plan.message, pending: plan.pending };
  }

  const created = await executeRiderMessengerOrder({
    businessId: params.businessId,
    riderId: params.riderId,
    psid: params.psid,
    customerId: params.nearby.customerId,
    riderLat: params.riderLat,
    riderLng: params.riderLng,
    orderType: plan.orderType,
    orderSpec: plan.orderSpec,
  });

  return {
    kind: "created",
    referenceId: created.referenceId,
    type: created.type,
    summaryLines: plan.summaryLines,
  };
}

export function formatOrderCreatedMessage(params: {
  customerName: string;
  referenceId: string;
  type: "delivery" | "collection";
  summaryLines: string[];
  daysSinceLastOrder?: number;
}): string {
  return formatOrderCreatedLinesMessage(params);
}

export { ClaimNearbyDormantError };
