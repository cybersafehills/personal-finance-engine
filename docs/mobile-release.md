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
| Android signing | **Not decided, see "Android signing" below** |
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

## Android signing: read before the first production build

If the standalone companion (`me.oneledger.companion`) was **ever uploaded to
Play** (internal testing counts), Play only accepts updates signed with the
same **upload key**. The new app keeps that package name precisely so existing
installs and the Play listing continue.

- **Companion already on Play:** do NOT let EAS generate a new keystore. Run
  `npx eas-cli credentials -p android`, choose the production profile, and
  upload the existing `oneledger-shortcuts-upload.jks` (alias `upload`; the
  passwords are in your password manager and the repo's
  `ANDROID_KEYSTORE_*` secrets, see `docs/android-companion-release.md` 1).
  `versionCode` must exceed what Play has seen (the companion's last was 4;
  this app starts at 10).
- **Never uploaded to Play:** let EAS generate and store the keystore. Back
  up a copy: losing the upload key means a support request to Google.
- `preview` APKs are for testers; Play never sees them.

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

- **Real app icon and splash.** `assets/` still holds the Expo template
  artwork. Brand rules (`docs/ONELEDGER_BRAND_ASSETS.md`) forbid redrawing the
  mark, and the approved symbol export is only 510 px, below the 1024 px iOS
  icon. The brand owner needs to supply an approved 1024x1024 opaque icon and
  an Android adaptive-icon foreground. Then replace `assets/icon.png`,
  `assets/android-icon-*.png` and `assets/splash-icon.png`.
- **Privacy policy / Data safety** updates (above).
- **Push** (docs/mobile-push.md) is optional for a first release; nothing needs
  it to be on.

## Versioning

Bump `expo.version` (human) and `expo.android.versionCode` (integer, always
increasing) / `expo.ios.buildNumber` in `app.json` for every store upload.
`appVersionSource` is `local`, so these files are the source of truth.
