import { logger } from "../observability/logging/logger";

export type PaymongoRequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};

function secretKey(): string {
  const key = process.env.PAYMONGO_SECRET_KEY?.trim();
  if (!key) throw new Error("PAYMONGO_NOT_CONFIGURED");
  return key;
}

export function paymongoRecurringEnabled(): boolean {
  if (!process.env.PAYMONGO_SECRET_KEY?.trim()) return false;
  const flag = process.env.PAYMONGO_RECURRING_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export async function paymongoRequest<T = unknown>(
  options: PaymongoRequestOptions,
): Promise<T> {
  const auth = Buffer.from(`${secretKey()}:`).toString("base64");
  const res = await fetch(`https://api.paymongo.com${options.path}`, {
    method: options.method,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error("PayMongo API error", {
      path: options.path,
      status: res.status,
      errText: errText.slice(0, 500),
    });
    throw new Error(`PAYMONGO_API_${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function amountToCentavos(amount: number): number {
  return Math.round(amount * 100);
}

export type PaymongoLinkContext = {
  linkId: string;
  referenceNumber: string;
  intentId?: string;
  businessId?: string;
};

function normalizePaymongoReference(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function parsePaymongoLinkPayload(json: {
  data?: {
    id?: string;
    attributes?: {
      reference_number?: string;
      remarks?: string;
      metadata?: Record<string, string>;
    };
  };
}): PaymongoLinkContext | null {
  const linkId = String(json.data?.id || "").trim();
  const attrs = json.data?.attributes;
  if (!linkId || !attrs) return null;

  const metadata = attrs.metadata || {};
  const intentId =
    String(metadata.intentId || attrs.remarks || "").trim() || undefined;
  const businessId =
    String(metadata.businessId || "").trim() || undefined;

  return {
    linkId,
    referenceNumber: String(attrs.reference_number || "").trim(),
    intentId,
    businessId,
  };
}

/** Resolve legacy PayMongo link metadata from the short reference shown on receipts. */
export async function getPaymongoLinkByReference(
  referenceNumber: string,
): Promise<PaymongoLinkContext | null> {
  const ref = normalizePaymongoReference(referenceNumber);
  if (!ref) return null;

  const paths = [
    `/v1/links/getByRef?reference_number=${encodeURIComponent(ref)}`,
    `/v1/links/${encodeURIComponent(ref)}`,
  ];

  for (const path of paths) {
    try {
      const json = await paymongoRequest<{
        data?: {
          id?: string;
          attributes?: {
            reference_number?: string;
            remarks?: string;
            metadata?: Record<string, string>;
          };
        };
      }>({ method: "GET", path });
      const parsed = parsePaymongoLinkPayload(json);
      if (parsed) return parsed;
    } catch (err) {
      logger.warn("PayMongo link lookup failed", {
        path,
        err: err instanceof Error ? err.message : err,
      });
    }
  }

  return null;
}

/** Fetch a paid payment and resolve its link reference (for link-origin checkouts). */
export async function getPaymongoPaymentReference(
  paymentId: string,
): Promise<string | undefined> {
  const id = paymentId.trim();
  if (!id) return undefined;

  const json = await paymongoRequest<{
    data?: {
      attributes?: {
        external_reference_number?: string;
        origin?: string;
        metadata?: Record<string, string>;
      };
    };
  }>({
    method: "GET",
    path: `/v1/payments/${encodeURIComponent(id)}`,
  });

  const attrs = json.data?.attributes;
  if (!attrs || String(attrs.origin || "") !== "links") return undefined;

  const ref =
    String(
      attrs.external_reference_number ||
        attrs.metadata?.pm_reference_number ||
        "",
    ).trim();
  return ref ? normalizePaymongoReference(ref) : undefined;
}
