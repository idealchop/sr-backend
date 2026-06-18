import {
  getGeminiApiKey,
} from "./gemini-config";
import { geminiGenerateJson } from "./gemini-client";
import { CustomerService } from "../customers/customer-service";
import { InventoryService } from "../inventory/inventory-service";

export type ParsedOrderDraft = {
  customerName?: string;
  customerPhone?: string;
  deliveryRequested: boolean;
  address?: string;
  refillItems: Array<{ type: string; qty: number }>;
  inventoryItems: Array<{ name: string; qty: number }>;
  notes?: string;
  confidence: number;
  clarifyingQuestion?: string;
};

const FALLBACK: ParsedOrderDraft = {
  deliveryRequested: true,
  refillItems: [],
  inventoryItems: [],
  confidence: 0,
  clarifyingQuestion: "Paki-ulit — ilang galon at delivery ba o pickup?",
};

/**
 * AI-04 — parse free-text messenger/order messages into a structured draft.
 */
export async function parseFreeTextOrder(params: {
  businessId: string;
  message: string;
}): Promise<ParsedOrderDraft> {
  const message = params.message.trim().slice(0, 1200);
  if (!message) return { ...FALLBACK };

  const [customers, inventory] = await Promise.all([
    CustomerService.getCustomersByBusiness(params.businessId).then((rows) =>
      rows.slice(0, 40).map((c) => ({
        name: c.name,
        phone: c.phone,
        address: c.address,
      })),
    ),
    InventoryService.listItems(params.businessId).then((rows) =>
      rows.slice(0, 30).map((i) => ({ name: i.name, id: i.id })),
    ),
  ]);

  if (!getGeminiApiKey()) {
    return { ...FALLBACK, clarifyingQuestion: "AI parser not configured on server." };
  }

  const system =
    "You parse Filipino/English free-text water refilling orders for a station. " +
    "Use ONLY customer and SKU names from the JSON context when matching. " +
    "Output STRICT JSON: customerName, customerPhone, deliveryRequested (boolean), " +
    "address, refillItems [{type, qty}], inventoryItems [{name, qty}], notes, " +
    "confidence (0-1), clarifyingQuestion (if confidence < 0.65, short Taglish question). " +
    "Default refill type label is 'refill' when unspecified.";

  const user =
    `Message:\n${message}\n\nCustomers:\n${JSON.stringify(customers)}\n\n` +
    `Inventory:\n${JSON.stringify(inventory)}`;

  const raw = await geminiGenerateJson<ParsedOrderDraft>({
    system,
    user,
    fallback: FALLBACK,
  });

  const confidence = Math.min(1, Math.max(0, Number(raw?.confidence) || 0));
  return {
    customerName: typeof raw?.customerName === "string" ? raw.customerName.trim() : undefined,
    customerPhone: typeof raw?.customerPhone === "string" ? raw.customerPhone.trim() : undefined,
    deliveryRequested: raw?.deliveryRequested !== false,
    address: typeof raw?.address === "string" ? raw.address.trim() : undefined,
    refillItems: Array.isArray(raw?.refillItems) ?
      raw!.refillItems
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          type: String((r as { type?: string }).type || "refill").slice(0, 40),
          qty: Math.max(1, Math.round(Number((r as { qty?: number }).qty) || 1)),
        }))
        .slice(0, 8) :
      [],
    inventoryItems: Array.isArray(raw?.inventoryItems) ?
      raw!.inventoryItems
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          name: String((r as { name?: string }).name || "").slice(0, 60),
          qty: Math.max(1, Math.round(Number((r as { qty?: number }).qty) || 1)),
        }))
        .slice(0, 8) :
      [],
    notes: typeof raw?.notes === "string" ? raw.notes.trim().slice(0, 200) : undefined,
    confidence,
    clarifyingQuestion:
      typeof raw?.clarifyingQuestion === "string" ?
        raw.clarifyingQuestion.trim().slice(0, 200) :
        confidence < 0.65 ?
          FALLBACK.clarifyingQuestion :
          undefined,
  };
}
