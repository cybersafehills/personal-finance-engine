# OneLedger Shortcut releases

The current release is **3.1.0**, one installed shortcut named **OneLedger Capture**.
Apple installer: https://www.icloud.com/shortcuts/d8ea3c4ec279424c9d08fe3512d350c9

Run `python3 scripts/ios-shortcuts/build.py` to generate credential-free source plists, then `python3 -m unittest discover -s scripts/ios-shortcuts` for protocol regression checks. The combined source is `source/v3/OneLedger Capture.shortcut`. Sign with Apple's `shortcuts sign --mode anyone --input <absolute-source> --output <absolute-release>`. Keep the output basename unchanged.

The release was imported into Apple Shortcuts and shared using **Copy iCloud Link**. The published iCloud record reports APPROVED, with 46 actions and resolved action-output references. The direct `.shortcut` file remains an archival artifact; it is not the normal install link because Safari downloads it rather than opening Apple's Add Shortcut preview.

The combined workflow routes pairing input to an explicit foreground confirmation **before** any pairing request. Message text is untrusted: an incoming pairing-shaped message must never silently replace the account connection. All other input follows the capture path, with no picker or pairing prompt. The app passes `oneledger:test` for an explicit no-ledger test. Blank message input never goes to the capture API. The response must contain `test` before the shortcut reports success. A final Nothing action suppresses implicit response-dictionary output. Missing local configuration shows a connect-first message. Failed pairing never overwrites an existing configuration.

Both legacy and combined releases use `oneledger-config.json` in the iCloud Drive Shortcuts folder. A new install must allow file/network permissions in the foreground before relying on background execution. Replacing an installed shortcut does not by itself prove the Messages trigger is configured.

## iOS compatibility

- **iOS 27:** open Shortcuts → Automation and finish the Message trigger. Add Run Shortcut → OneLedger Capture below it, with the received message as Input. A trigger in a blank New Shortcut without this action records nothing. Change the first Sender condition to Message contains RWF; do not leave an unfinished Sender row. Automation on; Confirm Before Run off; if offered, allow running when locked from the bottom-toolbar circled Info icon → Privacy. Skip that optional setting if it is absent. Return with the back arrow to save.
- **iOS 17–26:** use the Automation tab and Message trigger, choose Run Immediately, then run OneLedger Capture with the incoming message as Shortcut Input.
- Older iOS versions are not promised unattended Message recording. No claim is made that every OS/device combination has been physically tested.

Sources: https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27 and https://support.apple.com/en-euro/guide/shortcuts-mac/apdf01f8c054/mac

A phone's server-side pairing consumption proves connection; a connection test proves only its API path. An actual incoming transaction message is required to confirm background recording. No loading-time or universal compatibility guarantee is inferred from static tests or the Mac preview.

The v2 sources are retained for previous installs. The corrected legacy Connect installer is https://www.icloud.com/shortcuts/60d740e6248d400ab6bac9e1597eadf1.

The v3.1 JSON POST serializer was executed in Apple Shortcuts against a loopback-only checker with dummy data: exactly `{op: "test", client_version: "3.1.0"}` and the expected dummy device header arrived. This checks serialization, not a real iPhone Messages trigger. The mobile verification screen now reads an owner-scoped successful-test audit event after the current test was started, rather than accepting historical `last_used_at`.
