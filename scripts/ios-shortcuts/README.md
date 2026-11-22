# OneLedger Shortcuts release 2.0.0

Run `python3 scripts/ios-shortcuts/build.py` to generate credential-free source plists and `python3 -m unittest discover -s scripts/ios-shortcuts` for regression checks.
Sign each source using Apple's `shortcuts sign --mode anyone --input <absolute-source> --output <absolute-release>`.
Keep output basenames **Connect to OneLedger.shortcut** and **OneLedger Capture.shortcut**: Apple's file installer derives the installed name from the basename.
Signed files are in `web/public/shortcuts/v2`.

This release replaces clipboard pairing with Shortcut Input, uses six independent random outputs for the device secret, saves configuration only when pairing returns a capture URL, and disables Capture's file picker. Both workflows use `oneledger-config.json` in iCloud Drive's Shortcuts folder. Failed pairing does not overwrite an existing connection.

Apple's preview verified both pairing condition subjects and “has any value” operators. Conditional inputs require a nested Type: Variable / Variable: WFTextTokenAttachment wrapper; a bare attachment imports with an empty Condition.

Replace both shortcuts, then run Connect from OneLedger with a fresh code. Allow network/file permissions during the first foreground run. Capture with no input sends op: test, updating device health without a ledger transaction. Configure Messages automation to pass Shortcut Input and Run Immediately. Only an actual incoming message proves background automation on an iPhone.

Files are about 24 KB each. Direct signed downloads avoid iCloud's record preview lookup. Apple/file download/permission delays can still occur; no fixed loading-time improvement has been measured on an iPhone.
