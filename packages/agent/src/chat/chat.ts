import type {
  ChatAnswer,
  EnginePort,
  ForecastResult,
  ISODate,
  LlmPort,
  ScenarioComparison,
  Snapshot,
} from '@settle/shared';
import { generateCalendarTable } from '../clock.js';
import { formatUsd } from '../format.js';
import { checkGrounding } from '../grounding.js';
import { ChatToolContext } from './tools.js';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function addDateTokens(isoDate: ISODate, allowed: Set<string>): void {
  allowed.add(`date:${isoDate}`);
  const parts = isoDate.split('-');
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return;

  const monthIdx = parseInt(m, 10) - 1;
  const dayNum = parseInt(d, 10);
  const monthName = MONTH_NAMES[monthIdx];
  if (monthName) {
    const monthShort = monthName.slice(0, 3).toLowerCase();
    allowed.add(`wdate:${monthShort}_${dayNum}`);
    allowed.add(`wdate:${monthName.toLowerCase()}_${dayNum}`);
  }
}

function addAmountTokens(cents: number | undefined, allowed: Set<string>): void {
  if (cents === undefined || isNaN(cents)) return;
  const absCents = Math.abs(cents);
  allowed.add(`cents:${absCents}`);
  allowed.add(`cents:${cents}`);
  allowed.add(`int:${absCents}`);
  const dollars = Math.floor(absCents / 100);
  allowed.add(`int:${dollars}`);
}

function collectTokensFromValue(val: unknown, allowed: Set<string>): void {
  if (val === null || val === undefined) return;

  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      allowed.add(`int:${val}`);
      allowed.add(`num:${val}`);
      addAmountTokens(val, allowed);
    } else {
      allowed.add(`pct:${val}`);
    }
    return;
  }

  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      addDateTokens(val, allowed);
      return;
    }

    const digits = val.match(/\d+/g);
    if (digits) {
      for (const d of digits) {
        const num = parseInt(d, 10);
        allowed.add(`int:${num}`);
        allowed.add(`num:${num}`);
      }
    }
    return;
  }

  if (Array.isArray(val)) {
    for (const item of val) {
      collectTokensFromValue(item, allowed);
    }
    return;
  }

  if (typeof val === 'object') {
    for (const key of Object.keys(val)) {
      collectTokensFromValue((val as Record<string, unknown>)[key], allowed);
    }
  }
}

export function buildChatAllowedSet(
  snapshot: Snapshot,
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>,
): Set<string> {
  const allowed = new Set<string>();

  // Snapshot business facts
  addDateTokens(snapshot.business.asOf, allowed);
  addAmountTokens(snapshot.business.startingBalance, allowed);
  addAmountTokens(snapshot.business.reserveThreshold, allowed);

  // Snapshot invoices facts
  for (const inv of snapshot.invoices) {
    addDateTokens(inv.dueDate, allowed);
    addDateTokens(inv.issueDate, allowed);
    addAmountTokens(inv.amount, allowed);
    addAmountTokens(inv.amountPaid, allowed);
    addAmountTokens(inv.amount - inv.amountPaid, allowed);
    const digits = inv.number.match(/\d+/g);
    if (digits) {
      for (const d of digits) {
        const num = parseInt(d, 10);
        allowed.add(`int:${num}`);
        allowed.add(`num:${num}`);
      }
    }
  }

  // Tool calls arguments and results
  for (const tc of toolCalls) {
    collectTokensFromValue(tc.args, allowed);
    collectTokensFromValue(tc.result, allowed);
  }

  return allowed;
}

export function buildChatSystemPrompt(asOf: ISODate): string {
  const calendarTable = generateCalendarTable(asOf, 14);

  return `You are Settle's accounts-receivable and cash-flow assistant.
SCOPE RULE: You ONLY answer questions about cash flow forecasting, invoice tracking, and payment collections.
If the user asks anything outside this scope (e.g. poetry, coding, recipes, general knowledge, chit-chat), you must REFUSE immediately in one brief polite sentence without making any tool calls.

Current AsOf Date: ${asOf}

Upcoming 14-day calendar:
${calendarTable}

Use the calendar table to map weekday references (e.g. "Monday", "Friday") to exact ISO dates YYYY-MM-DD.
Always call the relevant tools to retrieve real facts before answering. Never invent numbers, balances, dates, or calculations.
Quote monetary amounts in formatted USD (e.g. $1,250.00).`;
}

