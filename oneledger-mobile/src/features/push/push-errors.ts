// Why turning on phone alerts failed, in words a person can act on.
//
// An Android build without Firebase configured (google-services.json, see
// docs/mobile-push.md) cannot get a push token at all; retrying never helps,
// so say so instead of "try again". Anything unrecognised stays generic.

const NOT_CONFIGURED = /firebase|fcm|google-services|senderid/i;

export const PUSH_NOT_CONFIGURED_MESSAGE =
  "Phone alerts aren't set up in this version of the app yet.";
export const PUSH_GENERIC_ERROR_MESSAGE = "Couldn't turn notifications on. Try again.";

export function pushFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return NOT_CONFIGURED.test(text) ? PUSH_NOT_CONFIGURED_MESSAGE : PUSH_GENERIC_ERROR_MESSAGE;
}
