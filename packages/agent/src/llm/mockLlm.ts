import type { LlmPort } from '@settle/shared';
import { formatUsd } from '../format.js';

export type MockLlmMode =
  | 'good'
  | 'invalidJson'
  | 'unknownId'
  | 'ungroundedNumber'
  | 'slow'
  | 'noPayUrl';

export interface MockLlmOptions {
  mode?: MockLlmMode;
  slowDelayMs?: number;
  info?: { provider: string; model: string };
  chatResponseOverride?: string;
}

export interface CandidateOption {
  id: string;
  cashCost: number;
  closesGap: boolean;
  lowestDelta: number;
  [key: string]: unknown;
}

/**
 * Apply the core selection guidance algorithm:
 * "Choose the option with the lowest cashCost that closes the gap.
 * If none closes it, choose the option with the largest lowestDelta.
 * If no gap exists, lowest cashCost."
 */
export function selectOptionByGuidance(
  candidates: CandidateOption[],
  hasGap = true,
): CandidateOption | undefined {
  if (candidates.length === 0) return undefined;

  if (hasGap) {
    const closing = candidates.filter((c) => c.closesGap);
    if (closing.length > 0) {
      // Lowest cashCost among closesGap=true, tiebreaker largest lowestDelta
      return [...closing].sort((a, b) => {
        if (a.cashCost !== b.cashCost) return a.cashCost - b.cashCost;
        return b.lowestDelta - a.lowestDelta;
      })[0];
    }

    // None closes it: largest lowestDelta, tiebreaker lowest cashCost
    return [...candidates].sort((a, b) => {
      if (a.lowestDelta !== b.lowestDelta) return b.lowestDelta - a.lowestDelta;
      return a.cashCost - b.cashCost;
    })[0];
  }

  // No gap exists: lowest cashCost
  return [...candidates].sort((a, b) => {
    if (a.cashCost !== b.cashCost) return a.cashCost - b.cashCost;
    return b.lowestDelta - a.lowestDelta;
  })[0];
}

/**
 * Parse candidates from JSON or plain text prompt.
 */
