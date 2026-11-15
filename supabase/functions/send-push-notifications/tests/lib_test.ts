import { assertEquals } from "jsr:@std/assert@1";
import {
  buildOutboundPushes,
  chunk,
  type PendingPush,
  pushConfig,
  summarizePush,
  summarizeTickets,
} from "../lib.ts";

const env = (values: Record<string, string>) => (key: string) => values[key];

const row = (
  id: string,
  tokens: string[],
  body: string | null = "b",
): PendingPush => ({
  id,
  title: `title-${id}`,
  body,
  event_key: "budget.threshold",
  resource_type: "budget",
  resource_id: "11111111-1111-1111-1111-111111111111",
  tokens,
});

Deno.test("push is dark unless the flag is exactly 'true'", () => {
  assertEquals(pushConfig(env({})).enabled, false);
  assertEquals(
    pushConfig(env({ PUSH_NOTIFICATIONS_ENABLED: "TRUE" })).enabled,
    false,
  );
  assertEquals(pushConfig(env({ PUSH_NOTIFICATIONS_ENABLED: "true" })), {
    enabled: true,
    accessToken: null,
  });
  assertEquals(
    pushConfig(
      env({ PUSH_NOTIFICATIONS_ENABLED: "true", EXPO_ACCESS_TOKEN: " t " }),
    ),
    { enabled: true, accessToken: "t" },
  );
});

Deno.test("one message per phone, deduped, carrying IDs only in data", () => {
  const pushes = buildOutboundPushes([
    row("n1", [
      "ExponentPushToken[a]",
      "ExponentPushToken[b]",
      "ExponentPushToken[a]",
    ]),
    row("n2", []),
  ]);
  assertEquals(pushes.length, 2);
  assertEquals(pushes.map((p) => p.message.to), [
    "ExponentPushToken[a]",
    "ExponentPushToken[b]",
  ]);
  assertEquals(pushes[0].notificationId, "n1");
  assertEquals(pushes[0].message.data, {
    notificationId: "n1",
    eventKey: "budget.threshold",
    resourceType: "budget",
    resourceId: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(pushes[0].message.title, "title-n1");
  assertEquals(pushes[0].message.body, "b");
});

Deno.test("an empty or blank body is omitted rather than sent as blank", () => {
  assertEquals(
    "body" in buildOutboundPushes([row("n", ["t"], null)])[0].message,
    false,
  );
  assertEquals(
    "body" in buildOutboundPushes([row("n", ["t"], "  ")])[0].message,
    false,
  );
});

Deno.test("chunk splits into batches and handles empty input", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 100), []);
});

Deno.test("a notification is delivered if any of its phones accepts it", () => {
  const sent = buildOutboundPushes([row("n1", ["a", "b"])]);
  const result = summarizeTickets(sent, [
    { status: "error", message: "boom" },
    { status: "ok" },
  ]);
  assertEquals(result, { deliveredIds: ["n1"], retryIds: [], deadTokens: [] });
});

Deno.test("transient failures and missing tickets are retried", () => {
  const sent = buildOutboundPushes([row("n1", ["a"]), row("n2", ["b"])]);
  const result = summarizeTickets(sent, [
    { status: "error", details: { error: "MessageRateExceeded" } },
    undefined,
  ]);
  assertEquals(result.deliveredIds, []);
  assertEquals(result.retryIds, ["n1", "n2"]);
  assertEquals(result.deadTokens, []);
});

Deno.test("dead tokens are reported, and a row with only dead phones is not retried", () => {
  const sent = buildOutboundPushes([
    row("n1", ["dead"]),
    row("n2", ["dead", "live"]),
  ]);
  const result = summarizeTickets(sent, [
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "ok" },
  ]);
  assertEquals(result.deliveredIds, ["n1", "n2"]);
  assertEquals(result.retryIds, []);
  assertEquals(result.deadTokens, ["dead"]);
});

Deno.test("a dead phone plus a transient failure on another is retried", () => {
  const sent = buildOutboundPushes([row("n1", ["dead", "flaky"])]);
  const result = summarizeTickets(sent, [
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", details: { error: "MessageRateExceeded" } },
  ]);
  assertEquals(result.retryIds, ["n1"]);
  assertEquals(result.deadTokens, ["dead"]);
});

Deno.test("the summary carries counts only", () => {
  const summary = summarizePush(true, 3, 4, {
    deliveredIds: ["a", "b"],
    retryIds: ["c"],
    deadTokens: ["t"],
  });
  assertEquals(summary, {
    enabled: true,
    claimed: 3,
    messages: 4,
    delivered: 2,
    retry: 1,
    deadTokens: 1,
  });
  assertEquals(
    summarizePush(false, 0, 0, {
      deliveredIds: [],
      retryIds: [],
      deadTokens: [],
    }, "off")
      .reason,
    "off",
  );
});
