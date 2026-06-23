import { db } from "../../config/firebase-admin";
import { formatPhilippineDateTime } from "../../utils/philippine-datetime";
import {
  buildMaintenanceCompliancePdf,
  summarizeQualityForCompliance,
} from "./maintenance-compliance-pdf-service";
import { MaintenanceTemplateService } from "./maintenance-template-service";
import { WaterQualityLogService } from "./water-quality-log-service";

/**
 * MP-15 — aggregate plant compliance data and render audit PDF.
 */
export class MaintenanceComplianceExportService {
  static async buildPdf(
    businessId: string,
    periodDays: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const businessName = String(bizSnap.data()?.name || "Plant");

    const [templates, completions, qualityLogs] = await Promise.all([
      MaintenanceTemplateService.list(businessId),
      MaintenanceTemplateService.listCompletionsSince(businessId, periodDays),
      WaterQualityLogService.listInPeriod(businessId, periodDays),
    ]);

    const overdueTemplates = templates.filter((template) => template.status === "overdue");
    const qualitySummary = summarizeQualityForCompliance(qualityLogs);

    const buffer = await buildMaintenanceCompliancePdf({
      businessName,
      periodDays,
      generatedAt: formatPhilippineDateTime(new Date()),
      completions,
      qualitySummary,
      overdueTemplates,
      recentQualityLogs: qualityLogs.slice(0, 25),
    });

    const safeName = businessName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) ||
      businessId.slice(0, 12);
    return {
      buffer,
      filename: `plant-compliance-${safeName}.pdf`,
    };
  }
}
