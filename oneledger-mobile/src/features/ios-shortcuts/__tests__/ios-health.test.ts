import {
  IOS_TROUBLESHOOTING,
  iosHealthDisplay,
  iosHealthState,
  lastHeardLabel,
  QUIET_AFTER_DAYS,
  WAITING_GRACE_DAYS,
  type IosDeviceStatus,
} from "../ios-health";
import { AUTOMATION_STEPS, CAPTURE_SHORTCUT_NAME, CONNECT_SHORTCUT_NAME } from "../shortcuts";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const device = (over: Partial<IosDeviceStatus> = {}): IosDeviceStatus => ({
  status: "active",
  createdAtIso: ago(30 * DAY),
  lastUsedAtIso: null,
  ...over,
});

describe("iosHealthState", () => {
  it("is working when it was heard within the quiet window", () => {
    expect(iosHealthState(device({ lastUsedAtIso: ago(2 * HOUR) }), NOW)).toBe("working");
    expect(iosHealthState(device({ lastUsedAtIso: ago(QUIET_AFTER_DAYS * DAY) }), NOW)).toBe("working");
  });

  it("is quiet when it was last heard long ago", () => {
    expect(iosHealthState(device({ lastUsedAtIso: ago(QUIET_AFTER_DAYS * DAY + MIN) }), NOW)).toBe("quiet");
  });

  it("waits for a new connection, then calls it quiet", () => {
    expect(iosHealthState(device({ createdAtIso: ago(HOUR) }), NOW)).toBe("waiting");
    expect(iosHealthState(device({ createdAtIso: ago(WAITING_GRACE_DAYS * DAY) }), NOW)).toBe("waiting");
    expect(iosHealthState(device({ createdAtIso: ago(WAITING_GRACE_DAYS * DAY + MIN) }), NOW)).toBe("quiet");
  });

  it("reports a revoked or paused credential as disconnected, whatever else is true", () => {
    expect(iosHealthState(device({ status: "revoked", lastUsedAtIso: ago(MIN) }), NOW)).toBe("disconnected");
    expect(iosHealthState(device({ status: "paused" }), NOW)).toBe("disconnected");
  });
});

describe("lastHeardLabel", () => {
  it("uses the largest sensible unit and pluralises", () => {
    expect(lastHeardLabel(ago(10_000), NOW)).toBe("just now");
    expect(lastHeardLabel(ago(MIN), NOW)).toBe("1 minute ago");
    expect(lastHeardLabel(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(lastHeardLabel(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(lastHeardLabel(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(lastHeardLabel(ago(2 * DAY), NOW)).toBe("2 days ago");
  });

  it("never goes negative for a clock-skewed timestamp", () => {
    expect(lastHeardLabel(new Date(NOW + HOUR).toISOString(), NOW)).toBe("just now");
  });
});

describe("iosHealthDisplay", () => {
  it("explains each state in plain language", () => {
    expect(iosHealthDisplay(device({ lastUsedAtIso: ago(3 * HOUR) }), NOW)).toEqual({
      variant: "positive",
      label: "Previous activity received",
      detail: "Last heard from this iPhone 3 hours ago.",
    });
    expect(iosHealthDisplay(device({ createdAtIso: ago(HOUR) }), NOW).label).toBe(
      "Waiting for the first message",
    );
    const quiet = iosHealthDisplay(device({ lastUsedAtIso: ago(10 * DAY) }), NOW);
    expect(quiet.variant).toBe("attention");
    expect(quiet.detail).toContain("10 days ago");
    expect(iosHealthDisplay(device(), NOW).detail).toContain("Nothing has arrived");
    expect(iosHealthDisplay(device({ status: "revoked" }), NOW).label).toBe("Disconnected");
  });
});

describe("IOS_TROUBLESHOOTING", () => {
  it("is complete, and names the Shortcuts exactly as the setup steps do", () => {
    expect(IOS_TROUBLESHOOTING.length).toBeGreaterThanOrEqual(4);
    for (const t of IOS_TROUBLESHOOTING) {
      expect(t.problem.length).toBeGreaterThan(10);
      expect(t.fix.length).toBeGreaterThan(20);
    }
    const all = IOS_TROUBLESHOOTING.map((t) => t.fix).join(" ");
    expect(all).toContain(`“${CONNECT_SHORTCUT_NAME}”`);
    expect(all).toContain(`“${CAPTURE_SHORTCUT_NAME}”`);
    // The advice must agree with the automation steps (trigger word).
    expect(AUTOMATION_STEPS.join(" ")).toContain("RWF");
    expect(all).toContain("RWF");
  });
});
