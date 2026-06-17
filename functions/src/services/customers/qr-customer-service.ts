import crypto from "crypto";
import type { Request } from "express";
import QRCode from "qrcode";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService, Customer } from "./customer-service";

/**
 * Builds public API base URL for QR image and portal callbacks.
 * @param {Request} req The incoming request
 * @return {string} The public API base URL
 */
export function getApiPublicBase(req: Request): string {
  const fromEnv = process.env.API_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host =
    req.get("x-forwarded-host") || req.get("host") || "localhost:5001";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}`.replace(/\/$/, "");
}

/**
 * Deep link encoded inside customer QR codes (login-free portal).
 * @return {string} The portal app base URL
 */
export function getPortalAppBase(): string {
  return (process.env.PORTAL_APP_BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function buildPortalDeepLink(
  businessId: string,
  customerId: string,
  token: string,
): string {
  const base = getPortalAppBase();
  const u = new URL("/order", base);
  u.searchParams.set("b", businessId);
  u.searchParams.set("c", customerId);
  u.searchParams.set("t", token);
  return u.toString();
}

/**
 * Builds a public QR image URL.
 * @param {Request} req The request
 * @param {string} businessId The business ID
 * @param {string} customerId The customer ID
 * @param {string} token The QR token
 * @return {string} The QR image URL
 */
export function buildQrImageUrl(
  req: Request,
  businessId: string,
  customerId: string,
  token: string,
): string {
  const api = getApiPublicBase(req);
  const u = new URL("/public/qr.png", api);
  u.searchParams.set("b", businessId);
  u.searchParams.set("c", customerId);
  u.searchParams.set("t", token);
  return u.toString();
}

export class QrCustomerService {
  /**
   * Rotates QR token and updates qrCodeUrl + lastUpdated on the customer document.
   * @param {string} businessId The business ID
   * @param {string} customerId The customer ID
   * @param {Request} req The request
   * @return {Promise<void>}
   */
  static async rotateCustomerQr(
    businessId: string,
    customerId: string,
    req: Request,
  ): Promise<void> {
    const token = crypto.randomBytes(24).toString("hex");
    const lastUpdated = new Date().toISOString();
    const deepLink = buildPortalDeepLink(businessId, customerId, token);
    const qrCodeUrl = buildQrImageUrl(req, businessId, customerId, token);

    await db
      .collection("businesses")
      .doc(businessId)
      .collection("customers")
      .doc(customerId)
      .update({
        qrToken: token,
        qrCodeUrl,
        portalDeepLink: deepLink,
        lastUpdated,
        updatedAt: FieldValue.serverTimestamp(),
      });

    logger.info("Customer QR rotated", { businessId, customerId });
  }

  static async assertValidPortalToken(
    businessId: string,
    customerId: string,
    token: string,
  ): Promise<Customer> {
    const customer = await CustomerService.getCustomer(businessId, customerId);
    if (!customer) {
      throw new Error("NOT_FOUND");
    }
    if (!customer.qrToken || customer.qrToken !== token) {
      throw new Error("INVALID_TOKEN");
    }
    if (customer.status === "inactive") {
      throw new Error("INACTIVE_CUSTOMER");
    }
    return customer;
  }

  /**
   * Renders a PNG for the customer's current portal deep link (validates token first).
   * @param {string} businessId The business ID
   * @param {string} customerId The customer ID
   * @param {string} token The QR token
   * @return {Promise<Buffer>} The QR PNG buffer
   */
  static async renderQrPng(
    businessId: string,
    customerId: string,
    token: string,
  ): Promise<Buffer> {
    await QrCustomerService.assertValidPortalToken(
      businessId,
      customerId,
      token,
    );
    const deepLink = buildPortalDeepLink(businessId, customerId, token);
    return QRCode.toBuffer(deepLink, {
      type: "png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  }
}
