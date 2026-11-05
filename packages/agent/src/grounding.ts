import type { Cents, Invoice, ISODate, Payer, ScenarioChange } from '@settle/shared';

export interface ExtractedToken {
  canonical: string;
  raw: string;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  million: 1000000,
};

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Extracts every dollar amount, percentage, ISO date, written date,
 * standalone integer, and number word from text, normalizing to canonical tokens.
 * Fail closed: if anomalous or suspicious formatting is detected, flag as ungrounded.
 */
export function extractNumbers(text: string): ExtractedToken[] {
  const tokens: ExtractedToken[] = [];
  const consumedSpans: Array<[number, number]> = [];

  function record(start: number, end: number, canonical: string, raw: string) {
    consumedSpans.push([start, end]);
    tokens.push({ canonical, raw });
  }

  function isOverlapping(start: number, end: number): boolean {
    return consumedSpans.some(([s, e]) => Math.max(start, s) < Math.min(end, e));
  }

  // 1. Detect unicode digits (Arabic-Indic, Eastern Arabic-Indic, full-width)
  const unicodeDigitsRegex = /[\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19]+/gu;
  let match: RegExpExecArray | null;
  while ((match = unicodeDigitsRegex.exec(text)) !== null) {
    record(
      match.index,
      match.index + match[0].length,
      `unicode_digits:${match[0]}`,
      match[0],
    );
  }

  // 2. Rounded amounts like "$1.5k", "about $1.5k", "1.5M"
  const roundedAmountRegex = /\$?\s*\d+(?:\.\d+)?\s*[kKmMbB]\b/g;
  while ((match = roundedAmountRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      record(
        match.index,
        match.index + match[0].length,
        `rounded_amount:${match[0].trim()}`,
        match[0].trim(),
      );
    }
  }

  // 3. Malformed decimal dollars like "$1,234.5" (single digit after decimal)
  const malformedUsdRegex = /\$\s*\d+(?:,\d{3})*\.\d(?!\d)/g;
  while ((match = malformedUsdRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      record(
        match.index,
        match.index + match[0].length,
        `malformed_usd:${match[0]}`,
        match[0],
      );
    }
  }

  // 4. Numbers split by spaces, e.g. "1 500" or "1 500 dollars"
  const spaceSplitNumRegex = /\b\d{1,3}(?:\s+\d{3})+\b(?:\s*dollars?)?/gi;
  while ((match = spaceSplitNumRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const raw = match[0];
      const compactDigits = raw.replace(/\D/g, '');
      const isDollar = /dollar/i.test(raw);
      const canonical = isDollar
        ? `cents:${parseInt(compactDigits, 10) * 100}`
        : `int:${parseInt(compactDigits, 10)}`;
      record(match.index, match.index + raw.length, canonical, raw);
    }
  }

  // 5. Standard Dollar amounts: "$1,234.56", "$1,234", "$500", "1234 dollars", "250000 cents"
  const dollarRegex =
    /(?:\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)|(\d+(?:,\d{3})*(?:\.\d{2})?)\s*dollars?|(\d+)\s*cents?)\b/gi;
  while ((match = dollarRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const raw = match[0];
      let cents: number;
      if (match[1]) {
        // $1,234.56
        const clean = match[1].replace(/,/g, '');
        const parts = clean.split('.');
        const dollars = parseInt(parts[0] ?? '0', 10);
        const fraction = parts[1] ? parseInt(parts[1], 10) : 0;
        cents = dollars * 100 + fraction;
      } else if (match[2]) {
        // 1234 dollars
        const clean = match[2].replace(/,/g, '');
        const parts = clean.split('.');
        const dollars = parseInt(parts[0] ?? '0', 10);
        const fraction = parts[1] ? parseInt(parts[1], 10) : 0;
        cents = dollars * 100 + fraction;
      } else if (match[3]) {
        // 250000 cents
        cents = parseInt(match[3], 10);
      } else {
        cents = 0;
      }
      record(match.index, match.index + raw.length, `cents:${cents}`, raw);
    }
  }

  // 6. Percentages: "5%", "5 percent", "5 pct"
  const percentRegex = /\b(\d+(?:\.\d+)?)\s*(?:%|percent|pct)\b/gi;
  while ((match = percentRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const val = parseFloat(match[1]!);
      record(
        match.index,
        match.index + match[0].length,
        `pct:${val}`,
        match[0],
      );
    }
  }

  // 7. ISO Dates: "YYYY-MM-DD"
  const isoDateRegex = /\b(\d{4}-\d{2}-\d{2})\b/g;
  while ((match = isoDateRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      record(
        match.index,
        match.index + match[0].length,
        `date:${match[1]}`,
        match[0],
      );
    }
  }

  // 8. Written-out Dates: "Nov 12", "November 12", "Nov 12, 2026"
  const writtenDateRegex =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*(\d{4}))?\b/gi;
  while ((match = writtenDateRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const monthStr = match[1]!.toLowerCase();
      const monthNum = MONTH_MAP[monthStr] ?? '01';
      const dayNum = String(parseInt(match[2]!, 10)).padStart(2, '0');
      const year = match[3];

      const canonical = year
        ? `date:${year}-${monthNum}-${dayNum}`
        : `date_md:${monthNum}-${dayNum}`;

      record(match.index, match.index + match[0].length, canonical, match[0]);
    }
  }

  // 9. Number words: "one", "two", "three", "twenty", etc.
  const numberWordRegex =
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/gi;
  while ((match = numberWordRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const word = match[1]!.toLowerCase();
      const num = NUMBER_WORDS[word];
      if (num !== undefined) {
        record(
          match.index,
          match.index + match[0].length,
          `num:${num}`,
          match[0],
        );
      }
    }
  }

  // 10. Standalone integers (including digits in "Invoice #1042" or "net 30")
  const intRegex = /\b\d+\b/g;
  while ((match = intRegex.exec(text)) !== null) {
    if (!isOverlapping(match.index, match.index + match[0].length)) {
      const val = parseInt(match[0], 10);
      record(
        match.index,
        match.index + match[0].length,
        `int:${val}`,
        match[0],
      );
    }
  }

  return tokens;
}

