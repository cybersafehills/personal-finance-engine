// Last-line defense for older financial screens which still format amounts as
// strings instead of MoneyAmount. Never leave the original in accessibility text.
const MONEY = /(?:\b(?:RWF|USD|EUR)\s*[+−-]?\d|[$€]\s*[+−-]?\d|[+−-]?\d[\d,.]*\s*(?:RWF|USD|EUR)\b)/;
export function privateText(value: string | undefined, hidden: boolean): string | undefined {
  return hidden && value && MONEY.test(value) ? "Amount hidden" : value;
}
