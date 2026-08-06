import { describe, expect, it, afterEach } from "vitest";
import {
  isCommunityDispatchExpireEnabled,
} from "../../../jobs/community-dispatch-expire-offers";

describe("isCommunityDispatchExpireEnabled", () => {
  const prev = process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED;
    } else {
      process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED = prev;
    }
  });

  it("is disabled by default (feature idle)", () => {
    delete process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED;
    expect(isCommunityDispatchExpireEnabled()).toBe(false);
  });

  it("enables only when set to 1", () => {
    process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED = "1";
    expect(isCommunityDispatchExpireEnabled()).toBe(true);
    process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED = "true";
    expect(isCommunityDispatchExpireEnabled()).toBe(false);
  });
});
