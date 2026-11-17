import { assertEquals } from "jsr:@std/assert@1";
import { isLoopbackHost, shouldUseSecureCookie } from "./cookie-security.ts";

Deno.test("loopback hosts are recognised with and without a port", () => {
  for (const host of [
    "localhost",
    "localhost:3000",
    "LOCALHOST:3000",
    "127.0.0.1",
    "127.0.0.1:3417",
    "127.1.2.3:80",
    "[::1]",
    "[::1]:3000",
  ]) {
    assertEquals(isLoopbackHost(host), true, host);
    assertEquals(shouldUseSecureCookie(host), false, host);
  }
});

Deno.test("every other host keeps Secure cookies", () => {
  for (const host of [
    null,
    undefined,
    "",
    "oneledger.me",
    "www.oneledger.me",
    "app.vercel.app:443",
    "localhost.evil.example",
    "127.0.0.1.evil.example",
    "10.0.0.5:3000",
    "[2001:db8::1]:443",
  ]) {
    assertEquals(isLoopbackHost(host), false, String(host));
    assertEquals(shouldUseSecureCookie(host), true, String(host));
  }
});
