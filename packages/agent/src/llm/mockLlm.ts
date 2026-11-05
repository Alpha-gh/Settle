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
  readonly mode: MockLlmMode;
  readonly slowDelayMs: number;
  readonly info: { readonly provider: string; readonly model: string };

  constructor(options: MockLlmOptions = {}) {
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
      const isDiscount = /OFFER_DISCOUNT/i.test(a.user);
      const isInstalments = /OFFER_INSTALMENTS/i.test(a.user);

      let note = `Hello, this is a reminder regarding invoice ${invNumber}. You can review and settle your payment securely here: {{PAY_URL}}. Thank you!`;
      if (isDiscount) {
        note = `Hello, regarding invoice ${invNumber}, we are pleased to offer a discount to accelerate settlement. You can pay here: {{PAY_URL}}. Thank you!`;
      } else if (isInstalments) {
        note = `Hello, regarding invoice ${invNumber}, we can offer instalment options to assist with repayment. You can arrange your plan here: {{PAY_URL}}. Thank you!`;
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

  async runWithTools(_a: {
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
    throw new Error('NotImplemented: runWithTools is not implemented yet');
  }
}
