import { parseSignInResponse } from "../mobile-api";

describe("parseSignInResponse", () => {
  it("accepts a well-formed success", () => {
    expect(
      parseSignInResponse(200, {
        ok: true,
        access_token: "a",
        refresh_token: "r",
        mfa_required: true,
      }),
    ).toEqual({ ok: true, accessToken: "a", refreshToken: "r", mfaRequired: true });
  });

  it("defaults mfaRequired to false", () => {
    const result = parseSignInResponse(200, {
      ok: true,
      access_token: "a",
      refresh_token: "r",
    });
    expect(result).toMatchObject({ ok: true, mfaRequired: false });
  });

  it("rejects a 200 without tokens", () => {
    expect(parseSignInResponse(200, { ok: true }).ok).toBe(false);
  });

  it("passes the server's message through on failure", () => {
    expect(
      parseSignInResponse(429, {
        ok: false,
        error: "locked_out",
        message: "Too many attempts. Try again in a few minutes.",
      }),
    ).toEqual({ ok: false, message: "Too many attempts. Try again in a few minutes." });
  });

  it("explains a dark endpoint and survives a non-JSON body", () => {
    expect(parseSignInResponse(404, null)).toEqual({
      ok: false,
      message: "Sign-in from the app isn't available yet.",
    });
    expect(parseSignInResponse(502, null).ok).toBe(false);
  });
});
