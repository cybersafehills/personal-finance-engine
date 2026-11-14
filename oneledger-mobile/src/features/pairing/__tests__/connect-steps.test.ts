import { connectStepNumber, currentConnectStep } from "../connect-steps";

const none = { disclosureAccepted: false, keepRunningSeen: false };
const accepted = { disclosureAccepted: true, keepRunningSeen: false };

describe("currentConnectStep", () => {
  it("starts with the disclosure, before anything is enabled", () => {
    expect(
      currentConnectStep({ paired: false, notificationAccessGranted: false, state: "setup_required" }, none),
    ).toBe("disclosure");
  });

  it("moves to connect once the disclosure is accepted", () => {
    expect(
      currentConnectStep({ paired: false, notificationAccessGranted: false, state: "setup_required" }, accepted),
    ).toBe("connect");
  });

  it("asks for notification access after pairing", () => {
    expect(
      currentConnectStep({ paired: true, notificationAccessGranted: false, state: "permission_required" }, accepted),
    ).toBe("allow_access");
  });

  it("resumes at the missing piece without the disclosure flag (app reopened)", () => {
    expect(
      currentConnectStep({ paired: true, notificationAccessGranted: false, state: "permission_required" }, none),
    ).toBe("allow_access");
  });

  it("shows the keep-running advice once, then is done", () => {
    const healthy = { paired: true, notificationAccessGranted: true, state: "active" } as const;
    expect(currentConnectStep(healthy, accepted)).toBe("keep_running");
    expect(currentConnectStep(healthy, { disclosureAccepted: true, keepRunningSeen: true })).toBe("done");
  });

  it("sends a revoked phone back to connect even though a credential is stored", () => {
    expect(
      currentConnectStep(
        { paired: true, notificationAccessGranted: true, state: "reauthentication_required" },
        accepted,
      ),
    ).toBe("connect");
  });

  it("re-requests access if the user later turns it off", () => {
    expect(
      currentConnectStep(
        { paired: true, notificationAccessGranted: false, state: "permission_required" },
        { disclosureAccepted: true, keepRunningSeen: true },
      ),
    ).toBe("allow_access");
  });
});

describe("connectStepNumber", () => {
  it("numbers the steps and pins done to the last", () => {
    expect(connectStepNumber("disclosure")).toBe(1);
    expect(connectStepNumber("allow_access")).toBe(3);
    expect(connectStepNumber("done")).toBe(4);
  });
});
