import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { readPlantConfig } from "../../utils/plant-staff-token";
import { WaterQualityLogService } from "../plant/water-quality-log-service";
import { manilaDateKey } from "../../utils/philippine-datetime";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";
import { resolveQuietHoursFromUiConfig } from "../../utils/notification-preferences";

const DEFAULT_QUALITY_LOG_STALE_DAYS = 7;
const TDS_CONSECUTIVE_FAIL_COUNT = 3;

export type PlantAlertResult = {
  contributorId: string;
  sent: boolean;
  detail?: Record<string, unknown>;
};

async function sendPlantOwnerPush(
  businessId: string,
  uiConfig: Record<string, unknown>,
  copy: { title: string; body: string; deepLink: string; type: string },
  lastSentField: string,
  now: Date,
): Promise<boolean> {
  const devices = await listOwnerDevices(businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) return false;

  const quietHours = resolveQuietHoursFromUiConfig(uiConfig);
  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: copy.type,
      businessId,
      deepLink: copy.deepLink,
    },
  }, {
    quietHoursStart: quietHours.start,
    quietHoursEnd: quietHours.end,
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(businessId, invalidTokens);
  }

  if (successCount > 0) {
    await db.collection("businesses").doc(businessId).set(
      {
        [lastSentField]: manilaDateKey(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  }
  return false;
}

/** NT-60 — product TDS above threshold for 3 consecutive readings. */
export async function sendTdsThresholdAlertForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult> {
  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) {
    return { contributorId: "plant_tds_threshold", sent: false };
  }

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.plantTdsPushEnabled === false) {
    return { contributorId: "plant_tds_threshold", sent: false };
  }

  const lastSent =
    typeof data.plantTdsPushLastSentDate === "string" ?
      data.plantTdsPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) {
    return { contributorId: "plant_tds_threshold", sent: false };
  }

  const plantConfig = readPlantConfig(data);
  const maxTds = Number(plantConfig.tdsMaxProduct);
  if (!Number.isFinite(maxTds)) {
    return { contributorId: "plant_tds_threshold", sent: false };
  }

  const logs = await WaterQualityLogService.list(businessId, 6);
  const productLogs = logs.filter((l) => l.locationTag === "product");
  if (productLogs.length < TDS_CONSECUTIVE_FAIL_COUNT) {
    return { contributorId: "plant_tds_threshold", sent: false };
  }

  const recent = productLogs.slice(0, TDS_CONSECUTIVE_FAIL_COUNT);
  const allHigh = recent.every((l) => l.tdsPpm > maxTds);
  if (!allHigh) return { contributorId: "plant_tds_threshold", sent: false };

  const sent = await sendPlantOwnerPush(
    businessId,
    uiConfig,
    {
      title: "Product TDS high",
      body:
        `Last ${TDS_CONSECUTIVE_FAIL_COUNT} readings exceeded ${maxTds} ppm — ` +
        "check filtration and log corrective action.",
      deepLink: "/inventory",
      type: "plant_tds_threshold",
    },
    "plantTdsPushLastSentDate",
    now,
  );

  return {
    contributorId: "plant_tds_threshold",
    sent,
    detail: { maxTds, latestTds: recent[0]?.tdsPpm },
  };
}

/** NT-61 — tank level crosses configured min/max (latest manual/IoT log). */
export async function sendTankLevelAlertForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult> {
  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.tankLevelPushEnabled !== true) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const plantRaw = (data.plantConfig ?? {}) as Record<string, unknown>;
  const tankMin = Number(plantRaw.tankLevelMinPct);
  const tankMax = Number(plantRaw.tankLevelMaxPct);
  if (!Number.isFinite(tankMin) && !Number.isFinite(tankMax)) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const lastSent =
    typeof data.tankLevelPushLastSentDate === "string" ?
      data.tankLevelPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const tankSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("tank_level_logs")
    .orderBy("recordedAt", "desc")
    .limit(1)
    .get();

  if (tankSnap.empty) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const latest = tankSnap.docs[0].data();
  const levelPct = Number(latest.levelPct);
  if (!Number.isFinite(levelPct)) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const tooLow = Number.isFinite(tankMin) && levelPct < tankMin;
  const tooHigh = Number.isFinite(tankMax) && levelPct > tankMax;
  if (!tooLow && !tooHigh) {
    return { contributorId: "plant_tank_level", sent: false };
  }

  const sent = await sendPlantOwnerPush(
    businessId,
    uiConfig,
    {
      title: tooLow ? "Tank level low" : "Tank level high",
      body: `Storage tank at ${Math.round(levelPct)}% — review plant ops.`,
      deepLink: "/inventory",
      type: "plant_tank_level",
    },
    "tankLevelPushLastSentDate",
    now,
  );

  return {
    contributorId: "plant_tank_level",
    sent,
    detail: { levelPct, tooLow, tooHigh },
  };
}

