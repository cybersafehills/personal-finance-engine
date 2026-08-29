// The canonical, machine-readable "wire up an iPhone Shortcut" guide.
// Rendered in-app at /settings/connections/setup and mirrored for offline
// reading in docs/momo-shortcut-setup.md. Keeping the steps here (not as
// prose in a component) means the in-app guide and the doc describe the
// same procedure and the same field values.
//
// Pure and env-free (Deno-tested in shortcut-guide_test.ts); the caller
// passes the resolved endpoint URL and, once known, the real MoMo SMS
// sender in.

import { INGEST_BODY_EXAMPLE, INGEST_REQUEST } from "./ingest.ts";

/**
 * Stand-in for the real MTN Rwanda MoMo SMS sender ID, still to be
 * confirmed on a real device before this guide is published. Rendered
 * verbatim wherever `shortcutGuideSteps` isn't given a `mtnSender`.
 */
export const MTN_SENDER_PLACEHOLDER = "<MTN sender - confirm on device>";

/** The Supabase-URL-less fallback shown when no endpoint is resolved. */
export const ENDPOINT_URL_FALLBACK =
  "https://<your-project-ref>.supabase.co/functions/v1/ingest-momo";

export type GuideField = {
  label: string;
  value: string;
  /** Show a copy button next to the value in the in-app guide. */
  copyable?: boolean;
};

export type GuideStep = {
  n: number;
  title: string;
  /** Plain-text paragraphs. No markup. */
  body: string[];
  fields?: GuideField[];
};

export function shortcutGuideSteps(opts: {
  endpointUrl: string | null;
  mtnSender?: string | null;
}): GuideStep[] {
  const sender = opts.mtnSender?.trim() || MTN_SENDER_PLACEHOLDER;
  const url = opts.endpointUrl?.trim() || ENDPOINT_URL_FALLBACK;

  return [
    {
      n: 1,
      title: "Open Shortcuts → Automation",
      body: [
        "On your iPhone, open the Shortcuts app, tap the Automation tab at the bottom, then tap + (top right) to create a new personal automation.",
      ],
    },
    {
      n: 2,
      title: "Choose “Message” as the trigger",
      body: [
        `Select “Message”. Under Sender, add ${sender}. Leave “Message Contains” empty so every MoMo SMS is forwarded, not just some.`,
        "Set “Run Immediately” and turn “Notify When Run” off, so forwarding happens silently in the background.",
      ],
    },
    {
      n: 3,
      title: "Add the “Get Contents of URL” action",
      body: [
        "Choose “New Blank Automation” if prompted, then add the action “Get Contents of URL”. Tap to expand its options (“Show More”).",
      ],
      fields: [
        { label: "URL", value: url, copyable: true },
        { label: "Method", value: INGEST_REQUEST.method },
      ],
    },
    {
      n: 4,
      title: "Add the two headers",
      body: [
        `Under Headers, add ${INGEST_REQUEST.authHeader} and set its value to your connection key — the pfe_… string shown once when you created the connection (or when you last rotated it).`,
        `Add a second header, Content-Type, set to ${INGEST_REQUEST.contentType}.`,
      ],
      fields: [
        {
          label: INGEST_REQUEST.authHeader,
          value: "<paste your pfe_… key>",
        },
        {
          label: "Content-Type",
          value: INGEST_REQUEST.contentType,
          copyable: true,
        },
      ],
    },
    {
      n: 5,
      title: "Set the request body to JSON",
      body: [
        "Set “Request Body” to JSON. Add a field named message, type Text, and set its value to the “Shortcut Input” variable (tap the variable bar, choose Shortcut Input) — this is the SMS text itself.",
        "Optionally add a second field received_at, type Text, set to the “Current Date” variable formatted as ISO 8601. It is not required.",
      ],
      fields: [
        { label: "Body shape", value: INGEST_BODY_EXAMPLE, copyable: true },
      ],
    },
    {
      n: 6,
      title: "Save, then send a real SMS",
      body: [
        "Tap Done to save the automation.",
        "Trigger a real MTN MoMo transaction, or forward yourself a past MoMo SMS. Within a few seconds the matching connection on Settings → Connections turns “Ready” and the transaction lands in your ledger.",
        "If it stays “Not configured”, work through the troubleshooting table below.",
      ],
    },
    {
      n: 7,
      title: "If you rotate the key later",
      body: [
        `Rotating a connection’s credential invalidates the old one immediately. Edit this automation’s ${INGEST_REQUEST.authHeader} header and paste the new pfe_… value. Nothing else changes.`,
      ],
    },
  ];
}

export type GuideTroubleshootRow = {
  symptom: string;
  /** When set, must be a key in INGEST_RESPONSE_HELP (see ingest.ts). */
  responseKey?: string;
  fix: string;
};

export const SHORTCUT_TROUBLESHOOTING: GuideTroubleshootRow[] = [
  {
    symptom: "The automation’s result shows 401 / “unauthorized”.",
    responseKey: "unauthorized",
    fix:
      "The x-ingest-key value is wrong, or the connection was revoked or paused. Copy the key again (or rotate it) and update the header.",
  },
  {
    symptom: "Result shows 422 / “not_rwf_message”.",
    responseKey: "not_rwf_message",
    fix:
      "The forwarded text had no RWF amount — e.g. an OTP or a promo SMS. Harmless: nothing is recorded. If it happens a lot, narrow the trigger’s Sender.",
  },
  {
    symptom: "Result shows 400 / “missing_message”.",
    responseKey: "missing_message",
    fix:
      "The body field message isn’t bound to the Shortcut Input variable, so it arrives empty. Re-add the variable via the picker.",
  },
  {
    symptom: "Result shows 400 / “invalid_json”.",
    responseKey: "invalid_json",
    fix:
      "Request Body isn’t set to JSON, or a value was typed by hand and contains an unescaped quote. Set the body type to JSON and fill message from the variable picker, not typed text.",
  },
  {
    symptom: "Result is 200 with “duplicate”.",
    responseKey: "duplicate",
    fix:
      "The same SMS was already received (you re-ran the automation, or two devices forwarded it). Safe to ignore — nothing is double-counted.",
  },
  {
    symptom: "The automation never runs at all — no result, connection stays “Not configured”.",
    fix:
      "iOS only fires Message automations for SMS/iMessage, and only with “Run Immediately” on and “Notify When Run” off. Re-open the automation and confirm both. Also check Settings → Shortcuts → Allow Untrusted / automations are enabled.",
  },
];
