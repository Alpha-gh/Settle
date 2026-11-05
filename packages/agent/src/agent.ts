import type {
  ActionParams,
  ActionRecord,
  ActionStatus,
  ActionType,
  AgentPort,
  AgentRunResult,
  ChatAnswer,
  EnginePort,
  ForecastInput,
  Id,
  Invoice,
  LlmPort,
  Policy,
  Snapshot,
} from '@settle/shared';
import { evaluatePolicy } from '@settle/shared';
import { SystemClock, type Clock } from './clock.js';
import { deterministicChoice, templatedReason } from './fallback.js';
import { applyChosenChange } from './foldChange.js';
import { formatUsd } from './format.js';
import { DeterministicIdGen, type IdGen } from './ids.js';
import { buildCandidates, type Candidate } from './options.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from './prompts/decision.js';
import { buildDecisionSchema } from './schema.js';

export interface ExtendedLlmPort extends LlmPort {
  readonly info?: {
    readonly provider: string;
    readonly model: string;
  };
}

export interface CreateAgentOptions {
  engine: EnginePort;
  llm: LlmPort;
  clock?: Clock;
  idGen?: IdGen;
  remindersLookup?: (invoiceId: Id) => number;
  policy?: Policy;
}

export class SettleAgent implements AgentPort {
  private readonly engine: EnginePort;
  private readonly llm: ExtendedLlmPort;
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly remindersLookup: (invoiceId: Id) => number;
  private readonly defaultPolicy?: Policy;

  constructor(options: CreateAgentOptions) {
    this.engine = options.engine;
    this.llm = options.llm as ExtendedLlmPort;
    this.clock = options.clock ?? new SystemClock();
    this.idGen = options.idGen ?? new DeterministicIdGen();
    this.remindersLookup = options.remindersLookup ?? (() => 0);
    this.defaultPolicy = options.policy;
  }

