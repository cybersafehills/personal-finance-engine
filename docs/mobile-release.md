# Mobile app release (EAS)

How the OneLedger mobile app (`oneledger-mobile/`, ADR 0019) is built and
shipped. Builds run on Expo's servers (EAS Build); nobody needs an Android SDK
or Xcode.

## Where things stand

| Item | State |
|---|---|
| Expo project | `@dolyindesign/oneledger` (personal account), id in `app.json` `extra.eas.projectId` |
| Build profiles | `preview` (installable APK for testers), `production` (store bundle). `eas.json` |
| App version | `2.0.0` (successor to the companion's `1.0.3`); Android `versionCode` 10, iOS `buildNumber` 1 |
| Cloud build workflow | `.github/workflows/mobile-build.yml`, manual only |
| Android signing | EAS-managed keystore (the companion was never on a store); back it up after the first build |
| App icon / splash | **Template placeholders. Blocker for any store build** |
| iOS | Waits for the Apple Developer Program membership |

## One-time setup

1. **Log in locally** (already done on this machine): `npx eas-cli whoami`.
2. **Build-time settings.** `.env.local` is git-ignored and EAS never sees it.
   From `oneledger-mobile/`, run `./scripts/set-eas-env.sh`. It copies
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public by
   design, compiled into the app) into EAS for `preview` and `production`. It
   sends them to Expo's servers, so run it yourself. `EXPO_PUBLIC_API_BASE_URL`
   is set per profile in `eas.json` (`https://www.oneledger.me`; the apex domain
   redirects).
3. **GitHub secret** `EXPO_TOKEN` for the cloud-build workflow: expo.dev ->
   Account settings -> Access tokens -> create -> repo Settings -> Secrets ->
   Actions. (Or just run `eas build` from a terminal; the workflow is a
   convenience.)

## Test build (no store account needed)

Actions -> **Mobile cloud build** -> Run workflow -> `android` / `preview`, or
locally: `cd oneledger-mobile && npx eas-cli build -p android --profile preview`.
Expo prints a build page with an install link/QR; open it on an Android phone
to install the APK. This is the first real way to try the native capture
engine on a device. **No Android build has ever been run on a phone yet.**

## Android signing

The standalone companion (`me.oneledger.companion`) was **never uploaded to
any store**; it was only installed from a download link. So Play places no
constraint on the new app's keys, and **EAS can generate and manage the
keystore** (`eas build` offers this on the first production build).

- **Back the keystore up.** After the first build run `eas credentials -p
  android` and download a copy to a password manager. Losing the upload key
  means a support request to Google.
- **Existing installs of the companion.** Android only updates an app in place
  when the new APK is signed with the same key as the installed one. The
  companion's release APKs were signed with `oneledger-shortcuts-upload.jks`;
  a `preview` build signed by EAS will not install over them. Either
  uninstall the companion first (the phone then needs reconnecting, which is
  one tap in the new app), or upload that keystore to the `preview` profile in
  `eas credentials`. A debug-build companion
  (`me.oneledger.companion.debug`) never conflicts.
- `preview` APKs are for testers; Play never sees them.
- `versionCode` starts at 10. The companion's `versionCode` 4 was never on
  Play, so this is only a safe margin.

## Store submission

### Google Play (Android)

1. Production bundle: `eas build -p android --profile production` (or the
   workflow with `production`).
2. Submit: create a Play service account with release permission, upload its
   JSON key to EAS (`eas credentials`), then `eas submit -p android
   --profile production` (track `internal`).
3. **Update the Play Data safety form and store listing.** The companion only
   sent MoMo message text. The app also signs the user in and shows their
   transactions, balance and notifications, and registers a push token once
   alerts are turned on. The privacy policy page (`/legal/android-privacy`) is
   written for the companion and must be updated to match before production.
4. The notification-access declaration (docs/android-companion-release.md
   3.1) still applies to production.
5. Personal Play accounts may need a closed test with testers for a minimum
   period before production access; check Play Console for current rules.

### App Store (iOS)

Needs the Apple Developer Program membership
(`docs/mobile-apple-developer-setup.md`). Then: register the bundle id
`me.oneledger.app`, create the app in App Store Connect, `eas build -p ios
--profile production`, `eas submit -p ios`. Also needed: privacy nutrition
labels, a privacy policy URL, and screenshots. iOS capture is the Shortcuts
guide, so the Shortcuts must be published first
(docs/oneledger-capture-shortcut.md "Publishing").

## Blockers before any store build

- **Real app icon, splash and store graphics.** `assets/` still holds the Expo
  template artwork. Brand rules (`docs/ONELEDGER_BRAND_ASSETS.md`) forbid
  redrawing or recolouring the mark, so each slot below must be filled from an
  approved brand file, resized only if the source is larger than the slot.
  See "Brand asset slots".
- **Privacy policy / Data safety** updates (above).
- **Push** (docs/mobile-push.md) is optional for a first release; nothing needs
  it to be on.

## Versioning

Bump `expo.version` (human) and `expo.android.versionCode` (integer, always
increasing) / `expo.ios.buildNumber` in `app.json` for every store upload.
`appVersionSource` is `local`, so these files are the source of truth.

## Brand asset slots

Every place the app and the store listings need artwork. A source that is too
small for a slot is **reported, not upscaled**. In the app config these are
the files under `oneledger-mobile/assets/`.

| Slot | File / where | Required |
|---|---|---|
| App icon (iOS App Store icon, and the default icon) | `assets/icon.png` (`expo.icon`) | 1024x1024 PNG, **opaque (no alpha)**, square corners (the OS rounds them), no transparency anywhere |
| Android adaptive icon, foreground | `assets/android-icon-foreground.png` | 1024x1024 PNG with alpha. Keep the mark inside the centre ~66% (a ~683 px circle); the OS crops the rest |
| Android adaptive icon, background | `assets/android-icon-background.png` (or the colour `#07143A` in `app.json`) | 1024x1024 PNG, or a flat colour |
| Android themed (monochrome) icon | `assets/android-icon-monochrome.png` | 1024x1024 PNG, single colour on transparent, same safe zone as the foreground |
| Splash mark | `assets/splash-icon.png` | 1024x1024 PNG, alpha allowed; shown centred on the splash background colour |
| Android notification icon (push) | not set yet (`expo-notifications` plugin `icon`) | 96x96 PNG, **white on transparent** (Android renders it as a silhouette) |
| Web preview favicon | `assets/favicon.png` | 48x48 or larger PNG (development preview only) |
| Play Store hi-res icon | Play Console upload | exactly 512x512 PNG, 32-bit, up to 1 MB |
| Play Store feature graphic | Play Console upload | exactly 1024x500 PNG or JPG, no alpha |
| Play Store phone screenshots | Play Console upload | 2 to 8; 16:9 or 9:16; each side 320 to 3840 px |
| App Store screenshots | App Store Connect upload | iPhone 6.9" 1320x2868 (or 6.7" 1290x2796); iPad not needed (`supportsTablet` is false) |

Brand files already in the repo (`brand-source/oneledger/`), checked against
these slots: `standalone-icon.png` is 510x511 with alpha, which is **too small
for every 1024 slot** and one pixel short of the 512x512 Play icon.
