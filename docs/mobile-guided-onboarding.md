# OneLedger task-based guides — revision 3

This replaces the previous 60-pointer walkthrough. The implementation is in the running `preview/live` checkout at `/private/tmp/claude-501/ol-work/pay2`. The primary workspace contains the installer, screenshots and a reviewable source patch.

## Experience

A new account gets an optional **three-pointer introduction**: Home, where to open activity, and how to search. It ends on Transactions. There is no all-platform sequence and no automatic chaining between guides.

All other guides focus on one user task. Each has **two or three steps**, connects only the pages needed for that task, then ends with **Done** on the relevant page. A user chooses another task only when they want one.

Guides & help groups the catalog by intent:

| Group | Example tasks |
| --- | --- |
| Start here | Your first look, check a wallet, record cash, automatic recording setup |
| Track & understand | Find a transaction, inspect details, review an item, read spending patterns, find a person |
| Plan your money | Read a budget, follow a goal, explore a category, find a bill |
| Pay & request | Find Pay, understand Scan, request payment, inspect payment status, reuse a template, find a service code |
| Records & preferences | Read reports, find statements, manage profile, change appearance, app lock, Spaces |

Only Start here is expanded initially. Search reveals matching tasks across groups. Each task shows its own small step count and Start / Resume / Replay. There is no global completion checklist or 60-step progress counter.

## Compact coachmarks

- Maximum width: 320 pt, with 12 pt minimum viewport margins.
- Maximum height: 300 pt **and** 44% of the usable screen, whichever is smaller. These are design limits, not claims about a platform-mandated percentage.
- Actual normal-text browser measurements: 174 pt tall on 375×812 (21% of viewport) and 193 pt tall on 320×640 (30%). An enlarged-text proxy stayed at 271 pt (42%) on the small viewport.
- One short explanation, a 1/2 or 1/3 count, Back/Next or Done, and an accessible close control.
- No large illustration, stacked secondary buttons, global section progress or full-height fallback panel.
- Prefer a clear position above/below the target, or beside it on wider screens. A large section focuses the highlight on its heading. A clipped target uses the same bounded card without a misleading pointer.
- The page remains readable behind a light scrim. Tapping outside, pressing Escape/system Back or using the close control pauses the guide.
- Copy scrolls inside the bounded panel at enlarged text sizes; navigation actions remain outside that scrolling area. Text is not shrunk to fit.

The direction follows Apple's recommendation to use optional, context-specific tips near the relevant UI: https://developer.apple.com/design/human-interface-guidelines/onboarding.md.

## Progress and behavior

Progress remains versioned and isolated per authenticated user. Revision-3 stable step IDs prevent old long-tour positions from resuming at an unrelated task pointer. Existing welcome dismissals are preserved. An older completed introduction can be explicitly replayed as the new short introduction.

The introduction does not suppress later contextual task help. At most one contextual invitation is offered per session; dismissals and progress remain task-specific. Completed or paused tasks do not repeatedly interrupt the user.

Missing data or unsupported features offer Skip item or close. A guide that cannot continue remains resumable. No sample transaction, account or budget is created. App lock, backgrounding, keyboard display and switching Space still pause guidance. Dynamic detail routes live only in the current run's memory.

Native sheet navigation keeps the dismissal barrier: the tutorial Modal leaves before Pay or device setup opens, and returns after the native transition. Pausing cancels queued navigation.

## Action boundary

Guides navigate and explain. They do not submit forms, change themes or security, grant permissions, start a camera, dial a code, generate records, invite people or initiate payments. Those remain explicit product actions.

## Verification

- Full mobile suite: **1,320 tests across 136 suites pass**.
- TypeScript, Expo lint and whitespace checks pass.
- Real GuideOverlay component exported with React Native Web and Geist fonts in an isolated, authentication-free layout harness. Browser checks cover standard/small screens, bottom targets, large sections, dark mode, enlarged text, Next, Back and close; no browser JavaScript errors.
- The isolated browser harness shims native-only Appearance.setColorScheme; production theme code is unchanged.
- iOS production JavaScript/Hermes export succeeds. No signed iPhone binary is claimed.
- Physical-device native transitions, TalkBack and VoiceOver still require device checks.

Review images in `design-previews/guided-onboarding/`: `task-mobile.png`, `task-small.png`, `task-bottom.png`, `task-dark.png`, `task-section.png`, `task-large-text.png`. They show illustrative page content around the actual guide component.

## Test the updated app

Open More → Guides & help. Start Your first look and verify it ends after three pointers. Expand one task group, start a task and check its two/three-step flow. Done should close the guide on that feature page, with no next-topic launch. Close midway and use Resume to return to that task. Search for “statement” to see the separate statement guide.

The older `oneledger-connected-tour-preview.apk` contains the rejected long walkthrough. Use the task-guides installer recorded below for revision 3.

## Revision-3 Android installer

- `oneledger-mobile/dist/native/oneledger-task-guides-preview.apk` in the primary workspace.
- ARM64 release variant with bundled JavaScript; Metro is not required. Development-key signed for internal testing; APK v2 signature verifies.
- SHA-256: `6392b920c353bca3cd2b8120681c35bccb605f01ff2ae4e7e2c5ae325958273a`. Size: 62,285,068 bytes.
- The packaged source matches the tested live checkout, including the task groups, revision-3 progress and compact panel limits.
- Metadata: `oneledger-mobile/dist/native/oneledger-task-guides-build.json`.
- Build succeeded locally. The older long-tour installer remains separate.
