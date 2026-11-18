import { backoffDelayMs, classifyError } from "../retry";

describe("backoffDelayMs", () => {
  it("is full-jittered and bounded", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(0);
    expect(backoffDelayMs(3, () => 0.999)).toBeLessThan(16_000);
    expect(backoffDelayMs(50, () => 0.999999)).toBeLessThan(15 * 60_000);
    expect(backoffDelayMs(50, () => 0.5)).toBeGreaterThan(60_000);
  });
});
describe("classifyError", () => {
  it.each([
    [{ message: "invalid_amount" }, "permanent"],
    [{ message: "not_found_or_forbidden" }, "permanent"],
    [{ message: "op_id_conflict" }, "permanent"],
    [{ message: "JWT expired" }, "auth"],
    [{ status: 401 }, "auth"],
    [{ message: "TypeError: Network request failed" }, "network"],
    [{ networkFailure: true }, "network"],
    [{ status: 503 }, "server"],
    [{ status: 409 }, "conflict"],
    [{ message: "weird" }, "server"],
  ])("%j -> %s", (input, kind) => expect(classifyError(input).kind).toBe(kind));
});
