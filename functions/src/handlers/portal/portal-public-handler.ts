import { Request, Response } from "express";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../../services/observability/logging/logger";
import { QrCustomerService } from "../../services/customers/qr-customer-service";
import { PortalBusinessProfileService } from "../../services/portal/portal-business-profile-service";
import { CustomerService } from "../../services/customers/customer-service";
import {
  businessHasActiveContainerCustodyAgreement,
  customerNeedsContainerCustodyAcceptance,
  normalizeCustomerContainerCustodyAgreement,
  resolveBusinessContainerCustodyAgreement,
} from "../../services/customers/container-custody-agreement";
import { buildDefaultContainerCustodyAgreementPdf } from "../../services/customers/container-custody-agreement-pdf";

function parseQueryString(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

function resolvePublicApiBase(req: Request): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api";
}

/**
 * JSON body may send ids as strings or occasionally other primitives.
 * @param {unknown} v
 * @return {string}
 */
function parseBodyString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

export const getQrPng = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const customerId = parseQueryString(req.query.c);
  const token = parseQueryString(req.query.t);
  if (!businessId || !customerId || !token) {
    return res.status(400).send("Missing b, c, or t");
  }
  try {
    const png = await QrCustomerService.renderQrPng(
      businessId,
      customerId,
      token,
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
  } catch (e: any) {
    const code = e?.message;
    if (code === "INVALID_TOKEN" || code === "NOT_FOUND") {
      return res.status(404).send("Not found");
    }
    if (code === "INACTIVE_CUSTOMER") {
      return res.status(403).send("Inactive");
    }
    logger.error("getQrPng failed", e);
    return res.status(500).send("Error");
  }
};

