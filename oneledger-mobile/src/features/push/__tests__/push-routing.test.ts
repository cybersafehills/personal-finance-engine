import { isExpoPushToken, pushTarget } from "../push-routing";

describe("pushTarget", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("opens the transaction for a transaction notification", () => {
    expect(pushTarget({ resourceType: "transaction", resourceId: id })).toEqual({
      pathname: "/transaction/[id]",
      params: { id },
    });
  });

  it("opens the forecast for an insight update, which carries no id", () => {
    expect(pushTarget({ resourceType: "forecast", resourceId: null })).toEqual({ pathname: "/forecast" });
    expect(pushTarget({ resourceType: "forecast" })).toEqual({ pathname: "/forecast" });
  });

  it("opens the notifications list for everything else", () => {
    expect(pushTarget({ resourceType: "budget", resourceId: id })).toEqual({ pathname: "/notifications" });
    expect(pushTarget({ eventKey: "member.joined" })).toEqual({ pathname: "/notifications" });
    expect(pushTarget(null)).toEqual({ pathname: "/notifications" });
    expect(pushTarget("transaction")).toEqual({ pathname: "/notifications" });
  });

  it("never builds a route from a malformed id", () => {
    for (const bad of ["../settings", "", 42, "not-a-uuid", `${id}/x`]) {
      expect(pushTarget({ resourceType: "transaction", resourceId: bad })).toEqual({
        pathname: "/notifications",
      });
    }
  });
});

describe("isExpoPushToken", () => {
  it("matches the server's token rule", () => {
    expect(isExpoPushToken("ExponentPushToken[abc_DEF-123]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken("fcm:abc")).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });
});
