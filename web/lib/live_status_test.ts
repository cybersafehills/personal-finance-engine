import { assertEquals } from "jsr:@std/assert@1";
import { connectionFromChannelStatus, describeLive } from "./live-status.ts";

Deno.test("shows nothing while connecting", () => {
  assertEquals(describeLive("connecting", false), null);
  assertEquals(describeLive("connecting", true), null);
});

Deno.test("live says Live, and Updated right after a change", () => {
  assertEquals(describeLive("live", false), { text: "Live", tone: "live" });
  assertEquals(describeLive("live", true), {
    text: "Updated",
    tone: "updated",
  });
});

Deno.test("offline never claims Live, even right after a change", () => {
  assertEquals(describeLive("offline", false)?.text, "Reconnecting…");
  assertEquals(describeLive("offline", true)?.text, "Reconnecting…");
});

Deno.test("channel statuses map to connection states", () => {
  assertEquals(connectionFromChannelStatus("SUBSCRIBED", "connecting"), "live");
  assertEquals(connectionFromChannelStatus("CLOSED", "live"), "offline");
  assertEquals(connectionFromChannelStatus("TIMED_OUT", "live"), "offline");
  assertEquals(
    connectionFromChannelStatus("CHANNEL_ERROR", "connecting"),
    "offline",
  );
  assertEquals(connectionFromChannelStatus("JOINING", "live"), "live");
});
