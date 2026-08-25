import "server-only";

// The one canonical URL every Server Action builds links against -
// signup confirmation, password reset, invite links. Deliberately NOT
// derived from window.location.origin or the request's Host header: the
// app is reachable at more than one hostname (the raw Vercel deployment
// URL, the www vs bare apex, preview URLs), and whichever one a person
// happened to be browsing from when they triggered the action has no
// business leaking into an emailed link - the link should always point
// at the one real address, oneledger.me.
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    throw new Error("SITE_URL must be set (server-only, see .env.local.example).");
  }
  return url;
}
