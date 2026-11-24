// Small pure helpers for showing split amounts. No I/O.

/** "10,000,000" from a digit string. RWF has no minor decimals. */
export function formatRwf(minor: string | number | bigint): string {
  const n = typeof minor === "bigint" ? minor : BigInt(minor);
  return n.toLocaleString("en-US");
}

/** Fill {name} placeholders. Unknown names are left visible so a typo is obvious. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in values ? String(values[k]) : m
  );
}
