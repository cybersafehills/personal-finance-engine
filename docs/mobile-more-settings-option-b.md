# Mobile More and Settings — Option B

Implements the approved direct-list design on `preview/live`, alongside the existing theme, contact, and merchant-poster work.

More has a native title and notification entry, a real account/Space summary, tool search, and compact Money, Documents, Payments, and Account lists. Tools retain their current routes and server feature gates. Recording setup moves into a compact account row using the existing Android or iPhone health information; detailed setup remains in its existing screen. More owns its safe area instead of showing the shared tab header twice.

Settings exposes individual preferences directly in grouped lists. Browser destinations carry a Web label and preserve their existing URLs. Appearance and App lock show current values. Sign out requires confirmation on both native and web. Appearance and Pay button use selected rows with checks; App lock retains its protected enable/disable flow. Phone-alert registration and permission handling move from More to Notifications alongside the existing inbox.

These changes do not add native dependencies, replace browser workflows, change payment behavior, or change feature availability. Other list components retain their existing appearance through an opt-in menu variant. Live account data is used throughout; prototype balances and names were not copied into the application.

## Validation

- All 1,209 Jest tests passed, including navigation, search, feature visibility, permission failures, recording status, sign-out confirmation, and existing payment/security behavior.
- Expo lint and TypeScript checking passed.
- The existing Metro server at port 8082 successfully compiled iOS and Android bundles containing the redesign.
- No new native binary was produced for this JavaScript UI change. Physical-device appearance and interaction should be reviewed by reloading Expo Go at `exp://192.168.1.4:8082` on the same Wi-Fi as the Mac.

## Phone review

Open More, search for a tool, clear the search, and scroll through all groups. Open Settings and test Appearance, Pay button, and Notifications. Check that browser entries are clearly marked, and that cancelling Sign out keeps the account signed in. Device recording and App lock continue to reflect device capability and actual configuration.
