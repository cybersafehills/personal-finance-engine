# Merchant poster scanning

> Active integration: `preview/live`, based on `0859d72` (the existing themed
> preview with the contact-number logging change). The combined version passes
> 1,202 mobile tests, TypeScript, and lint, and is served on port 8082 from
> `/private/tmp/claude-501/ol-work/pay2/oneledger-mobile`.
>
> The native APK and iOS simulator build recorded below were built earlier from
> `codex/phase1-foundation` at `89597db`. They do not include the newer preview
> changes and are historical verification only. The corrected replacement
> artifacts and validation results are recorded at the end of this document.

Pay & services → Scan to pay → Merchant poster → Read merchant poster.
The user frames the merchant name and the complete MTN MoMoPay
`*182*8*1*merchant-code#` line, takes a photo, checks/corrects the extracted
code and optional name, and continues to the existing Pay a merchant form.
They then choose an account, enter an amount, and prepare/review the payment.
Detection does not create an intent or open the dialer.

## Recognition and routing

- `oneledger-mobile/modules/oneledger-poster` is a local Expo module, autolinked
  for Android (bundled ML Kit Latin text recognition) and iOS (Apple Vision).
  Recognition runs locally; the image and raw OCR text are not uploaded or logged.
  The module accepts only a local cache path and deletes the captured file after
  recognition, including recognition errors. A process crash can leave an OS-managed
  cache file; photos are never saved to the photo library.
- `src/features/scan/poster.ts` accepts one distinct complete merchant payment
  code, permits whitespace between boxed digits, and preserves leading zeros.
  If OCR misses the separately printed `#`, an entire line containing the
  merchant prefix and digits (or the digits on the immediately following line)
  is accepted for review; extra payment parameters are rejected.
  It does not guess ambiguous letters as digits, infer arbitrary numbers as
  merchant IDs, or accept person-payment prefixes. It reads an optional name
  after `Izina ry’Umucuruzi` / `Merchant name`.
- Every extracted recipient is explicitly reviewed and editable. Poster names
  are suggestions, not provider verification. Missing or ambiguous codes offer
  retry and manual entry. The existing payment API validates the eventual draft.
- QR scanning keeps its existing server classification and preparation flow.
- Expo Go, older native builds, and web lack the native recognizer and offer
  manual merchant-code entry. This initial implementation is tap-to-capture;
  continuous recognition and gallery import are not included.

## Build and validation

A new native build is required on Android and iOS; an OTA update alone cannot
install the module. No backend credentials, image storage, or migrations are
needed. The bundled Android model also works on the first scan offline.

Run from `oneledger-mobile`:

```sh
npm test -- --runInBand src/features/scan src/__tests__/screens/scan.test.tsx src/__tests__/screens/pay-new.test.tsx
npm run typecheck
npm run lint
```

These checks passed (72 focused tests; the full mobile suite also passes,
1,049 tests across 112 suites). Tests cover transcribed poster text with code
`025406` / name `AIMEE`, whitespace-separated digits, unsupported/malformed and
ambiguous codes, editable review, leading-zero preservation through payment
preparation, recognizer failure, and builds without the native module. These
also include the actual Apple Vision output from the supplied photograph,
which correctly reads `AIMEE` and `025406` but omits the printed `#`.

Before release, test a native build on Android and iPhone against the supplied
poster and more handwritten examples. Include glare, dim lighting, rotated
photos, missing names, ambiguous digits, denied camera access, leaving during
capture, and repeated taps. Confirm cached images are removed after success
and OCR failure. Confirm only the reviewed code reaches the payment form,
and payment still requires an amount and explicit provider authorization.

Reference APIs: [Expo SDK 58 Camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
[ML Kit text recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2/android),
[Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

Native validation retry (2026-11-20): Expo autolinking discovers the module on
Android and Apple platforms; the podspec passes Ruby syntax validation. All
three Expo exports (web, Android Hermes, iOS Hermes) pass. Android and iOS
project generation pass. Apple Vision with the production recognition settings
successfully reads the original photograph on this Mac. The previous disk-space
and Vision runtime failures no longer reproduce. Xcode and CocoaPods are not
installed, so an iOS native app build is not verified. No Android device or
emulator is connected for an end-to-end camera test.

Final Android retry: `:app:assembleDebug` produced a signed debug APK; all
45 native capture tests pass after restoring the shared provider fixture in the
isolated build and retrying an interrupted Robolectric SDK download. The APK
contains `OneLedgerPoster` and native libraries for arm64-v8a, armeabi-v7a,
x86, and x86_64. Android `apksigner verify --verbose` passes (v2 signature).
The artifact is `oneledger-mobile/dist/native/oneledger-poster-debug.apk`;
SHA-256: `851f6cfe7d3910994ec197a9710c41f50484e79c7cc5a726b6f1aba1f276f208`.
This is a debug build and needs Metro to run the JavaScript app.

The user explicitly approved uploading the isolated iOS simulator build
snapshot (app source, native modules, shared utilities, and public build
configuration) to Expo. Cloud build `fe9ab2dc-82bc-455e-9794-9226d55a505b`
was submitted successfully to `@dolyindesign/oneledger`:
https://expo.dev/accounts/dolyindesign/projects/oneledger/builds/fe9ab2dc-82bc-455e-9794-9226d55a505b
Local iOS compilation remains unavailable without Xcode. Cloud compilation
finished successfully and produced a downloadable simulator artifact. This
verifies the Swift poster module and complete iOS app compile and link. A
simulator artifact cannot be installed on an iPhone; a signed device build and
real-camera testing remain separate release checks.

## Corrected preview/live artifacts

Source: `preview/live`, feature commit `432f9cb`, preserving the existing theme,
contact picker, templates, saved contacts, and contact-number shape logging.
The working tree was restored to `/private/tmp/claude-501/ol-work/pay2`.

- Expo Go preview: `exp://192.168.1.4:8082`; the older 8081 server was stopped.
  The iOS manifest and bundle return HTTP 200 and contain both Appearance and
  the merchant poster UI. Expo Go still cannot execute the custom OCR module.
- Mobile tests: 1,202 passed across 118 suites; TypeScript and lint pass.
- Android: `:app:assembleDebug :oneledger-capture:testDebugUnitTest` succeeds;
  all 45 native tests pass. The APK signature verifies, and the debug APK is
  saved as `oneledger-mobile/dist/native/oneledger-preview-live-debug.apk` in
  both the active checkout and the primary workspace. The primary workspace's
  older `oneledger-poster-debug.apk` download path now points to this corrected
  APK as well. Debug builds require the development server.
- Android SHA-256: `d79132512c39c9fd95da63f51b29269eef1a28d2050428f10c0a37d4f0cf8615`.
- iOS simulator: build `86ba2eb4-eab7-4931-be3a-490133daa925` finished
  successfully and produced a downloadable artifact:
  https://expo.dev/accounts/dolyindesign/projects/oneledger/builds/86ba2eb4-eab7-4931-be3a-490133daa925
  This replaces the earlier simulator artifact for testing the combined
  version. It cannot be installed on an iPhone; a signed device build and
  real-camera testing remain separate checks.

Temporary local C++ and app intermediates were removed after preserving the
verified APK, test results, and build logs to recover disk space. Source files
and installed SDK dependencies remain in place.
