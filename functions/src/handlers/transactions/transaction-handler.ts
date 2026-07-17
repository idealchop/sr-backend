import { Request, Response } from "express";
import {
  TransactionService,
  InsufficientStockError,
} from "../../services/transactions/transaction-service";
import { SyncConflictError } from "../../services/transactions/sync-conflict";
import { logger } from "../../services/observability/logging/logger";
import { maybeSendCustomerTxnNotification } from "../../services/portal/customer-transaction-notifier";

import {
  claimNearbyStopForRider,
  ClaimNearbyStopError,
} from "../../services/transactions/claim-nearby-stop-service";

export const transactionHandler = {
  async listTransactions(req: Request, res: Response) {
    try {
      const { businessId } = req.params;
      const { limit, offset, customerId, startDate, endDate, orderBy } = req.query;
      const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
      const safeLimit = Number.isFinite(parsedLimit) ?
        Math.max(1, Math.min(parsedLimit, 5000)) :
        50;
      const orderField =
        orderBy === "createdAt" || orderBy === "scheduledAt" ?
          orderBy :
          undefined;
      const transactions = await TransactionService.getTransactionsByBusiness(
        businessId,
        {
          limit: safeLimit,
          offset: offset ? parseInt(offset as string, 10) : 0,
          customerId: customerId as string | undefined,
          startDate: typeof startDate === "string" ? startDate : undefined,
          endDate: typeof endDate === "string" ? endDate : undefined,
          orderBy: orderField,
        },
      );
      res.json({ data: transactions });
    } catch (error) {
      logger.error("Error listing transactions", error);
      res.status(500).json({ error: "Failed to list transactions" });
    }
  },

  async getTransaction(req: Request, res: Response) {
    try {
      const { businessId, id } = req.params;
      const transaction = await TransactionService.getTransaction(
        businessId,
        id,
      );
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json({ data: transaction });
    } catch (error) {
      logger.error("Error getting transaction", error);
      res.status(500).json({ error: "Failed to get transaction" });
    }
  },

  async createTransaction(req: Request, res: Response) {
    const { businessId } = req.params;
    const user = (req as any).user;
    const actorName =
      typeof user?.name === "string" ?
        user.name :
        typeof user?.displayName === "string" ?
          user.displayName :
          undefined;
    try {
      const { transaction, created } = await TransactionService.addTransaction(
        businessId,
        req.body,
        user?.uid,
        actorName,
      );

      res.status(created ? 201 : 200).json({
        data: transaction,
        idempotent: !created,
      });
    } catch (error: any) {
      if (error instanceof InsufficientStockError) {
        return res.status(400).json({
          error: "INSUFFICIENT_STOCK",
          message: error.message,
          items: error.items,
        });
      }
      logger.error("Error creating transaction", error);
      const message =
        error instanceof Error ? error.message : "Failed to create transaction";
      res.status(500).json({
        error: "Failed to create transaction",
        message,
      });
    }
  },

  async claimNearbyStop(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const user = (req as { user?: { uid: string } }).user;
    const businessRole = (req as { businessRole?: string }).businessRole;
    const riderLat = Number(req.body?.riderLat);
    const riderLng = Number(req.body?.riderLng);
    if (!user?.uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await claimNearbyStopForRider({
        businessId,
        transactionId: id,
        claimerUid: user.uid,
        claimerBusinessRole: businessRole || "member",
        riderLat,
        riderLng,
      });
      res.json({ success: true });
    } catch (error: unknown) {
      if (error instanceof ClaimNearbyStopError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      logger.error("Error claiming nearby stop", error);
      res.status(500).json({ error: "Failed to claim nearby stop" });
    }
  },

  async updateTransaction(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const user = (req as any).user;
    const actorName =
      typeof user?.name === "string" ?
        user.name :
        typeof user?.displayName === "string" ?
          user.displayName :
          undefined;
    try {
      const before = await TransactionService.getTransaction(businessId, id);
      const applied = await TransactionService.updateTransaction(
        businessId,
        id,
        req.body,
        user?.uid,
        actorName,
      );

      // NT-33 — staff ledger terminal delivery/collection/walk-in customer receipt
      if (before && applied) {
        const after = await TransactionService.getTransaction(businessId, id);
        const terminal = new Set(["delivered", "collected", "completed"]);
        const becameTerminal =
          after?.deliveryStatus &&
          terminal.has(after.deliveryStatus) &&
          !terminal.has(String(before.deliveryStatus || ""));
        const becamePaid =
          (after?.paymentStatus || "").toLowerCase() === "paid" &&
          (before.paymentStatus || "").toLowerCase() !== "paid";
        const walkInType =
          after?.type === "walkin" || after?.type === "direct_sale";

        if (
          after &&
          ((becameTerminal &&
            (after.type === "delivery" || after.type === "collection")) ||
            (becamePaid && walkInType))
        ) {
          void maybeSendCustomerTxnNotification({
            businessId,
            transaction: { ...after, id },
            beforeStatus: before.deliveryStatus,
            event: "completed",
          }).catch((err) => {
            logger.warn("customer_txn_notification_handler_failed", {
              businessId,
              transactionId: id,
              err,
            });
          });
        }
      }

      res.json({ success: true, idempotent: !applied });
    } catch (error) {
      if (error instanceof SyncConflictError) {
        return res.status(409).json({
          error: "SYNC_CONFLICT",
          conflict: true,
          data: error.serverTransaction,
        });
      }
      logger.error("Error updating transaction", error);
      res.status(500).json({ error: "Failed to update transaction" });
    }
  },

  /**
   * DELETE /business/:businessId/transactions/:id
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async deleteTransaction(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const user = (req as any).user;
    const actorName =
      typeof user?.name === "string" ?
        user.name :
        typeof user?.displayName === "string" ?
          user.displayName :
          undefined;
    try {
      await TransactionService.deleteTransaction(
        businessId,
        id,
        user?.uid,
        actorName,
      );

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Error deleting transaction", error);
      res.status(500).json({
        error: "Failed to delete transaction",
        message: error.message,
      });
    }
  },
  async getTransactionHistory(req: Request, res: Response) {
    try {
      const { businessId, id } = req.params;
      const history = await TransactionService.getTransactionHistory(
        businessId,
        id,
      );
      res.json({ data: history });
    } catch (error) {
      logger.error(
        `Error getting history for transaction ${req.params.id}`,
        error,
      );
      res.status(500).json({ error: "Failed to get transaction history" });
    }
  },
};
