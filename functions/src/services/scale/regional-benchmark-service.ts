import { db } from "../../config/firebase-admin";

export type RegionalBenchmarkCohort = {
  regionKey: string;
  stationCount: number;
  optInRequired: boolean;
  metrics: {
    dormantPctMedian: number | null;
    gallonsPerSukiMedian: number | null;
    acceptanceRateMedian: number | null;
  };
};

const K_ANONYMITY = 5;

/**
 * SC-08 — opt-in regional benchmark aggregation stub.
 */
export async function getRegionalBenchmark(
  businessId: string,
): Promise<RegionalBenchmarkCohort | null> {
  const bizSnap = await db.collection("businesses").doc(businessId).get();
  if (!bizSnap.exists) return null;
  const data = bizSnap.data() || {};
  const optIn = data.regionalBenchmarkOptIn === true;
  const regionKey = String(data.regionKey || data.city || "unknown");

  if (!optIn) {
    return {
      regionKey,
      stationCount: 0,
      optInRequired: true,
      metrics: {
        dormantPctMedian: null,
        gallonsPerSukiMedian: null,
        acceptanceRateMedian: null,
      },
    };
  }

  const cohortSnap = await db
    .collection("businesses")
    .where("regionalBenchmarkOptIn", "==", true)
    .where("regionKey", "==", regionKey)
    .limit(50)
    .get();

  if (cohortSnap.size < K_ANONYMITY) {
    return {
      regionKey,
      stationCount: cohortSnap.size,
      optInRequired: false,
      metrics: {
        dormantPctMedian: null,
        gallonsPerSukiMedian: null,
        acceptanceRateMedian: null,
      },
    };
  }

  return {
    regionKey,
    stationCount: cohortSnap.size,
    optInRequired: false,
    metrics: {
      dormantPctMedian: 18,
      gallonsPerSukiMedian: 4.2,
      acceptanceRateMedian: 92,
    },
  };
}

export async function setRegionalBenchmarkOptIn(
  businessId: string,
  optIn: boolean,
  regionKey?: string,
): Promise<void> {
  await db.collection("businesses").doc(businessId).update({
    regionalBenchmarkOptIn: optIn,
    ...(regionKey ? { regionKey: regionKey.slice(0, 80) } : {}),
    updatedAt: new Date(),
  });
}
