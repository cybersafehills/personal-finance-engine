# Apple Developer Program — setup runbook

Needed for: iOS builds on a real iPhone, TestFlight, App Store submission,
and iOS push (APNs). **Not** needed for Android, or for iOS Simulator builds.
Cost: US$99 per year (verify current price on Apple's site).

## 0. Status and decision (updated 2026-11-14)

- **Decision: enroll as an Individual, under Yves Dolton's own name.** The App
  Store seller name will be the account holder's legal name. (An earlier
  version of this runbook recommended an Organization for Cybersafe Users and
  Partners; that is superseded.)
- Fee will be paid around the end of the following week; until then no paid
  membership exists. That blocks only: real-device iOS builds via EAS,
  TestFlight, App Store submission, iOS push. Everything else proceeds.
- **What an Individual account changes about the listing:** only the seller
  name (and the contact details Apple/Google may show publicly). The app name
  ("OneLedger"), bundle id, icon, screenshots, privacy policy and review
  process are identical. It does not change how the app works.
- **Enter your legal name exactly as on your government ID** in the first/last
  name fields. Apple verifies it and delays approval for aliases, nicknames or
  company names. The seller name will appear as entered, so decide the order
  (first/last) to match the ID.
- Individual accounts cannot be converted to Organization. If the app should
  later be published under a company, Apple's app-transfer process moves it
  (bundle id and reviews are kept; push keys, TestFlight and some entitlements
  need rework). The Android side has its own equivalent.
- Check the developer-contact rules for your distribution regions (for
  example EU "trader" disclosures can show a public address/phone/email); use
  a business-style email rather than a personal one if you want separation.
- Region: Apple states enrollment is available in "more than 220 countries or
  regions" but publishes no list we could verify for Rwanda. The authoritative
  check is the country picker in the enrollment form; Apple verifies details
  before taking payment.
- Google Play: a **personal** Play developer account created recently is
  subject to extra requirements (e.g. a closed test with a minimum number of
  testers for a minimum period before production access). Verify current
  rules in Play Console before planning the Android release date.

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

Chosen: **Individual** (see section 0). The Organization column is kept for
reference in case the listing moves to a company later.

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
