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
| App icon / splash / notification icon | In place (supplied pack); see "Brand asset slots" for the remaining gaps |
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

- **Store graphics.** The app's own icons are in place. Still missing for
  the stores: the Play feature graphic (1024x500), screenshots for both
  stores, and (preferably) a vector source for a sharper 1024 icon. See
  "Brand asset slots".
- **Privacy policy / Data safety** updates (above).
- **Push** (docs/mobile-push.md) is optional for a first release; nothing needs
  it to be on.

## Versioning

Bump `expo.version` (human) and `expo.android.versionCode` (integer, always
increasing) / `expo.ios.buildNumber` in `app.json` for every store upload.
`appVersionSource` is `local`, so these files are the source of truth.

## Brand asset slots

Artwork comes from the supplied mobile asset pack
(`OneLedger_Mobile_Assets_Fixed`), itself composed from the approved
`Standalone icon.png` by alpha-cropping, proportional scaling and centring
only. Provenance is recorded in `docs/ONELEDGER_BRAND_ASSETS.md`.

| Slot | File | State |
|---|---|---|
| App icon / iOS App Store icon | `assets/branding/ios-app-icon-1024.png` | In place. 1024x1024, opaque, mark ~69%. As supplied |
| Android legacy icon (pre-8.0) | `assets/branding/android-legacy-icon-1024.png` | In place. As supplied |
| Android adaptive foreground | `assets/branding/android-adaptive-foreground-safe-1024.png` | In place, **scaled to 72% of the pack's file**: the pack's mark (591 px) was clipped by round launcher masks. Verified under circle, squircle and rounded-square masks |
| Android adaptive background | `#FFFFFF` in `app.json` | In place. Must be light: the mark's "1" is transparent |
| Android themed (monochrome) icon | `assets/branding/android-monochrome-safe-432.png` | In place, pack's white silhouette scaled to 72% for the same reason |
| Android notification icon | `assets/branding/android-notification-96.png` + tint `#0050F4` | In place. Pure white silhouette, as supplied |
| Splash | `assets/branding/splash-logo-1024.png` on `#FFFFFF`, width 220 | In place. Renders the mark at about its native resolution |
| Web preview favicon | `assets/favicon.png` | In place (the web app's approved 48 px favicon) |
| Play Store hi-res icon | `store/google-play/icon-512.png` | Ready to upload. A plain downscale of the iOS icon |
| Play Store feature graphic | none | **Missing.** 1024x500 PNG/JPG, a layout decision for the brand owner |
| Play and App Store screenshots | none | **Missing.** Take them from a real build (Play: 16:9 or 9:16, 320 to 3840 px per side; App Store: iPhone 6.9" 1320x2868) |

### Known limits of the supplied artwork

- **Enlarged, not native.** The source mark is ~318 px wide; the 1024 icons
  are interpolated about 2.2x (the pack's own README says so). Home-screen
  icons are rendered below the source size and stay crisp; the 1024 store
  listing icon is softer. A vector source (SVG / PDF / AI) or a PNG with the
  mark at least ~1500 px wide would fix it.
- **No dark splash.** The pack's navy splash puts the navy mark on an almost
  identical navy field, so only the blue wedge shows. The app is light-only
  (`userInterfaceStyle: light`), so no `dark` variant is configured. If dark
  mode is ever added, that variant needs the brand owner's rework, and its
  `#081839` background is an approximation of the brand navy, not a supplied
  token (`#07143A` is the verified one).
- **Silhouette icons** (notification, themed) are the pack's white versions of
  the mark's alpha channel. Review them on a real phone: a solid square with a
  "1" cut-out is legible but plain.
