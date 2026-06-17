import { Request, Response } from "express";
import { logger } from "firebase-functions";
import {
  submitInquiryLead,
  submitPartnerApplicationLead,
  submitRequestDemoLead,
} from "../services/marketing/marketing-lead-service";

function parseString(v: unknown, max = 500): string {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function parseEmail(v: unknown): string {
  const email = parseString(v, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email address");
  }
  return email;
}

function parseStringArray(v: unknown, maxItems = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => parseString(item, 120))
    .filter(Boolean)
    .slice(0, maxItems);
}

function handleError(res: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Submission failed";
  logger.error("Marketing handler error", error);
  const status = message.includes("Invalid") ? 400 : 500;
  res.status(status).json({ error: message });
}

export async function postRequestDemo(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = req.body ?? {};
    const name = parseString(body.name, 120);
    const email = parseEmail(body.email);
    const phone = parseString(body.phone, 40);
    const businessName = parseString(body.businessName, 200);
    const stationCount =
      body.stationCount !== undefined && body.stationCount !== "" ?
        parseString(body.stationCount, 20) :
        undefined;
    const requestedDate = parseString(body.requestedDate, 40) || undefined;

    if (!name || !phone || !businessName) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    await submitRequestDemoLead({
      name,
      email,
      phone,
      businessName,
      stationCount,
      requestedDate,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
}

export async function postInquiry(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const firstName = parseString(body.firstName, 80);
    const lastName = parseString(body.lastName, 80);
    const email = parseEmail(body.email);
    const phone = parseString(body.phone, 40);
    const company = parseString(body.company ?? body.businessName, 200);
    const businessAddress = parseString(
      body.businessAddress ?? body.address,
      300,
    );
    const message = parseString(body.message, 4000) || "No message provided";

    if (!firstName || !lastName || !phone || !company || !businessAddress) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    await submitInquiryLead({
      firstName,
      lastName,
      email,
      phone,
      company,
      businessAddress,
      message,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
}

export async function postPartnerApplication(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = req.body ?? {};
    const firstName = parseString(body.firstName, 80);
    const lastName = parseString(body.lastName, 80);
    const email = parseEmail(body.email);
    const phone = parseString(body.phone, 40);
    const stationName = parseString(body.stationName, 200);
    const address = parseString(body.address, 300);
    const waterTypes = parseStringArray(body.waterTypes).join(", ") || "—";
    const deliveryVehicles =
      parseStringArray(body.deliveryVehicles).join(", ") || "—";
    const preferredClients =
      parseStringArray(body.preferredClients).join(", ") || "—";

    if (!firstName || !lastName || !phone || !stationName || !address) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const lat = body.latitude ?? body.coordinates?.lat;
    const lng = body.longitude ?? body.coordinates?.lng;

    await submitPartnerApplicationLead({
      firstName,
      lastName,
      email,
      phone,
      stationName,
      address,
      latitude: lat !== undefined ? parseString(lat, 30) : undefined,
      longitude: lng !== undefined ? parseString(lng, 30) : undefined,
      waterTypes,
      hasPermits: parseString(body.hasPermits, 20) || "—",
      stationAge: parseString(body.stationAge, 20) || "—",
      deliveryVehicles,
      productionCapacity: parseString(body.productionCapacity, 40) || "—",
      preferredClients,
      providesContainers: parseString(body.providesContainers, 20) || "—",
      providesDispensers: parseString(body.providesDispensers, 20) || "—",
      onboardingSchedule: parseString(body.onboardingSchedule, 120) || "—",
    });

    res.status(200).json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
}
