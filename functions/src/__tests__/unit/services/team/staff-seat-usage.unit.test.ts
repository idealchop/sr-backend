import { describe, expect, it } from "vitest";
import {
  countMemberStaffSeats,
  countRecordOnlyStaffSeats,
  mergeStaffSeatUsage,
} from "../../../../services/team/staff-seat-usage";

describe("countRecordOnlyStaffSeats", () => {
  it("counts active record-only riders and directory admins", () => {
    const usage = countRecordOnlyStaffSeats(
      [
        { userId: "", status: "active" },
        { userId: "uid-1", status: "active" },
        { userId: "", status: "inactive" },
      ],
      [
        { role: "admin", status: "active" },
        { role: "rider", status: "active" },
        { role: "admin", status: "inactive" },
      ],
    );

    expect(usage).toEqual({ total: 3, admins: 1, riders: 2 });
  });
});

describe("countMemberStaffSeats", () => {
  it("counts active non-owner members only", () => {
    const ownerId = "owner-1";
    const usage = countMemberStaffSeats(
      [
        {
          id: ownerId,
          data: () => ({ role: "owner", isActive: true }),
        },
        {
          id: "admin-1",
          data: () => ({ role: "admin", isActive: true }),
        },
        {
          id: "rider-1",
          data: () => ({ role: "rider", isActive: true }),
        },
        {
          id: "rider-2",
          data: () => ({ role: "rider", isActive: false }),
        },
      ],
      ownerId,
    );

    expect(usage).toEqual({ total: 2, admins: 1, riders: 1 });
  });
});

describe("mergeStaffSeatUsage", () => {
  it("sums members and record-only buckets for plan metering", () => {
    const merged = mergeStaffSeatUsage(
      { total: 2, admins: 1, riders: 1 },
      { total: 2, admins: 1, riders: 1 },
    );
    expect(merged).toEqual({ total: 4, admins: 2, riders: 2 });
  });
});
