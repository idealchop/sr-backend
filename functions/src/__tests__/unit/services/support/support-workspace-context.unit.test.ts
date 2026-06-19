import { describe, expect, it } from "vitest";
import {
  buildWorkspacePrerequisiteTurn,
  buildWorkspaceRevenueTurn,
  buildWorkspaceScheduleTurn,
  formatSupportWorkspaceContextBlock,
} from "../../../../services/support/support-workspace-context";
import { DEFAULT_GETTING_STARTED } from "../../../../services/business/business-onboarding-defaults";

const emptyRevenue = {
  todayPhp: 0,
  yesterdayPhp: 0,
  last7DaysPhp: 0,
  prior7DaysPhp: 0,
  expensesTodayPhp: 0,
  netTodayPhp: 0,
  todayBreakdown: { cashPhp: 0, onlinePhp: 0 },
  dailyAvgLast7DaysPhp: 0,
  forecastNext7DaysPhp: 0,
  trendVsPriorWeekPct: null,
};

const emptyBuddy = {
  businessName: "Test Station",
  generatedAt: "2026-06-17T00:00:00.000Z",
  counts: {
    customers: 0,
    transactionsLoaded: 0,
    inventoryItems: 0,
    activeRiders: 0,
    pendingPortalOrders: 0,
  },
  revenue: emptyRevenue,
  ops: {
    dormantCount: 0,
    unpaidTotalPhp: 0,
    openDeliveryCount: 0,
    callTodayCount: 0,
  },
  schedule: {
    tomorrow: [] as Array<{
      referenceId: string;
      customerName: string;
      type: "delivery" | "collection";
      deliveryStatus: string;
      scheduledDay: string;
      gallons: number;
      balanceDue: number;
    }>,
    next7Days: [] as Array<{
      referenceId: string;
      customerName: string;
      type: "delivery" | "collection";
      deliveryStatus: string;
      scheduledDay: string;
      gallons: number;
      balanceDue: number;
    }>,
    openInFlight: [] as Array<{
      referenceId: string;
      customerName: string;
      type: "delivery" | "collection";
      deliveryStatus: string;
      scheduledDay: string;
      gallons: number;
      balanceDue: number;
    }>,
  },
  pendingPortalOrders: [],
  lowStockItems: [],
  topUnpaidCustomers: [],
  riders: [],
  cadenceLateSuki: [],
};

const emptyWorkspace = {
  businessName: "Test Station",
  gettingStarted: { ...DEFAULT_GETTING_STARTED },
  activeRiderCount: 0,
  buddy: emptyBuddy,
  ops: {
    dormantCount: 0,
    unpaidTotalPhp: 0,
    openDeliveryCount: 0,
    revenuePhpLast7Days: 0,
    callTodayCount: 0,
    revenue: emptyRevenue,
  },
};

const withCustomer = {
  ...emptyWorkspace,
  gettingStarted: { ...DEFAULT_GETTING_STARTED, addCustomer: true },
};

describe("buildWorkspacePrerequisiteTurn", () => {
  it("blocks delivery help when workspace has no customers", () => {
    const turn = buildWorkspacePrerequisiteTurn(
      "Paano mag-record ng delivery?",
      emptyWorkspace,
    );
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/customer/i);
    expect(turn?.structured?.steps?.[0].tags).toContain("Customers");
  });

  it("allows delivery help when customers exist", () => {
    const turn = buildWorkspacePrerequisiteTurn(
      "Paano mag-record ng delivery?",
      withCustomer,
    );
    expect(turn).toBeNull();
  });

  it("blocks rider assignment when no active riders", () => {
    const turn = buildWorkspacePrerequisiteTurn(
      "Paano i-assign ang rider sa delivery?",
      withCustomer,
    );
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/rider/i);
  });

  it("includes workspace flags in prompt block", () => {
    const block = formatSupportWorkspaceContextBlock(emptyWorkspace);
    expect(block).toContain("customers=NO");
    expect(block).toContain("Add Customer");
    expect(block).toContain("Operations health");
  });

  it("returns health snapshot for kumusta ang station", () => {
    const turn = buildWorkspacePrerequisiteTurn(
      "Kumusta ang station ko ngayon?",
      {
        ...withCustomer,
        ops: {
          dormantCount: 3,
          unpaidTotalPhp: 1500,
          openDeliveryCount: 2,
          revenuePhpLast7Days: 8000,
          callTodayCount: 1,
          revenue: {
            ...emptyRevenue,
            todayPhp: 900,
            last7DaysPhp: 8000,
            todayBreakdown: { cashPhp: 405, onlinePhp: 495 },
          },
        },
      },
    );
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/snapshot/i);
    expect(turn?.structured?.highlights?.[0].title).toMatch(/Dormant/i);
  });

  it("answers magkano kinita ko ngayon from live revenue snapshot", () => {
    const turn = buildWorkspaceRevenueTurn("Magkano kinita ko ngayon?", {
      ...withCustomer,
      ops: {
        ...withCustomer.ops,
        revenue: {
          ...emptyRevenue,
          todayPhp: 900,
          yesterdayPhp: 700,
          todayBreakdown: { cashPhp: 405, onlinePhp: 495 },
        },
      },
    });
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/Kumita ka ng ₱900 ngayon/i);
    expect(turn?.structured?.steps?.[0].title).toMatch(/Transactions/i);
    expect(turn?.structured?.steps?.[0].title).toMatch(/Today/i);
  });

  it("answers how much sales yesterday with personal amount first", () => {
    const turn = buildWorkspaceRevenueTurn("How much is my sales yesterday?", {
      ...withCustomer,
      ops: {
        ...withCustomer.ops,
        revenue: {
          ...emptyRevenue,
          yesterdayPhp: 1000,
          todayPhp: 400,
        },
      },
    });
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/Kumita ka ng ₱1,000 kahapon/i);
    expect(turn?.structured?.steps?.[0].title).toMatch(/Yesterday/i);
    expect(turn?.structured?.highlights?.[0].body).toMatch(/₱400/);
  });

  it("answers sino i-deliver bukas from live schedule snapshot", () => {
    const turn = buildWorkspaceScheduleTurn("Sino ang i-deliver ko bukas?", {
      ...withCustomer,
      buddy: {
        ...emptyBuddy,
        schedule: {
          tomorrow: [
            {
              referenceId: "TX-001",
              customerName: "Maria Santos",
              type: "delivery",
              deliveryStatus: "pending",
              scheduledDay: "2026-06-18",
              gallons: 5,
              balanceDue: 0,
            },
          ],
          next7Days: [
            {
              referenceId: "TX-001",
              customerName: "Maria Santos",
              type: "delivery",
              deliveryStatus: "pending",
              scheduledDay: "2026-06-18",
              gallons: 5,
              balanceDue: 0,
            },
          ],
          openInFlight: [],
        },
      },
    });
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/Maria Santos/);
    expect(turn?.structured?.summary).toMatch(/1.*open stop/i);
    expect(turn?.structured?.steps?.[0].title).toMatch(/Transactions/i);
  });

  it("includes collected revenue today in prompt block", () => {
    const block = formatSupportWorkspaceContextBlock({
      ...withCustomer,
      buddy: {
        ...emptyBuddy,
        revenue: {
          ...emptyRevenue,
          todayPhp: 423,
        },
      },
      ops: {
        ...withCustomer.ops,
        revenue: {
          ...emptyRevenue,
          todayPhp: 423,
        },
      },
    });
    expect(block).toContain("Live Firestore business snapshot");
    expect(block).toContain("\"todayPhp\":423");
  });
});
