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
