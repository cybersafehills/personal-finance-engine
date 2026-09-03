import { assertEquals } from "jsr:@std/assert@1";
import {
  isSelfContainedDestination,
  isSyncRunFinished,
} from "./model.ts";

Deno.test("download and webhook need no OAuth provider", () => {
  assertEquals(isSelfContainedDestination("download"), true);
  assertEquals(isSelfContainedDestination("webhook"), true);
  assertEquals(isSelfContainedDestination("cloud_storage"), false);
  assertEquals(isSelfContainedDestination("connected_workbook"), false);
});

Deno.test("sync run terminal states", () => {
  assertEquals(isSyncRunFinished("succeeded"), true);
  assertEquals(isSyncRunFinished("partial"), true);
  assertEquals(isSyncRunFinished("failed"), true);
  assertEquals(isSyncRunFinished("queued"), false);
  assertEquals(isSyncRunFinished("running"), false);
});
