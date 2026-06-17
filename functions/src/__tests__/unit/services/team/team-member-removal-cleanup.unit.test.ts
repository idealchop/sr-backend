import { describe, expect, it } from "vitest";
import {
  shouldDeleteTeamInviteForRemovedMember,
} from "../../../../services/team/team-member-removal-cleanup";

describe("shouldDeleteTeamInviteForRemovedMember", () => {
  const userId = "uid-1";
  const email = "rider@example.com";

  it("deletes invites accepted by the removed user", () => {
    expect(
      shouldDeleteTeamInviteForRemovedMember(
        { acceptedByUid: userId },
        userId,
        email,
      ),
    ).toBe(true);
  });

  it("deletes pending invites for the member email", () => {
    expect(
      shouldDeleteTeamInviteForRemovedMember(
        { inviteeEmail: "Rider@Example.com" },
        userId,
        email,
      ),
    ).toBe(true);
  });

  it("keeps unrelated invites", () => {
    expect(
      shouldDeleteTeamInviteForRemovedMember(
        { inviteeEmail: "other@example.com", acceptedByUid: "other-uid" },
        userId,
        email,
      ),
    ).toBe(false);
  });
});