export function buildTemplatedChatSummary(
  lastComparison?: ScenarioComparison,
  lastForecast?: ForecastResult,
): string {
  if (lastComparison) {
    const changeType = lastComparison.change.type;
    const deltaStr = formatUsd(lastComparison.lowestDelta);
    const shortfallStr = formatUsd(lastComparison.shortfallDelta);
    return `Simulation complete for ${changeType}: the lowest cash balance impact is ${deltaStr} with a shortfall change of ${shortfallStr}.`;
  }

  if (lastForecast) {
    const lowestStr = formatUsd(lastForecast.lowest.amount);
    const shortfallStr = formatUsd(lastForecast.shortfall);
    if (lastForecast.shortfall > 0 && lastForecast.firstBreachDate) {
      return `Cash flow forecast: projected shortfall of ${shortfallStr} starting on ${lastForecast.firstBreachDate}. Lowest balance is ${lowestStr} on ${lastForecast.lowest.date}.`;
    }
    return `Cash flow forecast: lowest cash point is ${lowestStr} on ${lastForecast.lowest.date} with no shortfall.`;
  }

  return 'Cash flow and receivables review complete based on verified snapshot data.';
}

export async function runChat(
  question: string,
  snapshot: Snapshot,
  engine: EnginePort,
  llm: LlmPort,
): Promise<ChatAnswer> {
  const toolContext = new ChatToolContext(snapshot, engine);
  const toolDefs = toolContext.createTools();
  const system = buildChatSystemPrompt(snapshot.business.asOf);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: question },
  ];

  // Run LLM with tools
  const response = await llm.runWithTools({
    system,
    messages,
    tools: toolDefs,
    maxSteps: 4,
  });

  // If no tools were called, check if it's a scope refusal or simple answer
  if (toolContext.executedToolCalls.length === 0) {
    return {
      text: response.text,
      toolCalls: [],
      comparison: undefined,
      forecast: undefined,
    };
  }

  // Grounding check against snapshot and tool results
  const allowed = buildChatAllowedSet(
    snapshot,
    toolContext.executedToolCalls,
  );
  const groundCheck = checkGrounding(response.text, allowed);

  let finalText = response.text;

  if (!groundCheck.ok) {
    // Retry ONCE with offenders listed
    const retryMessages: Array<{
      role: 'user' | 'assistant';
      content: string;
    }> = [
      ...messages,
      { role: 'assistant', content: response.text },
      {
        role: 'user',
        content: `Previous response contained ungrounded numbers or dates: ${groundCheck.offenders.join(', ')}. Please provide an answer quoting ONLY verified facts from the tool results.`,
      },
    ];

    try {
      const retryResponse = await llm.runWithTools({
        system,
        messages: retryMessages,
        tools: toolDefs,
        maxSteps: 2,
      });

      const retryAllowed = buildChatAllowedSet(
        snapshot,
        toolContext.executedToolCalls,
      );
      const retryGround = checkGrounding(retryResponse.text, retryAllowed);

      if (retryGround.ok) {
        finalText = retryResponse.text;
      } else {
        // Fall back to templated factual summary
        finalText = buildTemplatedChatSummary(
          toolContext.lastComparison,
          toolContext.lastForecast,
        );
      }
    } catch {
      finalText = buildTemplatedChatSummary(
        toolContext.lastComparison,
        toolContext.lastForecast,
      );
    }
  }

  return {
    text: finalText,
    toolCalls: toolContext.executedToolCalls,
    comparison: toolContext.lastComparison,
    forecast: toolContext.lastForecast,
  };
}

