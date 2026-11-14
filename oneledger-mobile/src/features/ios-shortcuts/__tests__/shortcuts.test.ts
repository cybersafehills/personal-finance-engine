import {
  AUTOMATION_STEPS,
  connectPhase,
  connectShortcutRunUrl,
  expiryLabel,
  iosGuideStepNumber,
} from "../shortcuts";

describe("connectShortcutRunUrl", () => {
  it("matches the web wizard's URL and never uses + for spaces", () => {
    const url = connectShortcutRunUrl("olp_ABCD1234567890abcdefgh");
    expect(url).toBe(
      "shortcuts://run-shortcut?name=Connect%20to%20OneLedger&input=text&text=olp_ABCD1234567890abcdefgh",
    );
    expect(url).not.toContain("+");
  });
  it("encodes anything unsafe in the code", () => {
    expect(connectShortcutRunUrl("a b&c")).toContain("text=a%20b%26c");
  });
});

describe("connectPhase", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");
  it("follows the server status", () => {
    expect(connectPhase("consumed", "2026-11-14T10:05:00Z", now)).toBe("connected");
    expect(connectPhase("expired", "2026-11-14T10:05:00Z", now)).toBe("expired");
    expect(connectPhase("cancelled", null, now)).toBe("expired");
    expect(connectPhase("pending", "2026-11-14T10:05:00Z", now)).toBe("waiting");
  });
  it("treats a pending code past its expiry as expired", () => {
    expect(connectPhase("pending", "2026-11-14T09:59:59Z", now)).toBe("expired");
    expect(connectPhase(null, "2026-11-14T10:00:00Z", now)).toBe("expired");
  });
  it("a consumed code stays connected even after the expiry time", () => {
    expect(connectPhase("consumed", "2026-11-14T09:00:00Z", now)).toBe("connected");
  });
  it("waits when nothing is known yet", () => {
    expect(connectPhase(null, null, now)).toBe("waiting");
  });
});

describe("expiryLabel", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");
  it("counts down in minutes", () => {
    expect(expiryLabel("2026-11-14T10:09:30Z", now)).toBe("9 min left");
    expect(expiryLabel("2026-11-14T10:00:40Z", now)).toBe("Less than a minute left");
    expect(expiryLabel("2026-11-14T10:00:00Z", now)).toBe("Expired");
  });
});

describe("guide content", () => {
  it("numbers steps from 1", () => {
    expect(iosGuideStepNumber("install")).toBe(1);
    expect(iosGuideStepNumber("verify")).toBe(4);
  });
  it("tells the user to match on RWF and to leave Sender empty", () => {
    const text = AUTOMATION_STEPS.join(" ");
    expect(text).toContain("RWF");
    expect(text).toContain("Leave Sender empty");
    expect(text).toContain("OneLedger Capture");
  });
});
