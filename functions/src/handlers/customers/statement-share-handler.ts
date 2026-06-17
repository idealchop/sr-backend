import { Request, Response } from "express";
import { StatementShareService } from "../../services/customers/statement-share-service";
import {
  logger,
  logAuditEvent,
} from "../../services/observability/logging/logger";

export const statementShareHandler = {
  /**
   * POST /business/:businessId/customers/statement-share
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async createStatementShare(req: Request, res: Response) {
    const { businessId } = req.params;
    const user = (req as any).user;
    try {
      const body = req.body as {
        type?: string;
        data?: Record<string, unknown>;
      };
      if (
        body.type !== "transactionRecords" ||
        !body.data ||
        typeof body.data !== "object"
      ) {
        return res
          .status(400)
          .json({ error: "Invalid payload: expected transactionRecords" });
      }

      const id = await StatementShareService.create(businessId, user.uid, {
        type: "transactionRecords",
        data: body.data,
      });

      await logAuditEvent(
        "STATEMENT_SHARED",
        {
          businessId,
          userId: user.uid,
          statementShareId: id,
          customerId: (body.data.customer as { id?: string } | undefined)?.id,
        },
        null,
        null,
      );

      return res.status(201).json({ data: { id } });
    } catch (error) {
      logger.error("Error creating statement share", error);
      return res.status(500).json({ error: "Failed to create share link" });
    }
  },

  /**
   * GET /public/statement/:id — public, no auth
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getStatementSharePublic(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const record = await StatementShareService.getById(id);
      if (!record) {
        return res.status(404).json({ error: "Statement not found" });
      }
      return res.json({ data: record });
    } catch (error) {
      logger.error(`Error reading public statement ${req.params.id}`, error);
      return res.status(500).json({ error: "Failed to load statement" });
    }
  },
};
