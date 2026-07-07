import type {
  RiderMessengerJobRow,
  RiderMessengerNearbyRow,
  RiderMessengerSessionDoc,
} from "./rider-messenger-types";
import { resolveJobTarget } from "./rider-messenger-jobs-service";
import { resolveNearbyTarget } from "./rider-messenger-nearby-service";

export type RiderMessengerListTarget =
  | { list: "jobs"; job: RiderMessengerJobRow }
  | { list: "group_detail"; nearby: RiderMessengerNearbyRow };

export function resolveActiveListTarget(params: {
  session: (RiderMessengerSessionDoc & { psid?: string }) | null;
  jobs: RiderMessengerJobRow[];
  token: string;
}): RiderMessengerListTarget | null {
  const raw = params.token.trim();
  if (!raw) return null;

  const activeList = params.session?.activeList;

  if (activeList === "group_detail" && params.session?.lastNearby?.length) {
    const nearby = resolveNearbyTarget(params.session.lastNearby, raw);
    return nearby ? { list: "group_detail", nearby } : null;
  }

  if (activeList === "jobs") {
    const job = resolveJobTarget(params.jobs, raw);
    return job ? { list: "jobs", job } : null;
  }

  if (activeList === "nearby") {
    return null;
  }

  const job = resolveJobTarget(params.jobs, raw);
  if (job) return { list: "jobs", job };

  if (params.session?.lastNearby?.length) {
    const nearby = resolveNearbyTarget(params.session.lastNearby, raw);
    if (nearby) return { list: "group_detail", nearby };
  }

  return null;
}