export interface GroundingFactsInput {
  invoice: Invoice;
  payer: Payer;
  change?: ScenarioChange;
  cashCost?: Cents;
  lowestDelta?: Cents;
  shortfallDelta?: Cents;
  discountedAmount?: Cents;
  asOf?: ISODate;
  customAllowed?: string[];
}

/**
 * Builds the canonical allowed set of number/date tokens from verified facts.
 * Does not compute days-late.
 */
export function buildAllowedSet(facts: GroundingFactsInput): Set<string> {
  const allowed = new Set<string>();

  function addAmount(cents: number | undefined) {
    if (cents === undefined || isNaN(cents)) return;
    const absCents = Math.abs(cents);
    allowed.add(`cents:${absCents}`);
    allowed.add(`cents:${cents}`);
    allowed.add(`int:${absCents}`);
    const dollars = Math.floor(absCents / 100);
    allowed.add(`int:${dollars}`);
    // Allow corresponding number word if small
    for (const [w, n] of Object.entries(NUMBER_WORDS)) {
      if (n === dollars || n === absCents) {
        allowed.add(`num:${n}`);
      }
    }
  }

  function addDate(iso: string | undefined) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    allowed.add(`date:${iso}`);
    const parts = iso.split('-');
    const year = parts[0]!;
    const month = parts[1]!;
    const day = parts[2]!;

    allowed.add(`date_md:${month}-${day}`);
    allowed.add(`int:${parseInt(year, 10)}`);
    allowed.add(`int:${parseInt(day, 10)}`);
    const dayNum = parseInt(day, 10);
    if (dayNum in NUMBER_WORDS) {
      allowed.add(`num:${dayNum}`);
    }
  }

  // Invoice amounts
  addAmount(facts.invoice.amount);
  addAmount(facts.invoice.amountPaid);
  addAmount(facts.invoice.amount - facts.invoice.amountPaid);
  addAmount(facts.cashCost);
  addAmount(facts.lowestDelta);
  addAmount(facts.shortfallDelta);
  addAmount(facts.discountedAmount);

  // Dates
  addDate(facts.invoice.dueDate);
  addDate(facts.invoice.issueDate);
  addDate(facts.asOf);

  // Invoice Number digits (e.g. "INV-1042" -> 1042)
  const invoiceDigits = facts.invoice.number.match(/\d+/g);
  if (invoiceDigits) {
    for (const d of invoiceDigits) {
      const num = parseInt(d, 10);
      allowed.add(`int:${num}`);
    }
  }

  // Change-specific facts
  if (facts.change) {
    if ('newExpectedDate' in facts.change) {
      addDate(facts.change.newExpectedDate);
    }
    if ('firstDate' in facts.change) {
      addDate(facts.change.firstDate);
    }
    if ('discountPct' in facts.change) {
      const pct = facts.change.discountPct;
      allowed.add(`pct:${pct}`);
      allowed.add(`int:${pct}`);
      allowed.add(`num:${pct}`);
    }
    if ('count' in facts.change) {
      const count = facts.change.count;
      allowed.add(`int:${count}`);
      allowed.add(`num:${count}`);
    }
    if ('spacingDays' in facts.change) {
      const spacing = facts.change.spacingDays;
      allowed.add(`int:${spacing}`);
      allowed.add(`num:${spacing}`);
    }
  }

  if (facts.customAllowed) {
    for (const tok of facts.customAllowed) {
      allowed.add(tok);
    }
  }

  return allowed;
}

/**
 * Checks whether all numbers and dates in `text` are grounded in `allowed`.
 */
export function checkGrounding(
  text: string,
  allowed: Set<string>,
): { ok: boolean; offenders: string[] } {
  const extracted = extractNumbers(text);
  const offenders: string[] = [];

  for (const token of extracted) {
    if (!allowed.has(token.canonical)) {
      // Also check if an int token is accepted as a number word or vice versa
      if (token.canonical.startsWith('num:')) {
        const n = token.canonical.replace('num:', '');
        if (allowed.has(`int:${n}`)) continue;
      }
      if (token.canonical.startsWith('int:')) {
        const n = token.canonical.replace('int:', '');
        if (allowed.has(`num:${n}`)) continue;
      }
      offenders.push(token.raw);
    }
  }

  return {
    ok: offenders.length === 0,
    offenders: Array.from(new Set(offenders)),
  };
}

