import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkProviderLink,
  PROVIDER_LINK_ALLOWLIST,
  type ProviderLinkAllowEntry,
} from "./provider-link.ts";

const ALLOW: ProviderLinkAllowEntry[] = [
  { provider: "MTN MoMo", hosts: ["pay.mtn.co.rw"], pathPrefixes: ["/momo/"] },
  { provider: "Airtel Money", hosts: ["airtelmoney.example"] },
];

Deno.test("default allowlist is empty - every provider link is rejected", () => {
  assertEquals(PROVIDER_LINK_ALLOWLIST.length, 0);
  const r = checkProviderLink("https://pay.mtn.co.rw/momo/x");
  assert(!r.ok);
  assertEquals(r.reason, "provider_not_allowlisted");
});

Deno.test("an allowlisted host + path prefix is accepted and re-serialised", () => {
  const r = checkProviderLink("https://pay.mtn.co.rw/momo/pay?amt=1#frag", ALLOW);
  assert(r.ok);
  assertEquals(r.provider, "MTN MoMo");
  assert(r.url.startsWith("https://pay.mtn.co.rw/momo/pay"));
});

Deno.test("an allowlisted host with a disallowed path is rejected", () => {
  const r = checkProviderLink("https://pay.mtn.co.rw/evil", ALLOW);
  assert(!r.ok);
  assertEquals(r.reason, "provider_not_allowlisted");
});

Deno.test("http (not https) is rejected as unsafe", () => {
  const r = checkProviderLink("http://airtelmoney.example/pay", ALLOW);
  assert(!r.ok);
  assertEquals(r.reason, "unsafe_scheme");
});

Deno.test("embedded credentials are rejected", () => {
  const r = checkProviderLink("https://user:pw@airtelmoney.example/pay", ALLOW);
  assert(!r.ok);
  assertEquals(r.reason, "embedded_credentials");
});

Deno.test("a lookalike of an allowlisted brand is called out distinctly", () => {
  const r = checkProviderLink("https://pay-mtn.co.rw.evil.test/momo/x", ALLOW);
  assert(!r.ok);
  // brand token "mtn" collides with the allowlisted host's brand token
  assertEquals(r.reason, "lookalike_host");
});

Deno.test("an entirely unrelated host is 'not allowlisted', not 'lookalike'", () => {
  const r = checkProviderLink("https://totally-unrelated.example/pay", ALLOW);
  assert(!r.ok);
  assertEquals(r.reason, "provider_not_allowlisted");
});

Deno.test("garbage that isn't a URL is not_recognised", () => {
  const r = checkProviderLink("http://[::::]", ALLOW);
  assert(!r.ok);
  assertEquals(r.reason, "not_recognised");
});
