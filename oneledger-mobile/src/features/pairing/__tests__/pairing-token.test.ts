import {
  connectorKeyForProvider,
  generatePairingToken,
  PAIRING_TOKEN_PATTERN,
  startPairingErrorMessage,
} from "../pairing-token";

const fixed = (value: number) => (n: number) => new Uint8Array(n).fill(value);

describe("generatePairingToken", () => {
  it("produces a token the server pattern accepts", () => {
    for (const byte of [0, 1, 127, 200, 255]) {
      const { token, prefix } = generatePairingToken(fixed(byte));
      expect(token).toMatch(PAIRING_TOKEN_PATTERN);
      expect(token).toHaveLength(4 + 4 + 26);
      expect(prefix).toMatch(/^olp_[A-Za-z0-9]{4}$/);
      expect(token.startsWith(prefix)).toBe(true);
    }
  });

  it("base32-encodes the 16 body bytes exactly (RFC 4648, no padding)", () => {
    // 16 zero bytes -> 26 'A's; 16 0xFF bytes -> 25 '7's + '4' (3 leftover bits 111 -> 11100).
    expect(generatePairingToken(fixed(0)).token.slice(8)).toBe("A".repeat(26));
    expect(generatePairingToken(fixed(255)).token.slice(8)).toBe("7".repeat(25) + "4");
  });

  it("avoids look-alike characters in the display part", () => {
    for (let byte = 0; byte < 256; byte++) {
      expect(generatePairingToken(fixed(byte)).prefix).not.toMatch(/[IO01]/);
    }
  });

  it("uses the supplied randomness for both parts", () => {
    const calls: number[] = [];
    generatePairingToken((n) => {
      calls.push(n);
      return new Uint8Array(n);
    });
    expect(calls).toEqual([4, 16]);
  });
});

describe("connectorKeyForProvider", () => {
  it("matches the web mapping", () => {
    expect(connectorKeyForProvider("mtn_momo")).toBe("mtn_momo_sms_v1");
    expect(connectorKeyForProvider("airtel_money")).toBe("airtel_money_sms_v1");
    expect(connectorKeyForProvider("bank")).toBe("bank_legacy_push_v1");
    expect(connectorKeyForProvider("other")).toBe("generic_legacy_push_v1");
  });
});

describe("startPairingErrorMessage", () => {
  it("maps known database refusals to customer copy", () => {
    expect(startPairingErrorMessage("Only a workspace owner can pair a device.")).toMatch(/workspace owner/);
    expect(startPairingErrorMessage("Too many pending pairing sessions")).toMatch(/few pairing codes/);
    expect(startPairingErrorMessage("x owned by another user y")).toMatch(/another person/);
    expect(startPairingErrorMessage("The selected account is unavailable")).toMatch(/can't be connected/);
  });
  it("falls back without leaking the raw message", () => {
    expect(startPairingErrorMessage("relation pg_xyz does not exist")).toBe(
      "Could not start connecting. Please try again.",
    );
  });
});
