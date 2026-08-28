import type { RejectionReason } from "./types";

// Approved-provider deep/universal link handling. A scanned https URL is
// only ever accepted if its host is on a CENTRAL allowlist of verified
// provider domains (§5.2). Everything else - an unknown host, a
// lookalike of a known brand, an http URL, an embedded-credentials URL,
// a disallowed path - is rejected. There is no "open anyway".
//
// R2 ships the mechanism with an EMPTY default allowlist: real entries
// (MTN MoMo, Airtel Money, eKash universal links) need the providers'
// published link specs and sign-off. Until then every provider link is
// rejected `provider_not_allowlisted`, which is the safe default.

export type ProviderLinkAllowEntry = {
  /** Stable label / slug shown on the review screen. */
  provider: string;
  /** Exact hostnames (lower-case, no port). A subdomain is NOT implied. */
  hosts: string[];
  /** If set, the URL path must start with one of these. */
  pathPrefixes?: string[];
};

/** Default: empty. Populated only with provider-verified entries. */
export const PROVIDER_LINK_ALLOWLIST: readonly ProviderLinkAllowEntry[] = [];

/** The registrable-ish brand token of a host, e.g.
 *  `pay.mtn.co.rw` -> `mtn`. Used only for lookalike detection. */
function brandToken(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return host;
  // second-to-last label, unless it's a common 2-level ccTLD chunk
  const sld = parts[parts.length - 2];
  if ((sld === "co" || sld === "com" || sld === "org" || sld === "net") && parts.length >= 3) {
    return parts[parts.length - 3];
  }
  return sld;
}

export type ProviderLinkCheck =
  | { ok: true; provider: string; url: string }
  | {
      ok: false;
      reason: Extract<
        RejectionReason,
        | "provider_not_allowlisted"
        | "lookalike_host"
        | "embedded_credentials"
        | "unsafe_scheme"
        | "not_recognised"
      >;
    };

export function checkProviderLink(
  rawUrl: string,
  allowlist: readonly ProviderLinkAllowEntry[] = PROVIDER_LINK_ALLOWLIST,
): ProviderLinkCheck {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not_recognised" };
  }

  if (u.protocol !== "https:") return { ok: false, reason: "unsafe_scheme" };
  if (u.username || u.password) return { ok: false, reason: "embedded_credentials" };

  const host = u.hostname.toLowerCase();
  const entry = allowlist.find((e) => e.hosts.map((h) => h.toLowerCase()).includes(host));

  if (!entry) {
    // Lookalike: an allowlisted provider's brand token appears somewhere
    // in this (non-allowlisted) host - `pay-mtn.co.rw.evil.test`,
    // `mtn.co.rw`, `momo.example.com`. Not a homoglyph defence, but it
    // catches the common typo-squat / subdomain-suffix tricks.
    const brandCollision = allowlist.some((e) =>
      e.hosts.some((h) => {
        const brand = brandToken(h.toLowerCase());
        return brand.length >= 3 && host.includes(brand);
      }),
    );
    return {
      ok: false,
      reason: brandCollision ? "lookalike_host" : "provider_not_allowlisted",
    };
  }

  if (
    entry.pathPrefixes &&
    entry.pathPrefixes.length > 0 &&
    !entry.pathPrefixes.some((p) => u.pathname.startsWith(p))
  ) {
    return { ok: false, reason: "provider_not_allowlisted" };
  }

  // Re-serialise from the parsed URL - drops any fragment games and
  // normalises the form we'd hand to the launcher in R3.
  return { ok: true, provider: entry.provider, url: u.toString() };
}
