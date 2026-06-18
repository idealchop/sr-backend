import { describe, expect, it } from "vitest";
import {
  buildWorkspacePrerequisiteTurn,
  formatSupportWorkspaceContextBlock,
} from "../../../../services/support/support-workspace-context";
import { DEFAULT_GETTING_STARTED } from "../../../../services/business/business-onboarding-defaults";

const emptyWorkspace = {
  businessName: "Test Station",
  gettingStarted: { ...DEFAULT_GETTING_STARTED },
  activeRiderCount: 0,
  ops: {
    dormantCount: 0,
    unpaidTotalPhp: 0,
    openDeliveryCount: 0,
    revenuePhpLast7Days: 0,
    callTodayCount: 0,
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
    expect(block).toContain("NO — prerequisite missing");
    expect(block).toContain("Add Customer");
    expect(block).toContain("Dormant sukis");
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
        },
      },
    );
    expect(turn).not.toBeNull();
    expect(turn?.structured?.summary).toMatch(/snapshot/i);
    expect(turn?.structured?.highlights?.[0].title).toMatch(/Dormant/i);
  });
});
