/** MP-24 — compare IoT flow readings vs logged production gallons. */
export function computeFlowMeterReconcile(args: {
  businessId: string;
  shifts: Array<{ calendarDate: string; gallonsProduced: number }>;
  iotGallonsTotal?: number;
}): {
  loggedGallons: number;
  iotGallons: number | null;
  variancePct: number | null;
  headline: string;
} {
  const loggedGallons = args.shifts.reduce(
    (sum, s) => sum + (Number(s.gallonsProduced) || 0),
    0,
  );
  const iotGallons =
    args.iotGallonsTotal != null && Number.isFinite(args.iotGallonsTotal) ?
      args.iotGallonsTotal :
      null;

  if (iotGallons == null || loggedGallons <= 0) {
    return {
      loggedGallons,
      iotGallons,
      variancePct: null,
      headline: "Connect a flow meter (MP-20) to reconcile IoT vs shift logs.",
    };
  }

  const variancePct = Math.round(
    (Math.abs(loggedGallons - iotGallons) / loggedGallons) * 1000,
  ) / 10;

  return {
    loggedGallons,
    iotGallons,
    variancePct,
    headline:
      variancePct > 8 ?
        `IoT flow differs from shift logs by ${variancePct}% — check for unlogged sales or meter drift.` :
        `IoT flow and shift logs align within ${variancePct}%.`,
  };
}
