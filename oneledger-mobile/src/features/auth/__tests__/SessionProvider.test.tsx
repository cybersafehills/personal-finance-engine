import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";

import { supabase } from "@/api/supabase";

import { SessionProvider, useSession } from "../SessionProvider";

const mockSignInWithPassword = jest.fn();
const mockDisablePush = jest.fn();
const order: string[] = [];

jest.mock("@/api/supabase", () => {
  const auth = {
    getSession: jest.fn(),
    setSession: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChange: jest.fn(),
    mfa: {
      getAuthenticatorAssuranceLevel: jest.fn(),
      listFactors: jest.fn(),
      challengeAndVerify: jest.fn(),
    },
  };
  return { supabase: { auth } };
});
jest.mock("@/api/mobile-api", () => ({
  signInWithPassword: (email: string, password: string) => mockSignInWithPassword(email, password),
}));
jest.mock("@/features/push/push", () => ({ disablePush: () => mockDisablePush() }));

const auth = (supabase as any).auth;
const SESSION = { access_token: "a", refresh_token: "r", user: { id: "u1", email: "me@example.com" } };

let ctx: ReturnType<typeof useSession>;
const publish = (value: ReturnType<typeof useSession>) => {
  ctx = value;
};
function Probe() {
  const value = useSession();
  // After every render, so tests always read the latest context.
  useEffect(() => publish(value));
  return null;
}
async function mountSession() {
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await waitFor(() => expect(ctx.loading).toBe(false));
}

beforeEach(() => {
  order.length = 0;
  mockSignInWithPassword.mockReset();
  mockDisablePush.mockReset().mockImplementation(async () => {
    order.push("disablePush");
  });
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  auth.setSession.mockReset().mockResolvedValue({ error: null });
  auth.signOut.mockReset().mockImplementation(async () => {
    order.push("signOut");
    return { error: null };
  });
  auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.mfa.getAuthenticatorAssuranceLevel
    .mockReset()
    .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
  auth.mfa.listFactors.mockReset().mockResolvedValue({ data: { totp: [{ id: "f1" }] }, error: null });
  auth.mfa.challengeAndVerify.mockReset().mockResolvedValue({ error: null });
});

describe("SessionProvider: launch", () => {
  it("starts signed out when nothing is stored", async () => {
    await mountSession();
    expect(ctx).toMatchObject({ session: null, mfaRequired: false });
  });

  it("restores a stored session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await mountSession();
    expect(ctx.session).toBe(SESSION);
    expect(ctx.mfaRequired).toBe(false);
  });

  it("still owes the second factor when the stored session never completed it", async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
    });
    await mountSession();
    expect(ctx.mfaRequired).toBe(true);
  });

  it("does not ask again once the second factor was completed", async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
    });
    await mountSession();
    expect(ctx.mfaRequired).toBe(false);
  });
});

describe("SessionProvider: signIn", () => {
  it("signs in through the server, then adopts the returned session", async () => {
    mockSignInWithPassword.mockResolvedValue({
      ok: true,
      accessToken: "acc",
      refreshToken: "ref",
      mfaRequired: false,
    });
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.signIn>> | undefined;
    await act(async () => {
      result = await ctx.signIn("me@example.com", "pw");
    });
    expect(result).toEqual({ ok: true });
    expect(mockSignInWithPassword).toHaveBeenCalledWith("me@example.com", "pw");
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "acc", refresh_token: "ref" });
    expect(ctx.mfaRequired).toBe(false);
  });

  it("remembers that a second factor is owed", async () => {
    mockSignInWithPassword.mockResolvedValue({
      ok: true,
      accessToken: "acc",
      refreshToken: "ref",
      mfaRequired: true,
    });
    await mountSession();
    await act(async () => {
      await ctx.signIn("me@example.com", "pw");
    });
    expect(ctx.mfaRequired).toBe(true);
  });

  it("passes the server's message through and adopts nothing when sign-in is refused", async () => {
    mockSignInWithPassword.mockResolvedValue({ ok: false, message: "Too many attempts. Try again later." });
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.signIn>> | undefined;
    await act(async () => {
      result = await ctx.signIn("me@example.com", "pw");
    });
    expect(result).toEqual({ ok: false, message: "Too many attempts. Try again later." });
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(ctx.mfaRequired).toBe(false);
  });

  it("reports an incomplete sign-in when the session cannot be adopted, and owes no factor", async () => {
    mockSignInWithPassword.mockResolvedValue({
      ok: true,
      accessToken: "acc",
      refreshToken: "ref",
      mfaRequired: true,
    });
    auth.setSession.mockResolvedValue({ error: { message: "bad token" } });
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.signIn>> | undefined;
    await act(async () => {
      result = await ctx.signIn("me@example.com", "pw");
    });
    expect(result).toEqual({ ok: false, message: "Sign-in did not complete. Try again." });
    expect(ctx.mfaRequired).toBe(false);
  });
});

describe("SessionProvider: verifyMfa", () => {
  it("verifies the code against the enrolled authenticator", async () => {
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.verifyMfa>> | undefined;
    await act(async () => {
      result = await ctx.verifyMfa("123456");
    });
    expect(result).toEqual({ ok: true });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
  });

  it("clears the owed factor once the session reaches the second level", async () => {
    mockSignInWithPassword.mockResolvedValue({ ok: true, accessToken: "a", refreshToken: "r", mfaRequired: true });
    await mountSession();
    await act(async () => {
      await ctx.signIn("me@example.com", "pw");
    });
    expect(ctx.mfaRequired).toBe(true);

    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
    });
    await act(async () => {
      await ctx.verifyMfa("123456");
    });
    expect(ctx.mfaRequired).toBe(false);
  });

  it("explains a wrong code without leaking the server error", async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ error: { message: "Invalid TOTP code entered" } });
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.verifyMfa>> | undefined;
    await act(async () => {
      result = await ctx.verifyMfa("000000");
    });
    expect(result).toEqual({ ok: false, message: "That code didn't match. Try again." });
  });

  it("asks to sign in again when no authenticator can be found", async () => {
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    await mountSession();
    let result: Awaited<ReturnType<typeof ctx.verifyMfa>> | undefined;
    await act(async () => {
      result = await ctx.verifyMfa("123456");
    });
    expect(result).toEqual({ ok: false, message: "Couldn't find your authenticator. Sign in again." });
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe("SessionProvider: signOut", () => {
  it("stops pushes first, then ends this device's session only", async () => {
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await mountSession();
    expect(ctx.session).toBe(SESSION);

    await act(async () => {
      await ctx.signOut();
    });

    expect(order).toEqual(["disablePush", "signOut"]);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(ctx.session).toBeNull();
    expect(ctx.mfaRequired).toBe(false);
  });
});
