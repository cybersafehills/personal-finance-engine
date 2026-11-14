import {
  RELOCK_AFTER_MS,
  shouldLockOnLaunch,
  shouldLockOnResume,
} from "../lock-policy";

describe("lock policy", () => {
  it("locks on launch only when enabled", () => {
    expect(shouldLockOnLaunch(true)).toBe(true);
    expect(shouldLockOnLaunch(false)).toBe(false);
  });

  it("never relocks when disabled", () => {
    expect(shouldLockOnResume(false, 0, RELOCK_AFTER_MS * 10)).toBe(false);
  });

  it("does not relock after a short trip to the background", () => {
    expect(shouldLockOnResume(true, 1_000, 1_000 + RELOCK_AFTER_MS - 1)).toBe(false);
  });

  it("relocks at and beyond the threshold", () => {
    expect(shouldLockOnResume(true, 1_000, 1_000 + RELOCK_AFTER_MS)).toBe(true);
    expect(shouldLockOnResume(true, 1_000, 1_000 + RELOCK_AFTER_MS * 5)).toBe(true);
  });

  it("does not relock if the app never went to the background", () => {
    expect(shouldLockOnResume(true, null, 999_999)).toBe(false);
  });
});
