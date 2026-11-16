import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { AppState } from "react-native";

import { LockProvider, useLock } from "../LockProvider";
import { RELOCK_AFTER_MS } from "../lock-policy";

const mockStore = new Map<string, string>();
jest.mock("@/lib/device-store", () => ({
  deviceStore: {
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      mockStore.set(key, value);
    },
    remove: async (key: string) => {
      mockStore.delete(key);
    },
  },
}));
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

let lock: ReturnType<typeof useLock>;
const publish = (value: ReturnType<typeof useLock>) => {
  lock = value;
};
function Probe() {
  const value = useLock();
  // After every render, so tests always read the latest context.
  useEffect(() => publish(value));
  return null;
}

let appState: ((state: string) => void) | undefined;
let now = 1_000_000;

async function mountLock() {
  await render(
    <LockProvider>
      <Probe />
    </LockProvider>,
  );
  await waitFor(() => expect(lock.loading).toBe(false));
}

function deviceHasBiometrics(has: boolean) {
  auth.hasHardwareAsync.mockResolvedValue(has);
  auth.isEnrolledAsync.mockResolvedValue(has);
}

beforeEach(() => {
  mockStore.clear();
  auth.hasHardwareAsync.mockReset();
  auth.isEnrolledAsync.mockReset();
  auth.authenticateAsync.mockReset();
  deviceHasBiometrics(true);
  appState = undefined;
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (s: string) => void) => {
    appState = handler;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

const send = (state: string) =>
  act(async () => {
    appState!(state);
  });

describe("LockProvider: launch", () => {
  it("locks on a cold start when the lock is on and the device can unlock", async () => {
    mockStore.set("lock.enabled", "1");
    await mountLock();
    expect(lock).toMatchObject({ available: true, enabled: true, locked: true });
  });

  it("starts unlocked when the lock was never turned on", async () => {
    await mountLock();
    expect(lock).toMatchObject({ available: true, enabled: false, locked: false });
  });

  it("treats the lock as off if biometrics were removed from the phone", async () => {
    mockStore.set("lock.enabled", "1");
    deviceHasBiometrics(false);
    await mountLock();
    expect(lock).toMatchObject({ available: false, enabled: false, locked: false });
  });

  it("copes with the device check failing", async () => {
    mockStore.set("lock.enabled", "1");
    auth.hasHardwareAsync.mockRejectedValue(new Error("no module"));
    await mountLock();
    expect(lock).toMatchObject({ available: false, enabled: false, locked: false });
  });
});

describe("LockProvider: unlocking", () => {
  beforeEach(() => mockStore.set("lock.enabled", "1"));

  it("unlocks when the device confirms it's the person", async () => {
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    await mountLock();
    let ok = false;
    await act(async () => {
      ok = await lock.unlock();
    });
    expect(ok).toBe(true);
    expect(lock.locked).toBe(false);
  });

  it("stays locked when the check fails or throws", async () => {
    await mountLock();
    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    let ok = true;
    await act(async () => {
      ok = await lock.unlock();
    });
    expect(ok).toBe(false);
    expect(lock.locked).toBe(true);

    auth.authenticateAsync.mockRejectedValue(new Error("cancelled"));
    await act(async () => {
      ok = await lock.unlock();
    });
    expect(ok).toBe(false);
    expect(lock.locked).toBe(true);
  });

  it("lifts the lock after a fresh password sign-in, with no biometric prompt", async () => {
    await mountLock();
    await act(async () => lock.releaseAfterSignIn());
    expect(lock.locked).toBe(false);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });
});

describe("LockProvider: turning the lock on and off", () => {
  it("turns on only after a successful prompt, and remembers it", async () => {
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    await mountLock();
    let changed = false;
    await act(async () => {
      changed = await lock.setEnabled(true);
    });
    expect(changed).toBe(true);
    expect(lock.enabled).toBe(true);
    expect(mockStore.get("lock.enabled")).toBe("1");
  });

  it("does not turn on if the person cannot be confirmed", async () => {
    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    await mountLock();
    let changed = true;
    await act(async () => {
      changed = await lock.setEnabled(true);
    });
    expect(changed).toBe(false);
    expect(lock.enabled).toBe(false);
    expect(mockStore.has("lock.enabled")).toBe(false);
  });

  it("refuses to turn on when the phone has no biometrics or passcode, without prompting", async () => {
    deviceHasBiometrics(false);
    await mountLock();
    let changed = true;
    await act(async () => {
      changed = await lock.setEnabled(true);
    });
    expect(changed).toBe(false);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it("protects turning the lock off with a prompt of its own", async () => {
    mockStore.set("lock.enabled", "1");
    await mountLock();

    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    let changed = true;
    await act(async () => {
      changed = await lock.setEnabled(false);
    });
    expect(changed).toBe(false);
    expect(lock.enabled).toBe(true);
    expect(mockStore.get("lock.enabled")).toBe("1");

    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    await act(async () => {
      changed = await lock.setEnabled(false);
    });
    expect(changed).toBe(true);
    expect(lock.enabled).toBe(false);
    expect(mockStore.has("lock.enabled")).toBe(false);
  });
});

describe("LockProvider: leaving and returning", () => {
  beforeEach(async () => {
    mockStore.set("lock.enabled", "1");
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    await mountLock();
    await act(async () => {
      await lock.unlock();
    });
    expect(lock.locked).toBe(false);
  });

  it("covers the app while it is in the app switcher", async () => {
    await send("inactive");
    expect(lock.obscured).toBe(true);
    await send("active");
    expect(lock.obscured).toBe(false);
  });

  it("locks again after a minute in the background", async () => {
    await send("background");
    now += RELOCK_AFTER_MS;
    await send("active");
    expect(lock.locked).toBe(true);
    expect(lock.obscured).toBe(false);
  });

  it("does not lock after a short trip away", async () => {
    await send("background");
    now += RELOCK_AFTER_MS - 1_000;
    await send("active");
    expect(lock.locked).toBe(false);
  });

  it("does not start the clock for a brief interruption (inactive only)", async () => {
    await send("inactive");
    now += 10 * RELOCK_AFTER_MS;
    await send("active");
    expect(lock.locked).toBe(false);
  });

  it("measures from the first time it left, not the last state change", async () => {
    await send("background");
    now += RELOCK_AFTER_MS - 5_000;
    await send("inactive");
    now += 10_000;
    await send("active");
    expect(lock.locked).toBe(true);
  });
});

describe("LockProvider: when the lock is off", () => {
  it("never locks on return", async () => {
    await mountLock();
    await send("background");
    now += 10 * RELOCK_AFTER_MS;
    await send("active");
    expect(lock.locked).toBe(false);
  });
});
