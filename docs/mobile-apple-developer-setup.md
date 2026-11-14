# Apple Developer Program — setup runbook

Needed for: iOS builds on a real iPhone, TestFlight, App Store submission,
and iOS push (APNs). **Not** needed for Android, or for iOS Simulator builds.
Cost: US$99 per year (verify current price on Apple's site).

## 0. Status and decision (2026-11-14)

- Fee will be paid around the end of the following week; until then no paid
  membership exists. That blocks only: real-device iOS builds via EAS,
  TestFlight, App Store submission, iOS push. Everything else proceeds.
- **The App Store listing must be under Cybersafe Users and Partners.** The
  seller name shown on the App Store is the enrolled entity, so the account
  that publishes must be an **Organization** account for that legal entity.
  Enrolling as an Individual only to test sooner would put a personal name on
  the listing and force an app transfer later (push keys re-issued, TestFlight
  reset, extra review) — and it is unnecessary, because testing does not need
  the paid account (see "Testing without the paid account").
- **Recommended path:** start Organization enrollment for the Cybersafe legal
  entity now (the D-U-N-S number and Apple's verification are the slow part),
  and pay when Apple asks. Apple's flow verifies enrollment information first
  and takes payment afterwards.
- Region: Apple states enrollment is available in "more than 220 countries or
  regions" but publishes no list we could verify for Rwanda. The authoritative
  check is the country picker in the enrollment form. Apple's Developer
  Program License Agreement "Exhibit A" is the formal list.
- Android is separate: the Google Play account must also belong to the
  Cybersafe entity if the Play listing should show it.

### Testing without the paid account

| Need | How |
|---|---|
| Preview UI while building | `npm run web` (react-native-web) in a browser / VS Code Simple Browser |
| Android | Emulator or a real phone with a dev build; no cost |
| iOS Simulator | Xcode on a Mac; dev build, no Apple account needed |
| Real iPhone, early (before PR 3) | Expo Go; free |
| Real iPhone after the native module | Needs a paid membership for EAS/TestFlight (a free Apple ID can sideload from Xcode for 7 days, with no push) |

## 1. Decide the enrollment type first

| | Individual | Organization |
|---|---|---|
| Needs | Your legal name, government ID | Legal entity, **D-U-N-S number**, public website, authority to bind the company |
| Speed | Often same day to a couple of days | Days to weeks (D-U-N-S + Apple verification call) |
| App Store seller name | Your personal name | The company name |
| Teams | One person | Multiple members/roles |

Recommendation: if OneLedger is a registered company and you want the company
name on the listing, enroll as an **Organization**; request the D-U-N-S number
now because it is the slow part. If you need to test sooner, enroll as an
**Individual**. An account cannot be converted from Individual to Organization
later (an app can be transferred between accounts, which is disruptive), so
choose deliberately.

Check that your country/region is on Apple's list of supported regions.

## 2. Before you start

1. An **Apple ID** used only for this (a shared team mailbox is better than a
   personal address), with **two-factor authentication** on.
2. A payment card that works internationally.
3. Organization only: legal entity name, address, a website on a domain you
   own, a work email on that domain, and your D-U-N-S number
   (free via https://developer.apple.com/enroll/duns-lookup/).

## 3. Enroll

1. Go to https://developer.apple.com/programs/enroll/ and sign in with the
   Apple ID (or enroll in the **Apple Developer** iOS app, which can verify
   identity with your ID).
2. Choose Individual or Organization, enter the details exactly as on your ID
   or legal registration.
3. Accept the agreement, pay the fee.
4. Wait for the confirmation email. Apple may call or email to verify.

## 4. After approval

1. https://appstoreconnect.apple.com → **Apps → + → New App**; bundle ID
   `me.oneledger.app` (register it under Certificates, Identifiers & Profiles
   first). The bundle ID is permanent once the app is created — change it in
   `oneledger-mobile/app.json` **before** this step if you want a different one.
2. Note your **Team ID** (Membership details).
3. Add yourself under Users and Access as Admin; add testers later in
   TestFlight.
4. Create an **APNs Auth Key (.p8)** (Keys → + → Apple Push Notifications
   service). Download once; store it in your password manager. Needed for push
   (PR 7). EAS can also create and manage it for you.
5. Hand me (or put in EAS, not in git): Apple ID email, Team ID. Never commit
   the `.p8`, certificates, or app-specific passwords.

## 5. Connect to Expo (EAS)

```sh
npm i -g eas-cli   # or use: npx eas-cli@latest
cd oneledger-mobile
eas login
eas build:configure
eas credentials   # let EAS generate certs/profiles when prompted, signing in with the Apple ID
eas device:create # registers your iPhone for internal (ad hoc) test builds
```

## What I can do without the account

PRs 0–5 (scaffold, design system, auth + biometric lock, Android capture
module, onboarding, core screens) and Android release. iOS UI can be exercised
in the Simulator. Real-device iOS testing, TestFlight (PR 6 verification) and
push on iOS (PR 7) wait for the membership.
