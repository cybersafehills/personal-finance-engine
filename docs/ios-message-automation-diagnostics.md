# iPhone Message automation: diagnosis and support boundary

## Observed on 22 November 2026

The supplied phone screenshots show an unfinished `Sender is Sender` condition with Apple's `Configure Sender` warning, alongside `Message contains RWF`. A Run Shortcut action was later added but its input is not visible. A manual Text prompt indicates an interactive input setting; it is not a step in normal background capture. Do not ask the user to type RWF or configuration data into that prompt.

Redacted production audit aggregation from 07:30 UTC onward found successful device tests at 07:55 and 08:27 UTC (09:55 and 10:27 Kigali). It found no accepted capture or rejected capture around the photographed 10:26 Kigali incoming SMS. The only rejected capture in that interval was INVALID_CAPTURE_PAYLOAD at 09:54 Kigali. This establishes a working test path, not a working Message trigger. It does not identify which hidden Input setting is selected on the phone.

Existing provider fixtures cover the same 50 RWF Airtime message format. No parser change or invented financial entry is justified by the screenshots. No payment was initiated during diagnosis.

## Implemented guidance and verification

- Numbered, short actions with actual control names in bold.
- A visible stop warning for unfinished Sender, with an alternative if the left label cannot change.
- Separate steps for finding the Run Shortcut action, choosing the installed Capture shortcut, and passing received message text.
- Explicit warning against Ask Each Time, Clipboard, fixed Text, configuration files and manually typed RWF as capture input.
- Open Shortcuts opens the library instead of running Capture without input.
- Separate statuses for a fresh connection test and a newly accepted message. Historical activity cannot make a new setup look verified.
- One installed Capture shortcut remains sufficient. An automation wrapper is not a second downloadable shortcut.

The current generated release has no Ask for Input action or Ask Each Time token. Its capture request explicitly references the initial Shortcut Input, never the local configuration dictionary. Regression checks enforce this dataflow. A privacy prompt may describe data originating from a configuration dictionary because authentication reads from it; the screenshot alone does not prove that the entire dictionary is the HTTP body. Never copy device credentials from screenshots into diagnostics.

## What can be automated

Apple documents shareable shortcuts, app-triggered runs with explicit input, and device-specific automation setup. The documented URL scheme can run a saved shortcut; it does not expose a Message-trigger creation/enabling operation. No supported public API was found that lets this Expo app silently install and authorize an incoming-message automation. Do not use private automation database writes or claim universal zero-touch setup.

On the newer editor a user can attach a trigger to an existing shortcut; on older layouts they choose the installed shortcut from Automation. Do not attach a second enabled trigger or make Capture invoke itself. The guided wrapper is retained to repair the user's existing unfinished automation, with each input selection explicit.

Unattended Message recording targets iOS 17 and later, with separate newer/older interface guidance. Earlier releases may require confirmation. A compatibility target is not a claim that every OS/device was physically tested. An actual new incoming SMS must still verify the user's trigger after correction; a connection test and static tests cannot prove locked-phone delivery.

## Apple references

- [iOS 27 automation setup](https://support.apple.com/en-om/guide/shortcuts/apdfbdbd7123/10.0/ios/27)
- [Device-specific personal automations](https://support.apple.com/en-euro/guide/shortcuts/apd690170742/ios)
- [Run a shortcut with explicit URL input](https://support.apple.com/en-gw/guide/shortcuts/apd624386f42/ios)
- [Choose a variable instead of typing text](https://support.apple.com/guide/shortcuts/use-variables-apdd02c2780c/ios)
- [Ask Each Time pauses execution](https://support.apple.com/en-eg/guide/shortcuts/apd8b28e2166/ios)
