import {
  PUSH_GENERIC_ERROR_MESSAGE,
  PUSH_NOT_CONFIGURED_MESSAGE,
  pushFailureMessage,
} from "../push-errors";

describe("pushFailureMessage", () => {
  it("says alerts aren't set up when Firebase is missing (retrying cannot help)", () => {
    expect(
      pushFailureMessage(
        new Error(
          "Fetching the token failed: Default FirebaseApp is not initialized in this process me.oneledger.companion.",
        ),
      ),
    ).toBe(PUSH_NOT_CONFIGURED_MESSAGE);
    expect(pushFailureMessage(new Error("FCM token registration failed"))).toBe(PUSH_NOT_CONFIGURED_MESSAGE);
    expect(pushFailureMessage("missing google-services.json")).toBe(PUSH_NOT_CONFIGURED_MESSAGE);
  });

  it("keeps the generic retry message for everything else", () => {
    expect(pushFailureMessage(new Error("Network request failed"))).toBe(PUSH_GENERIC_ERROR_MESSAGE);
    expect(pushFailureMessage(undefined)).toBe(PUSH_GENERIC_ERROR_MESSAGE);
    expect(pushFailureMessage({ message: "firebase" })).toBe(PUSH_GENERIC_ERROR_MESSAGE);
  });
});
