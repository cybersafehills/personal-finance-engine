import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  forcedAmountModeFor,
  isImportBatchOpen,
  isImportRecordCommittable,
  isImportTargetObject,
} from "./model.ts";

Deno.test("isImportTargetObject guards the search-param / form value", () => {
  assert(isImportTargetObject("transaction"));
  assert(isImportTargetObject("expense"));
  assert(isImportTargetObject("income"));
  assert(!isImportTargetObject("invoice"));
  assert(!isImportTargetObject(""));
});

Deno.test("forcedAmountModeFor locks expense/income direction, leaves transaction free", () => {
  assertEquals(forcedAmountModeFor("expense"), "all_out");
  assertEquals(forcedAmountModeFor("income"), "all_in");
  assertEquals(forcedAmountModeFor("transaction"), null);
});

Deno.test("batch/record lifecycle predicates are unchanged", () => {
  assert(isImportBatchOpen("profiled"));
  assert(!isImportBatchOpen("imported"));
  assert(isImportRecordCommittable("ready"));
  assert(isImportRecordCommittable("approved"));
  assert(!isImportRecordCommittable("needs_review"));
});
