/**
 * Currency and date formatting utilities.
 * Follows AGENT_RULES.md:
 * - Integer cents only; no floating point arithmetic.
 * - Dates parsed and formatted in UTC to prevent timezone off-by-one errors.
 */

/**
 * Formats integer cents to USD currency string.
 * Uses integer math only: sign, Math.trunc(abs / 100), abs % 100.
 * Intl.NumberFormat is used only for thousands grouping on whole dollars.
 *
 * Examples:
 *   formatUsd(0) => "$0.00"
 *   formatUsd(100) => "$1.00"
 *   formatUsd(-150) => "-$1.50"
 *   formatUsd(123456789) => "$1,234,567.89"
 */
export function formatUsd(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;

  const dollarsFormatted = new Intl.NumberFormat('en-US').format(dollars);
  const centsFormatted = rem.toString().padStart(2, '0');

  return `${isNegative ? '-' : ''}$${dollarsFormatted}.${centsFormatted}`;
}

/**
 * Parses an ISO YYYY-MM-DD date in UTC.
 */
function parseUtcDate(isoDate: string): { date: Date; year: number; month: number; day: number } {
  const parts = isoDate.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error(`Invalid ISO date format: ${isoDate}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return { date, year, month, day };
}

/**
 * Formats an ISO date into e.g. "Fri 6 Nov".
 * Parsed in UTC to avoid off-by-one errors across timezones.
 */
export function formatDate(isoDate: string): string {
  const { date, day } = parseUtcDate(isoDate);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(date);
  return `${weekday} ${day} ${month}`;
}

/**
 * Formats an ISO date into e.g. "Nov 6".
 */
export function formatDateShort(isoDate: string): string {
  const { date, day } = parseUtcDate(isoDate);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(date);
  return `${month} ${day}`;
}

/**
 * Humanizes an uppercase status code (e.g. "AWAITING_APPROVAL" => "Awaiting Approval").
 * Per Rule 4: Chips and pills render invoice.status / action.status verbatim (humanised), never inferred.
 */
export function humanizeStatus(status: string): string {
  if (!status) return '';
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Converts a fractional ratio (0..1) into an integer percentage (0..100).
 */
export function riskToPercent(risk: number): number {
  return Math.round(risk * 100);
}

export interface FormattedActionReason {
  cleanReason: string;
  provenanceCaption: string;
}

/**
 * Formats action reason and extracts LLM/rules provenance.
 * - Prefers action.reasonDisplay when present.
 * - If only action.reason is present and ends with "[via ...]", strips the tag.
 * - Determines provenance: "Written by <provider/model>" when path=llm, otherwise "Written by rules".
 */
export function formatActionReason(action?: {
  reason?: string;
  reasonDisplay?: string;
  reasonSource?: string;
}): FormattedActionReason {
  if (!action) {
    return {
      cleanReason: 'No proposed action. This invoice was evaluated without active recovery required.',
      provenanceCaption: 'Written by rules',
    };
  }

  const rawReason = action.reason?.trim() ?? '';
  let cleanReason = action.reasonDisplay?.trim() || '';

  if (!cleanReason) {
    cleanReason = rawReason.replace(/\s*\[via\s+[^\]]+\]\s*$/, '').trim();
    if (!cleanReason) {
      cleanReason = rawReason;
    }
  }

  const source = action.reasonSource?.trim() || '';
  const tagMatch = rawReason.match(/\[via\s+([^\]]+)\]/);
  const tagContent = tagMatch ? tagMatch[1] : '';

  const provenanceStr = source || tagContent;
  let path: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;

  if (provenanceStr) {
    const pathMatch = provenanceStr.match(/path=([^;\]\s]+)/);
    const providerMatch = provenanceStr.match(/provider=([^;\]\s]+)/);
    const modelMatch = provenanceStr.match(/model=([^;\]\s]+)/);

    if (pathMatch) path = pathMatch[1];
    if (providerMatch) provider = providerMatch[1];
    if (modelMatch) model = modelMatch[1];
  }

  let provenanceCaption: string;
  if (path === 'llm' && (provider || model)) {
    const target = provider && model ? `${provider}/${model}` : (model || provider);
    provenanceCaption = `Written by ${target}`;
  } else {
    provenanceCaption = 'Written by rules';
  }

  return { cleanReason, provenanceCaption };
}

