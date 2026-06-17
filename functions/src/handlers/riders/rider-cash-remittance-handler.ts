import { Request, Response } from "express";
import {
  RiderCashRemittanceService,
} from "../../services/riders/rider-cash-remittance-service";
import { logger, logAuditEvent } from "../../services/observability/logging/logger";

export const riderCashRemittanceHandler = {
  async listByDate(req: Request, res: Response) {
    const { businessId } = req.params;
    const remittanceDate = String(req.query.date ?? "").trim();
    const fromDate = String(req.query.from ?? "").trim();
    const toDate = String(req.query.to ?? "").trim();

    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        return res.status(400).json({
          error: "Both from and to query parameters are required (YYYY-MM-DD)",
        });
      }
      try {
        const data = await RiderCashRemittanceService.listBetween(
          businessId,
          fromDate,
          toDate,
        );
        return res.json({ data });
      } catch (error: any) {
        if (error?.message === "INVALID_DATE") {
          return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
        }
        if (error?.message === "INVALID_RANGE") {
          return res.status(400).json({ error: "from must be on or before to." });
        }
        logger.error("Error listing rider cash remittances in range", error);
        return res.status(500).json({ error: "Failed to list cash remittances" });
      }
    }

    if (!remittanceDate) {
      return res.status(400).json({ error: "date query parameter is required (YYYY-MM-DD)" });
    }

    try {
      const data = await RiderCashRemittanceService.listByDate(businessId, remittanceDate);
      res.json({ data });
    } catch (error: any) {
      if (error?.message === "INVALID_DATE") {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      }
      logger.error("Error listing rider cash remittances", error);
      res.status(500).json({ error: "Failed to list cash remittances" });
    }
  },

  async acceptRemittance(req: Request, res: Response) {
    const { businessId, id: riderId } = req.params;
    const user = (req as any).user;
    const businessRole = (req as { businessRole?: string }).businessRole;
    const { date, amount, recordedFromOrders } = req.body ?? {};

    if (businessRole !== "owner") {
      return res.status(403).json({
        error: "Only the workspace owner can accept rider cash.",
      });
    }

    if (!date || typeof date !== "string") {
      return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    }
    if (amount == null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ error: "amount is required" });
    }

    try {
      const remittance = await RiderCashRemittanceService.acceptRemittance(
        businessId,
        riderId,
        {
          remittanceDate: date.trim(),
          amountAccepted: Number(amount),
          recordedFromOrders:
            recordedFromOrders != null ? Number(recordedFromOrders) : undefined,
          acceptedByUserId: user.uid,
        },
      );

      await logAuditEvent(
        "RIDER_CASH_REMITTANCE_ACCEPTED",
        {
          businessId,
          userId: user.uid,
          riderId,
          remittanceDate: date,
          amountAccepted: remittance.amountAccepted,
        },
        null,
        remittance,
      );

      res.json({ data: remittance });
    } catch (error: any) {
      if (error?.message === "INVALID_DATE") {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      }
      if (error?.message === "INVALID_AMOUNT") {
        return res.status(400).json({ error: "Amount must be zero or greater." });
      }
      if (error?.message === "RIDER_NOT_FOUND") {
        return res.status(404).json({ error: "Rider not found" });
      }
      logger.error("Error accepting rider cash remittance", error);
      res.status(500).json({ error: "Failed to accept cash remittance" });
    }
  },
};
