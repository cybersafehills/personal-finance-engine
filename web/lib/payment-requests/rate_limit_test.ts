import { assertEquals } from "jsr:@std/assert@1";
import { clientIp, createRateLimiter } from "./rate-limit.ts";

Deno.test("allows up to the limit per window, then limits, then resets", () => {
  let t = 1000;
  const limited = createRateLimiter({
    limit: 3,
    windowMs: 60_000,
    now: () => t,
  });
  assertEquals([limited("a"), limited("a"), limited("a")], [
    false,
    false,
    false,
  ]);
  assertEquals(limited("a"), true);
  assertEquals(limited("b"), false); // keys are independent
  t += 60_001;
  assertEquals(limited("a"), false); // new window
});

Deno.test("memory is bounded by maxKeys", () => {
  let t = 0;
  const limited = createRateLimiter({
    limit: 1,
    windowMs: 1000,
    maxKeys: 3,
    now: () => t,
  });
  for (const k of ["a", "b", "c", "d", "e"]) limited(k); // never throws / grows unbounded
  // 'a' was evicted, so it starts fresh rather than staying limited
  assertEquals(limited("a"), false);
  t += 2000;
  for (const k of ["x", "y", "z", "w"]) assertEquals(limited(k), false);
});

Deno.test("clientIp takes the first forwarded hop", () => {
  assertEquals(clientIp("1.2.3.4, 5.6.7.8"), "1.2.3.4");
  assertEquals(clientIp(null), "unknown");
  assertEquals(clientIp("  "), "unknown");
});
