export type MerchantPoster = { merchantCode: string; name: string };

// OCR is a suggestion, never a verified recipient. Only the merchant-pay
// prefix is accepted; do not turn arbitrary numbers or send-money codes into
// merchants, or guess that an O is a zero. Keep leading zeros intact.
export function parseMerchantPoster(text: string): MerchantPoster | null {
  const normalized = text.slice(0, 12_000).normalize("NFKC").replace(/\r/g, "");
  const codes = [...normalized.matchAll(/\*\s*182\s*\*\s*8\s*\*\s*1\s*\*\s*([\d\s]{3,40})#/g)]
    .map((m) => m[1].replace(/\s/g, ""));
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  // Vision can omit the separately printed '#'. In that case require the
  // entire line to be a merchant prefix followed only by digits (inline or
  // on the next line). Never take a substring of a longer payment instruction.
  for (let i = 0; i < lines.length; i++) {
    const prefix = lines[i].match(/^(?:Kanda\s+)?\*\s*182\s*\*\s*8\s*\*\s*1\s*\*\s*(.*)$/i);
    if (!prefix) continue;
    const digits = (prefix[1] || lines[i + 1] || "").match(/^([\d \t]{3,40})\s*#?$/);
    if (digits) codes.push(digits[1].replace(/\s/g, ""));
  }
  const distinct = [...new Set(codes.filter((c) => /^\d{3,12}$/.test(c)))];
  if (distinct.length !== 1) return null;

  const label = /^(?:izina\s+ry['’]?\s*umucuruzi|merchant\s+name)\s*:?\s*(.*)$/i;
  const index = lines.findIndex((line) => label.test(line));
  const candidate = index < 0 ? "" : (lines[index].match(label)?.[1] || lines[index + 1] || "");
  const name = /kanda|\*|#|momo|ishyura/i.test(candidate) ? "" : candidate.slice(0, 100);
  return { merchantCode: distinct[0], name };
}

export function posterPrefill(params: { type?: string; merchantCode?: string; merchantName?: string }): MerchantPoster {
  if (params.type !== "pay_merchant" || typeof params.merchantCode !== "string" || !/^\d{3,12}$/.test(params.merchantCode)) {
    return { merchantCode: "", name: "" };
  }
  return { merchantCode: params.merchantCode, name: typeof params.merchantName === "string" ? params.merchantName.slice(0, 100) : "" };
}
