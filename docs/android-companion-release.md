# OneLedger Shortcuts (OL Shortcuts) — release & distribution runbook

The Android app (`android/`, ADR 0010) — product name **OneLedger Shortcuts**,
launcher label **OL Shortcuts**, package `me.oneledger.companion` (debug:
`…​.companion.debug`).

This is everything needed to produce a **signed release build** and ship it to
testers through **Firebase App Distribution**, plus the content you'll reuse for
a later Play Store submission. The Gradle/CI plumbing is already in place; the
steps below are the parts that need a console or a secret.

---

## 1. Generate the upload keystore (once, keep forever)

This key signs every release. **If it is lost, you can never update the app**
under the same identity — back it up somewhere durable (password manager +
offline copy).

```sh
keytool -genkeypair -v \
  -keystore oneledger-shortcuts-upload.jks \
  -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass '<store-password>' -keypass '<key-password>' \
  -dname "CN=OneLedger Shortcuts, O=OneLedger, C=RW"
```

**Local signed builds:** copy `android/keystore.properties.example` to
`android/keystore.properties` (git-ignored) and fill in the four values. Then
`./gradlew :app:assembleRelease` produces a signed
`app/build/outputs/apk/release/app-release.apk`. Without that file the same
command still runs and produces an *unsigned* APK (that's what CI does on PRs).

---

## 2. Firebase App Distribution (first tester build)

### 2.1 Create the Firebase project + Android app

1. <https://console.firebase.google.com> → **Add project** (or reuse an existing
   OneLedger Firebase project). Google Analytics is optional; skip it.
2. In the project → **Add app → Android**.
   - **Package name:** `me.oneledger.companion`  *(exactly — this is permanent)*
   - Nickname: `OL Shortcuts`
   - **SHA-1: not required** for App Distribution. Skip the `google-services.json`
     download step — the app does **not** use Firebase SDKs and none is committed.
3. Left nav → **Run → App Distribution** → **Get started**.
4. **Testers & Groups** tab → create a group with alias **`internal`** (the CI
   job uploads to this group). Add tester emails (yours first).

### 2.2 Create a service account for CI uploads

1. <https://console.cloud.google.com> → same project → **IAM & Admin → Service
   Accounts → Create service account**.
   - Name: `app-distribution-ci`
   - Role: **Firebase App Distribution Admin**
2. On the new account → **Keys → Add key → JSON** → download it.

### 2.3 Set the GitHub secrets + variable

Repo → **Settings → Secrets and variables → Actions**.

| Kind | Name | Value |
|---|---|---|
| Variable | `ANDROID_DISTRIBUTE` | `true` |
| Secret | `ANDROID_KEYSTORE_BASE64` | `base64 -i oneledger-shortcuts-upload.jks` (one line) |
| Secret | `ANDROID_KEYSTORE_PASSWORD` | store password from step 1 |
| Secret | `ANDROID_KEY_ALIAS` | `upload` |
| Secret | `ANDROID_KEY_PASSWORD` | key password from step 1 |
| Secret | `FIREBASE_APP_ID` | from Firebase → Project settings → your Android app → **App ID** (`1:NNN:android:xxxx`) |
| Secret | `FIREBASE_SERVICE_ACCOUNT_JSON` | the entire JSON file contents from step 2.2 |

### 2.4 Ship it

Any push to `main` that touches `android/**` now runs the **`distribute`** job:
it builds a signed release APK and uploads it to the `internal` group, using the
commit message as the release notes. Testers get an email + the Firebase App
Tester app prompts them to install.

Manual one-off from your machine (with `android/keystore.properties` filled and
`GOOGLE_APPLICATION_CREDENTIALS` + `FIREBASE_APP_ID` exported):

```sh
cd android
./gradlew :app:appDistributionUploadRelease \
  --artifactPath=app/build/outputs/apk/release/app-release.apk \
  --releaseNotes="manual build"
```

### 2.5 Bump the version for each build

`android/app/build.gradle.kts` → `defaultConfig` → bump `versionCode` (integer,
every upload must be higher) and `versionName` (human, e.g. `1.0.1`). Firebase
rejects a re-upload of the same `versionCode`.

---

## 3. Play Store — prerequisites (do later, they run on Google's clock)

Not needed for tester distribution, but start early because two of these get
**reviewed by Google** and can take days.

### 3.1 Notification Access — Permissions Declaration (the slow one)

`BIND_NOTIFICATION_LISTENER_SERVICE` triggers a mandatory declaration in Play
Console → **App content → Sensitive app permissions → Notification access**.
Answer text to use:

> **Core purpose:** OL Shortcuts reads only supported financial-transaction
> notifications (Mobile Money, bank alerts) so the user's own OneLedger account
> can record those transactions automatically. Notification access is the sole
> mechanism for this feature and there is no less-invasive alternative — the
> app deliberately does not request SMS or Call Log access.
>
> **What is accessed:** the text body of a notification is inspected on-device
> against a fixed list of provider message patterns. Notifications that do not
> match are discarded immediately — never parsed, stored, transmitted, or
> logged. Only a matched message body, its timestamp, and the source app's
> package name are sent, over HTTPS, to the user's OneLedger workspace.
>
> **Not accessed:** any non-matching notification, notification actions,
> replies, media, or contact data.

### 3.2 Data Safety form answers

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| Data type | **Financial info → other financial info** (transaction message text) + **App activity** is *not* collected |
| Collected or shared? | **Collected**, not shared with third parties |
| Processed ephemerally? | No — it is sent to the user's own OneLedger account and retained there |
| Required or optional? | Required for the app's function |
| Purpose | **App functionality** only |
| Encrypted in transit? | **Yes** (HTTPS) |
| Can the user request deletion? | **Yes** — via their OneLedger account |
| Device or other IDs | **Not collected** (the pairing credential is app-generated, not a device identifier) |
| Location, contacts, messages (SMS), photos, files | **Not collected** |
| Photos/videos (camera) | **Not collected** — camera is used only to decode a pairing QR on-device; no image is captured or kept |

### 3.3 Other Play Console items

- **Privacy policy URL** — host `docs/android-companion-privacy-policy.md` at a
  stable public URL (e.g. a page on `oneledger.me`). Required field.
- **App access** — provide test credentials + note that full function needs a
  OneLedger account and a paired connection; reviewers can exercise pairing with
  the `op:"test"` handshake.
- **Content rating** questionnaire — finance app, no objectionable content.
- **Target audience** — 18+ (financial).
- **Store listing** — short description, full description, one feature graphic
  (1024×500), ≥ 2 phone screenshots (pairing screen + connected screen), the
  app icon (already an adaptive icon in `res/mipmap-anydpi-v26`).
- **App signing** — enroll in **Play App Signing**; upload the step-1 keystore
  as the *upload key*. Google holds the actual app-signing key.
- First release track: **Internal testing** → then **Closed testing** → open/prod.

---

## 4. R8 / release build health

`./gradlew :app:assembleRelease` runs on every CI change (unsigned on PRs) to
catch minification regressions. The rules in `android/app/proguard-rules.pro`
cover kotlinx.serialization (our `data.model` package), Room, OkHttp/Okio,
WorkManager's reflective worker, and Tink (EncryptedSharedPreferences). If a
release build crashes where debug doesn't, check `mapping.txt` under
`app/build/outputs/mapping/release/` and add a keep rule.
