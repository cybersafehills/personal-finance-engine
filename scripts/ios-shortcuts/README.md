# OneLedger Shortcut releases

The current release is **3.0.0**, one installed shortcut named **OneLedger Capture**.
Apple installer: https://www.icloud.com/shortcuts/cd5a678737e14ba79eda55a98a26acd0

Run `python3 scripts/ios-shortcuts/build.py` to generate credential-free source plists, then `python3 -m unittest discover -s scripts/ios-shortcuts` for protocol regression checks. The combined source is `source/v3/OneLedger Capture.shortcut`. Sign with Apple's `shortcuts sign --mode anyone --input <absolute-source> --output <absolute-release>`. Keep the output basename unchanged.

The release was imported into Apple Shortcuts and shared using **Copy iCloud Link**. The published iCloud record reports APPROVED, with 35 actions and 24 resolved action-output references. The direct `.shortcut` file remains an archival artifact; it is not the normal install link because Safari downloads it rather than opening Apple's Add Shortcut preview.

The combined workflow routes pairing input to an explicit foreground confirmation **before** any pairing request. Message text is untrusted: an incoming pairing-shaped message must never silently replace the account connection. All other input follows the capture path, with no picker or pairing prompt. Empty input sends a connection test without a ledger transaction. Missing local configuration shows a connect-first message. Failed pairing never overwrites an existing configuration.

Both legacy and combined releases use `oneledger-config.json` in the iCloud Drive Shortcuts folder. A new install must allow file/network permissions in the foreground before relying on background execution. Replacing an installed shortcut does not by itself prove the Messages trigger is configured.

## iOS compatibility

- **iOS 27:** edit the installed OneLedger Capture → Edit → Automation → Message. Change the first Sender condition to Message contains RWF; do not leave an unfinished Sender row. Automation on; Confirm Before Run off; allow running when locked under Info → Privacy. Return with the back arrow to save.
- **iOS 17–26:** use the Automation tab and Message trigger, choose Run Immediately, then run OneLedger Capture with the incoming message as Shortcut Input.
- Older iOS versions are not promised unattended Message recording. No claim is made that every OS/device combination has been physically tested.

Sources: https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27 and https://support.apple.com/en-euro/guide/shortcuts-mac/apdf01f8c054/mac

A phone's server-side pairing consumption proves connection; a connection test proves only its API path. An actual incoming transaction message is required to confirm background recording. No loading-time or universal compatibility guarantee is inferred from static tests or the Mac preview.

The v2 sources are retained for previous installs. The corrected legacy Connect installer is https://www.icloud.com/shortcuts/60d740e6248d400ab6bac9e1597eadf1.