/** NT-62 — high-severity plant downtime logged in last 24h. */
export async function sendPlantDowntimeAlertForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult> {
  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) {
    return { contributorId: "plant_downtime", sent: false };
  }

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.plantDowntimePushEnabled === false) {
    return { contributorId: "plant_downtime", sent: false };
  }

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("plant_downtime")
    .where("severity", "==", "high")
    .orderBy("startedAt", "desc")
    .limit(3)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) {
    return { contributorId: "plant_downtime", sent: false };
  }

  const recent = snap.docs.find((doc) => {
    const started = doc.data().startedAt;
    const d =
      started?.toDate ?
        started.toDate() as Date :
        new Date(String(started || ""));
    return d >= since;
  });
  if (!recent) return { contributorId: "plant_downtime", sent: false };

  const reason = String(recent.data().reason || "Plant downtime logged");
  const sent = await sendPlantOwnerPush(
    businessId,
    uiConfig,
    {
      title: "Plant downtime",
      body: reason.slice(0, 180),
      deepLink: "/inventory",
      type: "plant_downtime",
    },
    "plantDowntimePushLastSentDate",
    now,
  );

  return {
    contributorId: "plant_downtime",
    sent,
    detail: { downtimeId: recent.id },
  };
}

/** NT-63 — reminder when no water quality log within N days. */
export async function sendWaterQualityStaleAlertForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult> {
  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) {
    return { contributorId: "plant_quality_stale", sent: false };
  }

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.plantQualityReminderPushEnabled === false) {
    return { contributorId: "plant_quality_stale", sent: false };
  }

  const staleDays = Number(uiConfig.plantQualityLogStaleDays);
  const threshold =
    Number.isFinite(staleDays) && staleDays >= 1 ?
      Math.round(staleDays) :
      DEFAULT_QUALITY_LOG_STALE_DAYS;

  const lastSent =
    typeof data.plantQualityStalePushLastSentWeek === "string" ?
      data.plantQualityStalePushLastSentWeek :
      undefined;
  if (lastSent === manilaDateKey(now)) {
    return { contributorId: "plant_quality_stale", sent: false };
  }

  const logs = await WaterQualityLogService.list(businessId, 1);
  if (logs.length > 0) {
    const recorded = new Date(logs[0].recordedAt);
    const daysSince = Math.floor(
      (now.getTime() - recorded.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSince < threshold) {
      return { contributorId: "plant_quality_stale", sent: false };
    }
  }

  const sent = await sendPlantOwnerPush(
    businessId,
    uiConfig,
    {
      title: "Water quality log due",
      body:
        `No TDS/pH log in ${threshold}+ days — record a product reading in Plant ops.`,
      deepLink: "/inventory",
      type: "plant_quality_stale",
    },
    "plantQualityStalePushLastSentWeek",
    now,
  );

  return {
    contributorId: "plant_quality_stale",
    sent,
    detail: { staleDays: threshold },
  };
}

/** NT-64 — stub when plant_health AI brief is available (wired via morning brief job). */
export async function sendPlantHealthBriefAlertForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult> {
  // MP-08 / NT-64: extend morning-brief-scheduler when plant_health auto-run ships.
  logger.debug("plant_health_brief_delivery_stub", { businessId, at: now.toISOString() });
  return { contributorId: "plant_health_brief", sent: false };
}

/** Run NT-60–64 plant alert contributors for one business. */
export async function runPlantAlertsForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PlantAlertResult[]> {
  const results = await Promise.all([
    sendTdsThresholdAlertForBusiness(businessId, now),
    sendTankLevelAlertForBusiness(businessId, now),
    sendPlantDowntimeAlertForBusiness(businessId, now),
    sendWaterQualityStaleAlertForBusiness(businessId, now),
    sendPlantHealthBriefAlertForBusiness(businessId, now),
  ]);
  return results;
}
