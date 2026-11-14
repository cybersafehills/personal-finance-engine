import * as LocalAuthentication from "expo-local-authentication";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";

import { deviceStore } from "@/lib/device-store";

import { shouldLockOnLaunch, shouldLockOnResume } from "./lock-policy";

// App lock: a biometric (or device passcode) gate in front of the UI. It
// does NOT replace the OneLedger session and it does not gate background
// capture; it only stops someone holding an unlocked phone from reading
// the app.

const PREF_KEY = "lock.enabled";

type LockContextValue = {
  /** True until the stored preference has been read. */
  loading: boolean;
  /** The device has biometrics or a passcode set up that we can use. */
  available: boolean;
  enabled: boolean;
  locked: boolean;
  /** The app is not in the foreground (cover content in the app switcher). */
  obscured: boolean;
  /** Prompts the device unlock; resolves true when it succeeds. */
  unlock(): Promise<boolean>;
  /**
   * Lifts the lock after a fresh password sign-in. A password is stronger
   * proof than the device unlock, and without this someone whose biometrics
   * stopped working could sign out and back in and still be locked out.
   */
  releaseAfterSignIn(): void;
  /** Turning on requires a successful prompt first. */
  setEnabled(next: boolean): Promise<boolean>;
};

const LockContext = createContext<LockContextValue | null>(null);

async function prompt(message: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: message,
    });
    return result.success;
  } catch {
    return false;
  }
}

async function detectAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [obscured, setObscured] = useState(false);

  const enabledRef = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [stored, canUse] = await Promise.all([
        deviceStore.get(PREF_KEY),
        detectAvailable(),
      ]);
      if (!active) return;
      // If biometrics were removed from the device since the lock was
      // turned on, the lock cannot be satisfied; treat it as off.
      const isEnabled = stored === "1" && canUse;
      enabledRef.current = isEnabled;
      setAvailable(canUse);
      setEnabledState(isEnabled);
      setLocked(shouldLockOnLaunch(isEnabled));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setObscured(false);
        if (
          shouldLockOnResume(
            enabledRef.current,
            backgroundedAt.current,
            Date.now(),
          )
        ) {
          setLocked(true);
        }
        backgroundedAt.current = null;
        return;
      }
      setObscured(true);
      if (state === "background" && backgroundedAt.current === null) {
        backgroundedAt.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    const ok = await prompt("Unlock OneLedger");
    if (ok) setLocked(false);
    return ok;
  }, []);

  const releaseAfterSignIn = useCallback(() => setLocked(false), []);

  const setEnabled = useCallback(async (next: boolean) => {
    if (next) {
      if (!(await detectAvailable())) return false;
      if (!(await prompt("Turn on app lock"))) return false;
      await deviceStore.set(PREF_KEY, "1");
    } else {
      // Turning the lock off is itself protected.
      if (!(await prompt("Turn off app lock"))) return false;
      await deviceStore.remove(PREF_KEY);
    }
    enabledRef.current = next;
    setEnabledState(next);
    return true;
  }, []);

  const value = useMemo(
    () => ({
      loading,
      available,
      enabled,
      locked,
      obscured,
      unlock,
      releaseAfterSignIn,
      setEnabled,
    }),
    [
      loading,
      available,
      enabled,
      locked,
      obscured,
      unlock,
      releaseAfterSignIn,
      setEnabled,
    ],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextValue {
  const value = useContext(LockContext);
  if (!value) throw new Error("useLock must be used inside LockProvider");
  return value;
}
