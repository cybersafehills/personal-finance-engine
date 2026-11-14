import { formatLastSuccess, healthDisplay } from "../health-display";

describe("healthDisplay", () => {
  it("maps every native state to a label and next action", () => {
    expect(healthDisplay("setup_required")).toMatchObject({ action: "connect" });
    expect(healthDisplay("permission_required")).toMatchObject({
      action: "allow_access",
      variant: "attention",
    });
    expect(healthDisplay("active")).toMatchObject({ label: "Working", variant: "positive" });
    expect(healthDisplay("reauthentication_required")).toMatchObject({ action: "reconnect" });
    expect(healthDisplay("degraded").action).toBe("none");
    expect(healthDisplay("send_failed_permanent").variant).toBe("attention");
  });
});

describe("formatLastSuccess", () => {
  const now = 1_700_000_000_000;
  it("handles never and clock skew", () => {
    expect(formatLastSuccess(0, now)).toBe("Never");
    expect(formatLastSuccess(now + 5_000, now)).toBe("Just now");
  });
  it("scales units and pluralises", () => {
    expect(formatLastSuccess(now - 30_000, now)).toBe("Just now");
    expect(formatLastSuccess(now - 60_000, now)).toBe("1 minute ago");
    expect(formatLastSuccess(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatLastSuccess(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(formatLastSuccess(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(formatLastSuccess(now - 49 * 3_600_000, now)).toBe("2 days ago");
  });
});
