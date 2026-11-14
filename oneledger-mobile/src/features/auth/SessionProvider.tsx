import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { signInWithPassword } from "@/api/mobile-api";
import { supabase } from "@/api/supabase";

export type ActionResult = { ok: true } | { ok: false; message: string };

type SessionContextValue = {
  /** True until the stored session has been read on launch. */
  loading: boolean;
  session: Session | null;
  /** Signed in, but a second factor is enrolled and not yet verified. */
  mfaRequired: boolean;
  signIn(email: string, password: string): Promise<ActionResult>;
  verifyMfa(code: string): Promise<ActionResult>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const NOT_CONFIGURED: ActionResult = {
  ok: false,
  message: "This build isn't connected to OneLedger yet.",
};

/** Whether the current session still owes a second factor (same rule as web). */
async function readMfaRequired(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Nothing to load when the build has no backend configured.
  const [loading, setLoading] = useState(supabase !== null);
  const [session, setSession] = useState<Session | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;

    (async () => {
      const { data } = await client.auth.getSession();
      const required = data.session ? await readMfaRequired() : false;
      if (!active) return;
      setSession(data.session);
      setMfaRequired(required);
      setLoading(false);
    })();

    const { data: listener } = client.auth.onAuthStateChange(
      (event, next) => {
        if (!active) return;
        setSession(next);
        if (event === "SIGNED_OUT") setMfaRequired(false);
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<ActionResult> => {
      if (!supabase) return NOT_CONFIGURED;
      // Goes through the server so the account lockout and security emails
      // apply, then adopts the returned session locally.
      const result = await signInWithPassword(email, password);
      if (!result.ok) return result;

      // Set before adopting the session so the navigator never shows the
      // app for a moment to someone who still owes a second factor.
      setMfaRequired(result.mfaRequired);
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) {
        setMfaRequired(false);
        return { ok: false, message: "Sign-in did not complete. Try again." };
      }
      return { ok: true };
    },
    [],
  );

  const verifyMfa = useCallback(async (code: string): Promise<ActionResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { data: factors, error: listError } =
      await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (listError || !factor) {
      return {
        ok: false,
        message: "Couldn't find your authenticator. Sign in again.",
      };
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    if (error) {
      return { ok: false, message: "That code didn't match. Try again." };
    }
    setMfaRequired(await readMfaRequired());
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    // Local scope: ends this device's session only, like the web's sign out.
    await supabase?.auth.signOut({ scope: "local" });
    setSession(null);
    setMfaRequired(false);
  }, []);

  const value = useMemo(
    () => ({ loading, session, mfaRequired, signIn, verifyMfa, signOut }),
    [loading, session, mfaRequired, signIn, verifyMfa, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