export const getPortalCustomerContext = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const customerId = parseQueryString(req.query.c);
  const token = parseQueryString(req.query.t);

  if (!businessId) {
    return res.status(400).json({ error: "Missing business ID (b)" });
  }

  try {
    let customer: any = null;
    if (customerId && token) {
      customer = await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );
    }

    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const biz = bizSnap.data();
    if (!bizSnap.exists) {
      return res.status(404).json({ error: "Station not found" });
    }

    // Fetch Inventory Items (filtered to basic info)
    const inventorySnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("inventory_items")
      .get();
    const inventory = inventorySnap.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name,
      categoryId: doc.data().categoryId,
    }));

    // Fetch Active Transactions for monitoring (only if we have a customer)
    let activeTransactions: any[] = [];
    if (customerId) {
      const txSnap = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", customerId)
        .where("deliveryStatus", "in", [
          "pending",
          "in-transit",
          "delivered",
          "collected",
        ])
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();
      activeTransactions = txSnap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          referenceId: d.referenceId,
          type: d.type,
          deliveryStatus: d.deliveryStatus,
          totalAmount: d.totalAmount,
          scheduledAt: d.scheduledAt,
        };
      });
    }

    const paymentSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info")
      .get();
    const paymentAccounts = paymentSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        bankName: d.bankName || "",
        accountName: d.accountName || "",
        accountNumber: d.accountNumber || "",
        type: d.type || "bank_transfer",
        qrCode: d.qrCode || undefined,
      };
    });

    const first = (customer?.name || "Suki").split(/\s+/)[0];
    const resolvedCustody = resolveBusinessContainerCustodyAgreement(
      businessId,
      biz?.containerCustodyAgreement,
      resolvePublicApiBase(req),
    );
    const customerCustody = customer ?
      normalizeCustomerContainerCustodyAgreement(
        customer.containerCustodyAgreement,
      ) :
      null;
    const needsCustodyAcceptance = customer ?
      customerNeedsContainerCustodyAcceptance(customer, biz as Record<string, unknown>) :
      resolvedCustody?.enabled === true;
    const bizLat = biz?.location?.lat ?? biz?.latitude;
    const bizLng = biz?.location?.lng ?? biz?.longitude;
    const businessLocation =
      typeof bizLat === "number" &&
      typeof bizLng === "number" &&
      Number.isFinite(bizLat) &&
      Number.isFinite(bizLng) ?
        {
          latitude: bizLat,
          longitude: bizLng,
          address:
            typeof biz?.location?.address === "string" ?
              biz.location.address :
              typeof biz?.address === "string" ?
                biz.address :
                undefined,
        } :
        null;
    return res.json({
      data: {
        customerId: customerId || "",
        businessId,
        firstName: first,
        name: customer?.name || "",
        email: customer?.email || "",
        phone: customer?.phone || "",
        businessName: biz?.businessName || biz?.name || "Your water station",
        businessLogo: typeof biz?.logo === "string" ? biz.logo : null,
        businessLocation,
        address: customer?.address || "",
        latitude: customer?.latitude,
        longitude: customer?.longitude,
        sukiType: customer?.sukiType || "personal",
        companyName: customer?.companyName || "",
        pricing: customer?.pricing || {},
        qrCodeUrl: customer?.qrCodeUrl,
        portalDeepLink: customer?.portalDeepLink,
        inventory,
        waterTypes: (biz?.waterTypes || []).map((w: any) =>
          typeof w === "string" ? { id: w, name: w } : w,
        ),
        activeTransactions,
        paymentAccounts,
        qrWalkInEnabled: biz?.qrWalkInEnabled === true,
        isDeliveryEnabled: customer?.isDeliveryEnabled === true,
        isCollectionEnabled: customer?.isCollectionEnabled === true,
        deliveryConfig: customer?.deliveryConfig ?? null,
        collectionConfig: customer?.collectionConfig ?? null,
        containerCustodyAgreement: resolvedCustody ?
          {
            enabled: true,
            documentUrl: resolvedCustody.documentUrl,
            version: resolvedCustody.version,
            source: resolvedCustody.source,
            needsAcceptance: needsCustodyAcceptance,
            accepted: customerCustody,
          } :
          null,
        containerPolicy: customer?.containerPolicy ?? "unspecified",
        possession: customer?.possession ?? {},
        containerDefaultPolicy: biz?.containerDefaultPolicy ?? "byog",
        deliveryInventorySalesEnabled:
          biz?.deliveryInventorySalesEnabled === true,
      },
    });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid or expired link" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    if (e?.message === "INACTIVE_CUSTOMER") {
      return res.status(403).json({ error: "Account inactive" });
    }
    logger.error("getPortalCustomerContext failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getPortalBusinessProfile = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  if (!businessId) {
    return res.status(400).json({ error: "Missing business ID (b)" });
  }

  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.max(
    1,
    Number.parseInt(String(req.query.pageSize ?? "5"), 10) || 5,
  );

  try {
    const profile = await PortalBusinessProfileService.getPublicProfile({
      businessId,
      page,
      pageSize,
    });
    if (!profile) {
      return res.status(404).json({ error: "Station not found" });
    }
    return res.json({ data: profile });
  } catch (e) {
    logger.error("getPortalBusinessProfile failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const cancelPortalOrder = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.body?.businessId);
  const customerId = parseQueryString(req.body?.customerId) || "";
  const token = parseQueryString(req.body?.token) || "";
  const referenceId = parseQueryString(req.body?.referenceId);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!businessId || !referenceId) {
    return res
      .status(400)
      .json({ error: "businessId and referenceId are required" });
  }
  if (!reason || reason.length < 3) {
    return res
      .status(400)
      .json({ error: "A cancellation reason (min 3 characters) is required." });
  }

  try {
    // Validate token if provided (authenticated customer)
    if (customerId && token) {
      await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );
    }

    // Find the submission by referenceId
    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();

    if (subSnap.empty) {
      return res.status(404).json({ error: "Order not found" });
    }

    const subDoc = subSnap.docs[0];
    const sub = subDoc.data();

    // Only allow cancellation of pending orders
    if (sub.status !== "pending_review") {
      return res.status(409).json({
        error:
          "This order can no longer be cancelled. Current status: " +
          sub.status,
      });
    }

    await subDoc.ref.update({
      status: "cancelled",
      rejectReason: `CANCEL_REQUEST: ${reason}`.slice(0, 500),
      processedAt: FieldValue.serverTimestamp(),
    });

    logger.info("portal order cancelled by customer", {
      businessId,
      referenceId,
      reason,
    });
    return res.json({ success: true });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    logger.error("cancelPortalOrder failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

/** Default or station-branded container custody agreement PDF (Smart Refill template). */
export const getContainerCustodyAgreementPdf = async (
  req: Request,
  res: Response,
) => {
  const businessId = parseQueryString(req.query.b);
  if (!businessId) {
    return res.status(400).json({ error: "Missing business ID (b)" });
  }

  try {
    const bizSnap = await db.collection("businesses").doc(businessId).get();
    if (!bizSnap.exists) {
      return res.status(404).json({ error: "Station not found" });
    }
    const biz = bizSnap.data() || {};
    if (!businessHasActiveContainerCustodyAgreement(biz)) {
      return res.status(404).json({
        error: "Container custody agreement is not enabled for this station.",
      });
    }
    const stationName = String(biz.businessName || biz.name || "Water Refilling Station");
    const pdf = await buildDefaultContainerCustodyAgreementPdf({ stationName });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="container-custody-${businessId}.pdf"`,
    );
    return res.send(pdf);
  } catch (e) {
    logger.error("getContainerCustodyAgreementPdf failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

/** NT-35 — update customer portal notification preferences. */
export const patchPortalCustomerProfile = async (req: Request, res: Response) => {
  const businessId = parseBodyString(req.body?.businessId ?? req.query.b);
  const customerId = parseBodyString(req.body?.customerId ?? req.query.c);
  const token = parseBodyString(req.body?.token ?? req.query.t);

  if (!businessId || !customerId || !token) {
    return res.status(400).json({ error: "businessId, customerId, and token are required" });
  }

  try {
    await QrCustomerService.assertValidPortalToken(businessId, customerId, token);

    const updates: Record<string, unknown> = {};
    if (typeof req.body?.portalEmailNotifications === "boolean") {
      updates.portalEmailNotifications = req.body.portalEmailNotifications;
    }
    if (typeof req.body?.portalSmsOptIn === "boolean") {
      updates.portalSmsOptIn = req.body.portalSmsOptIn;
    }
    if (typeof req.body?.portalWebPushEnabled === "boolean") {
      updates.portalWebPushEnabled = req.body.portalWebPushEnabled;
    }
    if (typeof req.body?.portalWebPushToken === "string" && req.body.portalWebPushToken.trim()) {
      updates.portalWebPushTokens = FieldValue.arrayUnion(
        req.body.portalWebPushToken.trim(),
      );
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid preference fields" });
    }

    await CustomerService.updateCustomer(
      businessId,
      customerId,
      updates as Partial<import("../../services/customers/customer-service").Customer>,
    );

    return res.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    logger.error("patchPortalCustomerProfile failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};
