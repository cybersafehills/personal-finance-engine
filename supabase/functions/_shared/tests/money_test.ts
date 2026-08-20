import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  addRwf,
  assertSafeRwfInteger,
  isSafeRwfInteger,
  negateRwf,
} from "../money.ts";

Deno.test("isSafeRwfInteger accepts whole-number integers within safe range", () => {
  assertEquals(isSafeRwfInteger(0), true);
  assertEquals(isSafeRwfInteger(1000), true);
  assertEquals(isSafeRwfInteger(Number.MAX_SAFE_INTEGER), true);
});

Deno.test("isSafeRwfInteger rejects fractional and unsafe values", () => {
  assertEquals(isSafeRwfInteger(10.5), false);
  assertEquals(isSafeRwfInteger(Number.NaN), false);
  assertEquals(isSafeRwfInteger(Number.POSITIVE_INFINITY), false);
  assertEquals(isSafeRwfInteger(Number.MAX_SAFE_INTEGER + 1), false);
});

Deno.test("assertSafeRwfInteger throws with a labeled message for invalid input", () => {
  assertThrows(
    () => assertSafeRwfInteger(1.5, "amount_rwf"),
    RangeError,
    "amount_rwf",
  );
});

Deno.test("addRwf sums multiple whole-RWF integers exactly", () => {
  assertEquals(addRwf(1000, -200, -20), 780);
  assertEquals(addRwf(0, 0), 0);
});

Deno.test("addRwf validates every operand", () => {
  assertThrows(() => addRwf(100, 1.5));
});

Deno.test("negateRwf flips sign without producing negative zero", () => {
  assertEquals(negateRwf(500), -500);
  assertEquals(negateRwf(-500), 500);
  assertEquals(negateRwf(0), 0);
  assertEquals(Object.is(negateRwf(0), -0), false);
});
