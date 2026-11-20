// One amount parser for the API (quickLog) and the web quick-add preview.
// The same file lives at app/web/src/features/money/amount.ts; a test checks both copies are identical.
// Pure: no imports, no storage. Rules:
//  - Digits are never joined across spaces: "300 2 croissants" = 300, note "2 croissants".
//  - "1.500" and "1,500" = 1500 (exactly 3 digits after the separator); "2.5" and "12,5" are decimals.
//  - "1,500.50" and "1.500,50" = 1500.5 (the last separator is the decimal point).
//  - "2k" = 2000, "1.5k" = 1500, "1m" = 1,000,000.
//  - Currency: "$12", "12$", "€9", "£7", "12 usd", "eur 150", "15 euros". "+" in front means income.

export type AmountCurrency = 'USD' | 'EUR' | 'GBP';
export type ParsedAmount = {
  amount: number;
  currency: AmountCurrency | null;
  /** '+' (income), '-' or null. */
  sign: '+' | '-' | null;
  /** The text without the amount and its currency. */
  note: string;
  /** The amount came with a currency or a sign: a clear money signal. */
  explicit: boolean;
};

const CUR_WORDS: [RegExp, AmountCurrency][] = [
  [/^(?:\$|usd|dollars?|bucks?)$/i, 'USD'],
  [/^(?:€|eur|euros?)$/i, 'EUR'],
  [/^(?:£|gbp)$/i, 'GBP'],
];
/** "usd", "$", "euros", "£" → the currency code, else null. */
export const currencyWord = (w: string | undefined | null): AmountCurrency | null => {
  if (!w) return null;
  for (const [re, c] of CUR_WORDS) if (re.test(w)) return c;
  return null;
};

/**
 * One number token without spaces: "1500", "1.500", "1,500", "2.5", "12,5", "1,500.50", "2k", "1m".
 * Returns null when it is not a plain number.
 */
export const parseNumber = (tok: string): number | null => {
  const m = /^(\d+(?:[.,]\d+)*)([kKmM])?$/.exec(tok);
  if (!m) return null;
  const body = m[1];
  const seps = body.replace(/\d/g, '');
  let n: number;
  if (!seps) n = Number(body);
  else {
    const groups = body.split(/[.,]/);
    const tail = groups.slice(1);
    const allThree = tail.every((g) => g.length === 3) && groups[0].length <= 3;
    const same = seps.split('').every((c) => c === seps[0]);
    if (same && allThree && !(m[2] && seps.length === 1 && seps[0] === '.')) {
      // "1.500", "1,500", "1.500.000": thousands. ("1.500k" stays 1.5k.)
      n = Number(groups.join(''));
    } else if (same && seps.length === 1) {
      n = Number(`${groups[0]}.${groups[1]}`); // "2.5", "12,5", "1.5k"
    } else if (!same) {
      // Mixed: the last separator is the decimal point, the others group thousands.
      const last = seps[seps.length - 1];
      if (seps.slice(0, -1).split('').some((c) => c === last)) return null;
      const lastAt = body.lastIndexOf(last);
      const int = body.slice(0, lastAt).split(/[.,]/);
      if (int.slice(1).some((g) => g.length !== 3) || int[0].length > 3) return null;
      n = Number(`${int.join('')}.${body.slice(lastAt + 1)}`);
    } else return null;
  }
  if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1000 : 1000000;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
};

/** A word with an amount: optional sign, optional currency symbol before or a currency glued after. */
const TOKEN = /^([+-])?([$€£])?(\d+(?:[.,]\d+)*[kKmM]?)(usd|eur|gbp|\$|€|£)?$/i;

/**
 * The amount in a line. Prefers a number carrying a currency ("2 coffees 12 eur" → 12 EUR);
 * else the first number. Returns null when there is no amount > 0.
 */
export const parseAmount = (text: string): ParsedAmount | null => {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  // A lone sign before the amount: "+ 500 salary".
  if ((words[0] === '+' || words[0] === '-') && words.length > 1) words.splice(0, 2, words[0] + words[1]);
  type Hit = { i: number; amount: number; sign: '+' | '-' | null; currency: AmountCurrency | null; take: number[] };
  const hits: Hit[] = [];
  for (let i = 0; i < words.length; i++) {
    const m = TOKEN.exec(words[i]);
    if (!m) continue;
    const amount = parseNumber(m[3]);
    if (amount === null) continue;
    const sign = (m[1] as '+' | '-' | undefined) ?? null;
    let currency = currencyWord(m[2]) ?? currencyWord(m[4]);
    const take = [i];
    if (!currency && currencyWord(words[i + 1])) { currency = currencyWord(words[i + 1]); take.push(i + 1); }
    if (!currency && i > 0 && currencyWord(words[i - 1]) && !hits.some((h) => h.take.includes(i - 1))) { currency = currencyWord(words[i - 1]); take.push(i - 1); }
    hits.push({ i, amount, sign, currency, take });
  }
  const pick = hits.find((h) => h.currency) ?? hits[0];
  if (!pick || !(pick.amount > 0)) return null;
  const note = words.filter((_, i) => !pick.take.includes(i)).join(' ').replace(/^(?:on|for)\s+/i, '').trim();
  return { amount: pick.amount, currency: pick.currency, sign: pick.sign, note, explicit: !!pick.currency || pick.sign !== null };
};
