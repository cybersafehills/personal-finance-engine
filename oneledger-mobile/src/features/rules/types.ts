// The categorization-rule payloads from /api/mobile/categorization-rules. The
// condition sentence, labels and numbers are rendered by the server with the
// web's own wording (web/lib/mobile-rules.ts): the app only displays them.

export type Rule = {
  id: string;
  title: string;
  categoryLabel: string;
  summary: string;
  active: boolean;
  originLabel: string;
  scopeLabel: string | null;
  matchedLabel: string;
};
