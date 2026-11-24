import { formatRwf } from "@/lib/money";

/** "5,000,001 RWF" from a digit string. RWF has no minor decimals. */
export const rwf = (digits: string): string => formatRwf(Number(digits));