  async runCycle(snapshot: Snapshot): Promise<AgentRunResult> {
    const runId = this.idGen.next('run');
    const policy = this.defaultPolicy ?? snapshot.policy;
    const actions: ActionRecord[] = [];
    const skipped: { invoiceId: Id; why: string }[] = [];

    // 1. Select overdue invoices: dueDate < asOf && status in (SENT, PARTIALLY_PAID) && (amount - amountPaid) > 0
    const overdueInvoices: Invoice[] = [];
    for (const inv of snapshot.invoices) {
      const isOverdueDate = inv.dueDate < snapshot.business.asOf;
      const isOpenStatus = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';
      const remaining = inv.amount - inv.amountPaid;

      if (isOverdueDate) {
        if (isOpenStatus && remaining > 0) {
          overdueInvoices.push(inv);
        } else if (remaining <= 0 && isOpenStatus) {
          skipped.push({
            invoiceId: inv.id,
            why: `Overdue invoice ${inv.number} has zero or negative remaining balance`,
          });
        }
      }
    }

    // Sort overdue by remaining amount desc, ties by invoice id asc
    overdueInvoices.sort((a, b) => {
      const remA = a.amount - a.amountPaid;
      const remB = b.amount - b.amountPaid;
      if (remA !== remB) {
        return remB - remA;
      }
      return a.id.localeCompare(b.id);
    });

    // 2. Expected receipts & working ForecastInput
    const receipts = this.engine.expectedReceipts(
      snapshot.invoices,
      snapshot.payers,
      snapshot.business.asOf,
    );

    let workingInput: ForecastInput = {
      business: snapshot.business,
      obligations: snapshot.obligations,
      receipts,
      horizonDays: 30,
    };

    const payerMap = new Map(snapshot.payers.map((p) => [p.id, p]));

    // 3. Process each overdue invoice
    for (const invoice of overdueInvoices) {
      try {
        const payer = payerMap.get(invoice.payerId);
        if (!payer) {
          skipped.push({
            invoiceId: invoice.id,
            why: `Payer ${invoice.payerId} not found in snapshot`,
          });
          continue;
        }

        const remaining = invoice.amount - invoice.amountPaid;

        // 3a. Generate options
        const options = this.engine.generateOptions(
          workingInput,
          invoice,
          payer,
          policy,
        );

        if (options.length === 0) {
          // ESCALATE with templated reason from snapshot data. No LLM call.
          const escalateReason = `Payer persona ${payer.persona} is unresponsive. Escalating invoice ${invoice.number} (${formatUsd(remaining)} due ${invoice.dueDate}) for manual collection.`;
          const actionType: ActionType = 'ESCALATE';
          const actionParams: ActionParams = {
            note: `Payer persona ${payer.persona} is unresponsive. Escalated for manual collection.`,
          };

          const verdict = evaluatePolicy(
            { type: actionType, params: actionParams },
            invoice,
            policy,
            {
              now: this.clock.now(),
              remindersLastWeek: this.remindersLookup(invoice.id),
            },
          );

          let status: ActionStatus;
          let decidedBy: 'owner' | 'auto' | undefined;
          let fullReason = escalateReason;

          if (!verdict.allowed) {
            status = 'BLOCKED';
            fullReason = `${escalateReason}. Policy violations: ${verdict.violations.join('; ')}`;
          } else if (verdict.requiresApproval) {
            status = 'AWAITING_APPROVAL';
          } else {
            status = 'APPROVED';
            decidedBy = 'auto';
          }

          const llmInfo = this.llm.info ?? {
            provider: 'mock',
            model: 'mock-model',
          };
          fullReason = `${fullReason} [via provider=${llmInfo.provider}; model=${llmInfo.model}; path=fallback]`;

          actions.push({
            id: this.idGen.next('act'),
            invoiceId: invoice.id,
            type: actionType,
            params: actionParams,
            reason: fullReason,
            simulation: undefined,
            policy: verdict,
            status,
            createdAt: this.clock.now().toISOString(),
            decidedBy,
          });
          continue;
        }

        // 3b. Simulate every option
        const simulations = options.map((change) =>
          this.engine.simulate(workingInput, change),
        );

        // 3c. Build candidates
        const candidates = buildCandidates(simulations, invoice, payer);
        const candidateIds = candidates.map((c) => c.id);
        const { jsonSchema, validator } = buildDecisionSchema(candidateIds);

        // 3d. LLM decision with retry ONCE, then deterministic fallback
        let chosenCandidate: Candidate | null = null;
        let modelReason = '';
        let path: 'llm' | 'fallback' = 'llm';

        const system = buildSystemPrompt();
        const user = buildUserPrompt({
          invoice,
          payer,
          candidates,
        });

        // Attempt 1
        try {
          const raw = await this.llm.generateStructured<{
            optionId: string;
            reason: string;
          }>({
            system,
            user,
            jsonSchema,
          });

          const parsed = validator.safeParse(raw);
          if (parsed.success) {
            const found = candidates.find((c) => c.id === parsed.data.optionId);
            if (found) {
              chosenCandidate = found;
              modelReason = parsed.data.reason;
            }
          }

          // Retry ONCE if invalid
          if (!chosenCandidate) {
            const retryRaw = await this.llm.generateStructured<{
              optionId: string;
              reason: string;
            }>({
              system,
              user,
              jsonSchema,
            });

            const retryParsed = validator.safeParse(retryRaw);
            if (retryParsed.success) {
              const found = candidates.find(
                (c) => c.id === retryParsed.data.optionId,
              );
              if (found) {
                chosenCandidate = found;
                modelReason = retryParsed.data.reason;
              }
            }
          }
        } catch {
          // LLM failure; proceed to fallback
        }

        // Fallback if LLM produced invalid output or failed
        if (!chosenCandidate) {
          path = 'fallback';
          chosenCandidate = deterministicChoice(candidates);
          modelReason = templatedReason(chosenCandidate, invoice);
        }

        // 3e. Map chosen change to ActionType and ActionParams
        let actionType: ActionType;
        let actionParams: ActionParams = {};

        if (chosenCandidate.id === 'escalate') {
          actionType = 'ESCALATE';
          actionParams = {
            note: `Escalated for manual review/collection: ${modelReason}`,
          };
        } else {
          switch (chosenCandidate.change.type) {
            case 'REMIND':
              actionType = 'REMIND';
              actionParams = { note: 'Friendly reminder: {{PAY_URL}}' };
              break;

            case 'OFFER_DISCOUNT':
              actionType = 'OFFER_DISCOUNT';
              actionParams = {
                discountPct: chosenCandidate.change.discountPct,
              };
              break;

            case 'OFFER_INSTALMENTS':
              actionType = 'OFFER_INSTALMENTS';
              actionParams = {
                instalments: {
                  count: chosenCandidate.change.count,
                  spacingDays: chosenCandidate.change.spacingDays,
                },
              };
              break;

            default:
              actionType = 'NO_ACTION';
              break;
          }
        }

        // 3f. Evaluate policy
        const verdict = evaluatePolicy(
          { type: actionType, params: actionParams },
          invoice,
          policy,
          {
            now: this.clock.now(),
            remindersLastWeek: this.remindersLookup(invoice.id),
          },
        );

        // 3g. Determine status
        let status: ActionStatus;
        let decidedBy: 'owner' | 'auto' | undefined;
        let fullReason = modelReason;

        if (!verdict.allowed) {
          status = 'BLOCKED';
          fullReason = `${modelReason}. Policy violations: ${verdict.violations.join('; ')}`;
        } else if (verdict.requiresApproval) {
          status = 'AWAITING_APPROVAL';
        } else {
          status = 'APPROVED';
          decidedBy = 'auto';
        }

        // 3h. Append provenance suffix
        const llmInfo = this.llm.info ?? {
          provider: 'mock',
          model: 'mock-model',
        };
        fullReason = `${fullReason} [via provider=${llmInfo.provider}; model=${llmInfo.model}; path=${path}]`;

        // 3i. Fold change if not blocked
        if (status !== 'BLOCKED' && chosenCandidate.id !== 'escalate') {
          workingInput = applyChosenChange(
            this.engine,
            workingInput,
            chosenCandidate.change,
          );
        }

        // 3j. ActionRecord
        const matchingSimulation = simulations.find(
          (s) => s.change === chosenCandidate!.change,
        );

        actions.push({
          id: this.idGen.next('act'),
          invoiceId: invoice.id,
          type: actionType,
          params: actionParams,
          reason: fullReason,
          simulation: matchingSimulation,
          policy: verdict,
          status,
          createdAt: this.clock.now().toISOString(),
          decidedBy,
        });
      } catch (err) {
        skipped.push({
          invoiceId: invoice.id,
          why: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      runId,
      actions,
      skipped,
    };
  }

  async chat(
    _question: string,
    _snapshot: Snapshot,
  ): Promise<ChatAnswer> {
    return {
      text: 'Chat is not yet implemented in Stage 2',
      toolCalls: [],
    };
  }
}

export function createAgent(options: CreateAgentOptions): AgentPort {
  return new SettleAgent(options);
}
