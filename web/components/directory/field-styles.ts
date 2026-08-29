// Shared Tailwind class strings for the directory admin forms, matching
// components/ussd/ServiceCodeAdminForm.tsx so the two admin surfaces look
// identical.
// text-base (16px) on mobile so iOS Safari does not focus-zoom the page;
// text-sm from sm: up, where the zoom can't happen. globals.css enforces
// the 16px floor app-wide too - this keeps it explicit in the shared
// string. min-w-0 lets the control shrink inside flex/grid form rows
// instead of forcing horizontal overflow.
export const field =
  "w-full min-w-0 rounded-control border border-border-subtle bg-surface px-3 py-2 text-base text-text-primary outline-none focus:border-accent sm:text-sm";
export const labelText = "mb-1 block text-sm font-medium text-text-secondary";
export const panel = "rounded-control border border-border-subtle p-3";
export const primaryButton =
  "min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50";
