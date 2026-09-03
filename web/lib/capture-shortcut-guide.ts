// The "OneLedger Capture" Shortcut guide, for the mobile-first pairing wizard.
// Mirrors docs/oneledger-capture-shortcut.md so the in-app steps and the doc
// never drift. Pure and env-free (Deno-tested in capture_shortcut_guide_test.ts);
// the caller passes the optional signed-Shortcut URL and MoMo sender in.
//
// Unlike lib/shortcut-guide.ts (the legacy "put the HTTP request in a Messages
// automation" guide), this describes the thin pairing model: the automation
// just runs a reusable Shortcut, and the phone never shows a URL, key, or JSON.

import type { GuideStep, GuideTroubleshootRow } from "./shortcut-guide.ts";

export const MTN_SENDER_PLACEHOLDER = "<MTN sender - confirm on device>";

export function captureShortcutGuideSteps(opts: {
  /** A signed .shortcut / iCloud link, when one has been published. */
  shortcutUrl?: string | null;
  /** The real MoMo SMS sender once confirmed on a device. */
  mtnSender?: string | null;
}): GuideStep[] {
  const sender = opts.mtnSender?.trim() || MTN_SENDER_PLACEHOLDER;
  const hasLink = Boolean(opts.shortcutUrl?.trim());

  return [
    {
      n: 1,
      title: "Add the OneLedger Capture Shortcut",
      body: hasLink
        ? [
          "Tap “Get the ready-made Shortcut” above and add it. It arrives as two Shortcuts: “Connect to OneLedger” (you run this once) and “OneLedger Capture” (the automation runs this for you).",
          "You don’t need to open or edit either one.",
        ]
        : [
          "In the Shortcuts app, add the OneLedger Capture Shortcut. Your OneLedger setup screen has the add link; it installs “Connect to OneLedger” (run once) and “OneLedger Capture” (used by the automation).",
          "Nothing inside the Shortcut needs editing — no address, no key, no code.",
        ],
    },
    {
      n: 2,
      title: "Pair this iPhone",
      body: [
        "Back in OneLedger, tap “Open OneLedger Capture”. Your phone switches to Shortcuts and runs “Connect to OneLedger”, passing the pairing code for you.",
        "If it asks for the code, type or paste the code shown on this screen. When it says the phone is connected, switch back to OneLedger — this screen moves on by itself.",
      ],
    },
    {
      n: 3,
      title: "Turn on transaction messages",
      body: [
        "OneLedger can’t switch this on for you — Apple requires you to add it. In Shortcuts, open the Automation tab, tap +, and choose “Message”.",
        `Under Sender add ${sender}. Set “Run Immediately” and turn notifications off.`,
        "For the action, choose “Run Shortcut” → “OneLedger Capture”, and pass the message as its input. Save.",
      ],
    },
    {
      n: 4,
      title: "Check it’s working",
      body: [
        "Run “Test OneLedger connection” from the Shortcuts app, or just wait for your next MoMo message. OneLedger shows a green tick here the moment it receives anything from this phone.",
        "A test never creates a transaction — it’s safe to run as often as you like.",
      ],
    },
  ];
}

export const CAPTURE_SHORTCUT_TROUBLESHOOTING: GuideTroubleshootRow[] = [
  {
    symptom: "“Open OneLedger Capture” does nothing / an error about a missing Shortcut.",
    fix:
      "The Shortcut isn’t installed yet, or has a different name. Add it from step 1, then try again. On a computer this button is expected to do nothing — use the code on your phone.",
  },
  {
    symptom: "Shortcuts says the pairing code is invalid or expired.",
    fix:
      "Codes last about 10 minutes and work once. Tap “Get a new code” on the pairing screen and run “Connect to OneLedger” again.",
  },
  {
    symptom: "Paired, but the check never turns green.",
    fix:
      "The Messages automation from step 3 hasn’t run yet. Run “Test OneLedger connection”, or send yourself a MoMo transaction. This screen updates on its own when something arrives.",
  },
  {
    symptom: "“This phone isn’t connected any more.”",
    fix:
      "The device was disconnected in OneLedger, or its key was rotated. Start the Connect iPhone flow again to re-pair.",
  },
];
