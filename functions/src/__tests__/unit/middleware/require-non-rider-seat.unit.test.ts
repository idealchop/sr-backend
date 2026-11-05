import { describe, expect, it, vi } from "vitest";
vi.mock("../../../config/firebase-admin", () => ({ db: {}, auth: {} }));
import { requireNonRiderSeat } from "../../../middleware/business-middleware";

const run = (businessRole?: string) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  requireNonRiderSeat({ businessRole } as never, res as never, next);
  return { res, next };
};

describe("requireNonRiderSeat", () => {
  it("blocks rider seats", () => {
    const { res, next } = run("rider");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("lets %s through", (role) => {
    expect(run(role).next).toHaveBeenCalled();
  });
});