export function extractCandidatesFromPrompt(userPrompt: string): {
  candidates: CandidateOption[];
  hasGap: boolean;
} {
  // 1. Try parsing JSON
  try {
    let parsed: any;
    const jsonMatch =
      userPrompt.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
      userPrompt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);

    if (jsonMatch?.[1]) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      parsed = JSON.parse(userPrompt);
    }

    const rawList = Array.isArray(parsed)
      ? parsed
      : (parsed?.candidates || parsed?.options || []);

    if (Array.isArray(rawList) && rawList.length > 0) {
      const candidates: CandidateOption[] = rawList.map((item: any, idx: number) => ({
        id: String(item.id || item.optionId || `opt_${idx + 1}`),
        cashCost: Number(item.cashCost ?? 0),
        closesGap: Boolean(item.closesGap),
        lowestDelta: Number(item.lowestDelta ?? 0),
      }));

      const hasGap =
        parsed?.hasGap !== undefined
          ? Boolean(parsed.hasGap)
          : parsed?.shortfall !== undefined
            ? parsed.shortfall > 0
            : true;

      return { candidates, hasGap };
    }
  } catch {
    // Not valid JSON, proceed to text parsing
  }

  // 2. Multiline candidate blocks or line-by-line extraction
  const candidates: CandidateOption[] = [];
  const candidateBlocks = userPrompt.split(/(?=(?:^|\n)\s*-\s*)/);

  for (const block of candidateBlocks) {
    const idMatch = block.match(
      /-\s*(?:Option\s*ID[:=\s"']*|candidate[:=\s"']*|option[:=\s"']*|id[:=\s"']*)?([a-zA-Z0-9_-]+)/i,
    );

    if (idMatch?.[1]) {
      const id = idMatch[1];
      const closesGapMatch = block.match(/closes\s*Gap[:=\s"']*(true|false)/i);
      const cashCostMatch = block.match(/cash\s*Cost[:=\s"']*(-?\d+)/i);
      const lowestDeltaMatch = block.match(/lowest\s*Delta[:=\s"']*(-?\d+)/i);

      if (closesGapMatch || cashCostMatch || lowestDeltaMatch || id === 'escalate') {
        candidates.push({
          id,
          closesGap: closesGapMatch
            ? closesGapMatch[1]?.toLowerCase() === 'true'
            : false,
          cashCost: cashCostMatch?.[1] ? parseInt(cashCostMatch[1], 10) : 0,
          lowestDelta: lowestDeltaMatch?.[1]
            ? parseInt(lowestDeltaMatch[1], 10)
            : 0,
        });
      }
    }
  }

  const unique = Array.from(
    new Map(candidates.map((c) => [c.id, c])).values(),
  );
  const hasGap =
    !userPrompt.includes('shortfall: 0') && !userPrompt.includes('gap: false');

  return { candidates: unique, hasGap };
}

export class MockLlm implements LlmPort {
  readonly options: MockLlmOptions;
  readonly mode: MockLlmMode;
  readonly slowDelayMs: number;
  readonly info: { readonly provider: string; readonly model: string };

  constructor(options: MockLlmOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? 'good';
    this.slowDelayMs = options.slowDelayMs ?? 100;
    this.info = options.info ?? { provider: 'mock', model: 'mock-model' };
  }

  async generateStructured<R>(a: {
    system: string;
    user: string;
    jsonSchema: object;
  }): Promise<R> {
    if (this.mode === 'invalidJson') {
      throw new Error('Invalid JSON: simulated syntax error in LLM output');
    }

    if (this.mode === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, this.slowDelayMs));
    }

    // Handle draft note requests (title === 'draft_note')
    const schemaTitle = (a.jsonSchema as any)?.title;
    if (schemaTitle === 'draft_note') {
      if (this.mode === 'noPayUrl') {
        return {
          note: 'Hello, please settle your overdue balance by visiting our payment portal at https://settle.dev/pay. Thank you!',
        } as unknown as R;
      }
      if (this.mode === 'ungroundedNumber') {
        return {
          note: 'Hello, you have an outstanding balance of $999,999.00 with a 99999% discount. Please pay here: {{PAY_URL}}.',
        } as unknown as R;
      }

      const invoiceNumMatch = a.user.match(/(?:Invoice:\s*|Invoice Number:\s*)([A-Z0-9_-]+)/i);
      const invNumber = invoiceNumMatch?.[1] ?? 'INV-1001';
      const remainingMatch = a.user.match(/Remaining Balance:\s*(\$[0-9,.]+)/i);
      const remaining = remainingMatch?.[1] ?? '$1,000.00';
      const dueDateMatch = a.user.match(/Due Date:\s*(\d{4}-\d{2}-\d{2})/i);
      const dueDate = dueDateMatch?.[1] ?? '2026-11-05';
      const discountMatch = a.user.match(/Offered Discount:\s*(\d+)%/i);
      const discountPct = discountMatch?.[1] ?? '3';
      const discountedMatch = a.user.match(/Discounted Amount:\s*(\$[0-9,.]+)/i);
      const discountedAmount = discountedMatch?.[1] ?? remaining;
      const countMatch = a.user.match(/Instalments:\s*(\d+)/i);
      const count = countMatch?.[1] ?? '3';
      const spacingMatch = a.user.match(/Spacing:\s*(\d+)/i);
      const spacing = spacingMatch?.[1] ?? '30';

      const isDiscount = /OFFER_DISCOUNT/i.test(a.user);
      const isInstalments = /OFFER_INSTALMENTS/i.test(a.user);

      let note = `Hello, this is a reminder that invoice ${invNumber} for ${remaining} was due on ${dueDate}. Please pay securely here: {{PAY_URL}}. Thank you!`;
      if (isDiscount) {
        note = `Hello, regarding invoice ${invNumber} (${remaining} due on ${dueDate}), we offer a ${discountPct}% discount. You can pay ${discountedAmount} here: {{PAY_URL}}. Thank you!`;
      } else if (isInstalments) {
        note = `Hello, regarding invoice ${invNumber} (${remaining} due on ${dueDate}), we offer ${count} instalments spaced ${spacing} days apart. Pay your first instalment here: {{PAY_URL}}. Thank you!`;
      }

      return { note } as unknown as R;
    }

    // Handle decision requests
    const hasStrictSchema =
      (a.jsonSchema as any)?.additionalProperties === false &&
      (a.jsonSchema as any)?.properties;
    const allowedProps = hasStrictSchema
      ? Object.keys((a.jsonSchema as any).properties)
      : [];

    if (this.mode === 'unknownId') {
      if (hasStrictSchema) {
        const out: Record<string, unknown> = {};
        if (allowedProps.includes('optionId')) out['optionId'] = 'opt_unknown_999';
        if (allowedProps.includes('selectedOptionId'))
          out['selectedOptionId'] = 'opt_unknown_999';
        if (allowedProps.includes('reason'))
          out['reason'] = 'Selected unknown option opt_unknown_999 not present in facts';
        return out as unknown as R;
      }
      return {
        selectedOptionId: 'opt_unknown_999',
        optionId: 'opt_unknown_999',
        id: 'opt_unknown_999',
        reason: 'Selected unknown option opt_unknown_999 not present in facts',
      } as unknown as R;
    }

    const { candidates, hasGap } = extractCandidatesFromPrompt(a.user);
    const chosen = selectOptionByGuidance(candidates, hasGap);

    if (this.mode === 'ungroundedNumber') {
      const selectedId = chosen ? chosen.id : 'opt_1';
      if (hasStrictSchema) {
        const out: Record<string, unknown> = {};
        if (allowedProps.includes('optionId')) out['optionId'] = selectedId;
        if (allowedProps.includes('selectedOptionId'))
          out['selectedOptionId'] = selectedId;
        if (allowedProps.includes('reason'))
          out['reason'] = 'Offering 99999% discount saving $999,999.00.';
        return out as unknown as R;
      }
      return {
        selectedOptionId: selectedId,
        optionId: selectedId,
        id: selectedId,
        reason: 'Offering 99999% discount saving $999,999.00.',
      } as unknown as R;
    }

    // Default 'good' mode
    if (!chosen) {
      if (hasStrictSchema) {
        const out: Record<string, unknown> = {};
        if (allowedProps.includes('optionId')) out['optionId'] = 'escalate';
        if (allowedProps.includes('reason'))
          out['reason'] = 'No candidate options provided in facts';
        return out as unknown as R;
      }
      return {
        selectedOptionId: null,
        optionId: null,
        id: null,
        reason: 'No candidate options provided in facts',
      } as unknown as R;
    }

    const invoiceNumMatch = a.user.match(/(?:Invoice Number:\s*|Invoice:\s*)([A-Z0-9_-]+)/i);
    const invLabel = invoiceNumMatch?.[1] ? ` for invoice ${invoiceNumMatch[1]}` : '';

    const deltaUsd = formatUsd(chosen.lowestDelta);
    const costUsd = formatUsd(chosen.cashCost);

    const reason = chosen.closesGap
      ? `Selecting action${invLabel} to close the cashflow gap, yielding ${deltaUsd} in cash at a cost of ${costUsd}.`
      : `Selecting action${invLabel} to improve cash balance by ${deltaUsd} at a cost of ${costUsd}.`;

    if (hasStrictSchema) {
      const out: Record<string, unknown> = {};
      if (allowedProps.includes('optionId')) out['optionId'] = chosen.id;
      if (allowedProps.includes('selectedOptionId'))
        out['selectedOptionId'] = chosen.id;
      if (allowedProps.includes('reason')) out['reason'] = reason;
      return out as unknown as R;
    }

    const result: Record<string, unknown> = {
      selectedOptionId: chosen.id,
      optionId: chosen.id,
      id: chosen.id,
      reason,
      closesGap: chosen.closesGap,
      cashCost: chosen.cashCost,
      lowestDelta: chosen.lowestDelta,
    };

    return result as unknown as R;
  }

  async runWithTools(a: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: {
      name: string;
      description: string;
      jsonSchema: object;
      run(args: any): Promise<unknown>;
    }[];
    maxSteps: number;
  }): Promise<{
    text: string;
    toolCalls: { name: string; args: unknown; result: unknown }[];
  }> {
    const originalUserMessage =
      a.messages.find((m) => m.role === 'user')?.content ?? '';
    const lastUserMessage =
      [...a.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const isRetry = lastUserMessage.includes('ungrounded');

    if (isRetry && this.options.chatResponseOverride) {
      return {
        text: this.options.chatResponseOverride,
        toolCalls: [],
      };
    }

    const userLower = originalUserMessage.toLowerCase();

    // Check scope: out of scope questions (e.g. poem, cats, coding, recipes)
    const isOutOfScope =
      userLower.includes('poem') ||
      userLower.includes('cat') ||
      userLower.includes('joke') ||
      userLower.includes('recipe') ||
      (!userLower.includes('payroll') &&
        !userLower.includes('stock') &&
        !userLower.includes('buy') &&
        !userLower.includes('purchase') &&
        !userLower.includes('chase') &&
        !userLower.includes('invoice') &&
        !userLower.includes('forecast') &&
        !userLower.includes('overdue'));

    if (isOutOfScope) {
      return {
        text: 'I am an accounts-receivable and cash-flow assistant, and I can only help with cash flow forecasting, invoices, and collections.',
        toolCalls: [],
      };
    }

    const toolCalls: { name: string; args: unknown; result: unknown }[] = [];
    const toolMap = new Map(a.tools.map((t) => [t.name, t]));
    const max = Math.max(1, a.maxSteps);

    // 1. "cover payroll" / "payroll"
    if (userLower.includes('payroll') || userLower.includes('cover payroll')) {
      const forecastTool = toolMap.get('get_forecast');
      if (forecastTool && toolCalls.length < max) {
        const result = (await forecastTool.run({})) as {
          shortfall: number;
          firstBreachDate: string | null;
          lowest: { date: string; amount: number };
          days: Array<{
            date: string;
            closing: number;
            belowReserve: boolean;
          }>;
        };
        toolCalls.push({ name: 'get_forecast', args: {}, result });

        if (this.options.chatResponseOverride) {
          return { text: this.options.chatResponseOverride, toolCalls };
        }

        // Check if user asked about a specific weekday
        const weekdayMatch = originalUserMessage.match(
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
        );

        if (weekdayMatch && weekdayMatch[1]) {
          const weekday = weekdayMatch[1];
          const tableMatch = new RegExp(
            `\\|\\s*(\\d{4}-\\d{2}-\\d{2})\\s*\\|\\s*${weekday}\\s*\\|`,
            'i',
          ).exec(a.system);
          const askedDate = tableMatch?.[1];
          const dayBalance = askedDate
            ? result.days.find((d) => d.date === askedDate)
            : undefined;

          if (dayBalance && askedDate) {
            const closingStr = formatUsd(dayBalance.closing);
            const reserveStatus = dayBalance.belowReserve
              ? 'below the reserve'
              : 'above the reserve';
            const lowestStr = formatUsd(result.lowest.amount);
            const breachStr = result.firstBreachDate
              ? `first breach date of ${result.firstBreachDate}`
              : 'no projected breach';

            const text = `On ${weekday} (${askedDate}), projected closing balance is ${closingStr}, which is ${reserveStatus}. Lowest point across the forecast is ${lowestStr} on ${result.lowest.date} with ${breachStr}.`;
            return { text, toolCalls };
          }
        }

        const text =
          result.shortfall > 0 && result.firstBreachDate
            ? `Based on your cash flow forecast, you have a projected shortfall of ${formatUsd(result.shortfall)} starting on ${result.firstBreachDate}. You will not cover payroll without collecting receivables.`
            : `Based on your cash flow forecast, your lowest cash point is ${formatUsd(result.lowest.amount)} on ${result.lowest.date} with no shortfall, so you can cover payroll.`;

        return { text, toolCalls };
      }
    }

    // 2. "buy $X of stock on <weekday>" / purchase
    if (
      userLower.includes('buy') ||
      userLower.includes('stock') ||
      userLower.includes('purchase')
    ) {
      const amountMatch = originalUserMessage.match(
        /\$([0-9,]+(?:\.\d{2})?)/,
      );
      const weekdayMatch = originalUserMessage.match(
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      );

      let cents = 300000;
      if (amountMatch && amountMatch[1]) {
        const raw = amountMatch[1].replace(/,/g, '');
        cents = Math.round(parseFloat(raw) * 100);
      }

      let dateIso = '2026-11-09';
      if (weekdayMatch && weekdayMatch[1]) {
        const day = weekdayMatch[1];
        const tableMatch = new RegExp(
          `\\|\\s*(\\d{4}-\\d{2}-\\d{2})\\s*\\|\\s*${day}\\s*\\|`,
          'i',
        ).exec(a.system);
        if (tableMatch && tableMatch[1]) {
          dateIso = tableMatch[1];
        }
      }

      const simTool = toolMap.get('simulate_scenario');
      if (simTool && toolCalls.length < max) {
        const change = {
          type: 'PURCHASE',
          label: 'Stock purchase',
          amount: cents,
          date: dateIso,
        };
        const result = (await simTool.run({ change })) as {
          lowestDelta: number;
          shortfallDelta: number;
        };
        toolCalls.push({
          name: 'simulate_scenario',
          args: { change },
          result,
        });

        if (this.options.chatResponseOverride) {
          return { text: this.options.chatResponseOverride, toolCalls };
        }

        const text = `Simulating a stock purchase of ${formatUsd(cents)} on ${dateIso} results in a lowest cash point delta of ${formatUsd(result.lowestDelta)} and shortfall delta of ${formatUsd(result.shortfallDelta)}.`;

        return { text, toolCalls };
      }
    }

    // 3. "which invoice ... first" / "chase"
    if (
      userLower.includes('which invoice') ||
      userLower.includes('chase') ||
      userLower.includes('first')
    ) {
      const listTool = toolMap.get('list_overdue_invoices');
      if (listTool && toolCalls.length < max) {
        const listResult = (await listTool.run({})) as {
          invoices: Array<{
            id: string;
            number: string;
            remainingAmount: number;
            dueDate: string;
          }>;
        };
        toolCalls.push({
          name: 'list_overdue_invoices',
          args: {},
          result: listResult,
        });

        const top = listResult.invoices[0];
        if (top && toolCalls.length < max) {
          const compTool = toolMap.get('compare_options');
          if (compTool) {
            const compResult = (await compTool.run({
              invoiceId: top.id,
            })) as {
              candidates: Array<{
                simulation: { lowestDelta: number };
              }>;
            };
            toolCalls.push({
              name: 'compare_options',
              args: { invoiceId: top.id },
              result: compResult,
            });

            if (this.options.chatResponseOverride) {
              return { text: this.options.chatResponseOverride, toolCalls };
            }

            const delta =
              compResult.candidates[0]?.simulation.lowestDelta ?? 0;
            const text = `You should chase invoice ${top.number} for ${formatUsd(top.remainingAmount)} due on ${top.dueDate} first. Reminding them yields a lowest cash delta of ${formatUsd(delta)}.`;

            return { text, toolCalls };
          }
        }

        if (this.options.chatResponseOverride) {
          return { text: this.options.chatResponseOverride, toolCalls };
        }

        return {
          text: `Found ${listResult.invoices.length} overdue invoices.`,
          toolCalls,
        };
      }
    }

    if (this.options.chatResponseOverride) {
      return { text: this.options.chatResponseOverride, toolCalls };
    }

    return {
      text: 'No relevant cash flow tools could be executed.',
      toolCalls,
    };
  }
}
