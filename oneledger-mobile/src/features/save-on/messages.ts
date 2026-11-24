// Save On wording. Mirrors the web (web/lib/ussd/messages.ts, pay.splits) so the two say
// the same thing: OneLedger never moves money, the person sends each part, and fees are
// estimates (the provider shows the final fee). Never presented as a way around a limit.

export const SAVE_ON = {
  name: "Save On",
  capacityTitle: "Above the eKash limit for one transfer",
  capacityBody: (capacity: string, total: string, n: number) =>
    `eKash sends up to ${capacity} at a time. ${total} can go as ${n} transfers, one after another.`,
  capacityFee: (fee: string, perPart: string) =>
    `Fees: up to ${fee} in total (${perPart} at most per transfer). Your bank or wallet sets the final charge.`,
  capacityFeeExact: (fee: string, perPart: string) =>
    `Fees: ${fee} in total (${perPart} per transfer), from your provider's published tariff. Your provider shows the final fee.`,
  limitsNote: "Your bank or wallet may have lower limits of its own. Check before you send.",
  savingTitle: "Lower fees available",
  savingBody: (total: string, single: string, planned: string, savings: string, n: number) =>
    `${total} costs ${single} in fees as one transfer, and ${planned} as ${n} parts. That saves ${savings}.`,
  source: "Fee source",
  partRow: (i: number, amount: string) => `Part ${i} · ${amount}`,
  accept: (n: number) => `Split into ${n} parts`,
  working: "Preparing…",
  keepOne: "Or send it as one transfer with Prepare payment below.",
  howItWorks:
    "OneLedger never moves money. You send each part yourself, one at a time, and confirm each before the next.",
  ekashChoice: "Send over eKash",
  ekashHint: "eKash has a limit for one transfer. Above it, the amount is offered as parts.",
  learnMore: "How Save On works",
  plan: {
    title: (n: number) => `Sending in ${n} parts`,
    subtitleCapacity: "This amount is above the network's limit for one transfer.",
    subtitleSaving: "Sending in parts costs less in fees.",
    thisPayment: "This payment",
    prepareNext: (i: number) => `Prepare part ${i}`,
    waiting: (i: number) => `Confirm that part ${i} went through to continue.`,
    blocked: "The last part didn't go through. Stop here, or check with your provider.",
    complete: "Every part is prepared.",
    stopped: "This split was stopped.",
    stop: "Stop here",
    remaining: (amount: string) => `Not yet prepared: ${amount}`,
    feesNote: "Fees shown are estimates, not guarantees.",
  },
  settings: {
    title: "Save On",
    subtitle: "A cheaper way to send, when there is one.",
    howTitle: "How Save On works",
    how: [
      "You enter a payment as usual. If sending it in parts would cost less in fees, Save On shows the parts and the saving.",
      "You choose: split it, or send it as one transfer. Nothing happens until you tap.",
      "You send each part yourself, one at a time. Confirm each part before the next one opens.",
      "OneLedger never moves your money. Fees shown are estimates; your provider shows the final fee.",
    ],
    kindsTitle: "When it applies",
    kinds: [
      "Between two MTN numbers: some amounts cost less in fees as two or more parts. Only when a published MTN fee table is on file, and only if you turn it on below.",
      "Over eKash (to another wallet or a bank): an amount above RWF 10,000,000 has to go in parts. That does not depend on the setting below.",
    ],
    enable: "Suggest cheaper splits (MTN to MTN)",
    on: "On",
    off: "Off",
    question: "How much should each extra transfer save?",
    any: "Any savings",
    anyHint: "Even a small saving is enough.",
    balanced: "Balanced (recommended)",
    balancedHint: "Save at least 50 RWF per extra transfer.",
    bigger: "Bigger savings",
    biggerHint: "Save at least 250 RWF per extra transfer.",
    saved: "Saved",
    loadFailed: "Couldn't load your Save On choice.",
  },
} as const;
