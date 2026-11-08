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
import { runChat } from './chat/chat.js';
import { SystemClock, type Clock } from './clock.js';
import { draftNote } from './draftNote.js';
import { deterministicChoice, templatedReason } from './fallback.js';
import { applyChosenChange } from './foldChange.js';
import { formatUsd } from './format.js';
import {
  buildAllowedSet,
  checkGrounding,
  type GroundingFactsInput,
} from './grounding.js';
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

export interface AgentRunMetrics {
  decisions: number;
  llmValid: number;
  retries: number;
  fallbacks: number;
  groundingFailures: number;
}

export class SettleAgent implements AgentPort {
  private readonly engine: EnginePort;
  private readonly llm: ExtendedLlmPort;
  private readonly clock: Clock;
  private readonly idGen: IdGen;
  private readonly remindersLookup: (invoiceId: Id) => number;
  private readonly defaultPolicy?: Policy;
  private lastRunMetrics: AgentRunMetrics = {
    decisions: 0,
    llmValid: 0,
    retries: 0,
    fallbacks: 0,
    groundingFailures: 0,
  };

  constructor(options: CreateAgentOptions) {
    this.engine = options.engine;
    this.llm = options.llm as ExtendedLlmPort;
    this.clock = options.clock ?? new SystemClock();
    this.idGen = options.idGen ?? new DeterministicIdGen();
    this.remindersLookup = options.remindersLookup ?? (() => 0);
    this.defaultPolicy = options.policy;
  }

  getLastRunMetrics(): AgentRunMetrics {
    return { ...this.lastRunMetrics };
  }

  async runCycle(snapshot: Snapshot): Promise<AgentRunResult> {
    const runId = this.idGen.next('run');
    const policy = this.defaultPolicy ?? snapshot.policy;
    const actions: ActionRecord[] = [];
    const skipped: { invoiceId: Id; why: string }[] = [];

    this.lastRunMetrics = {
      decisions: 0,
      llmValid: 0,
      retries: 0,
      fallbacks: 0,
      groundingFailures: 0,
    };

    // 1. Select overdue invoices
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
        this.lastRunMetrics.decisions += 1;
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
          // ESCALATE with templated reason from snapshot data. No LLM call -> path=rules.
          const escalateReason = `Payer persona ${payer.persona} is unresponsive. Escalating invoice ${invoice.number} (${formatUsd(remaining)} due ${invoice.dueDate}) for manual collection.`;
          const actionType: ActionType = 'ESCALATE';
          const actionParams: ActionParams = {};

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

          fullReason = `${fullReason} [via rules; path=rules]`;

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

        // 3d. LLM decision with retry ONCE + grounding check, then deterministic fallback
        let chosenCandidate: Candidate | null = null;
        let modelReason = '';
        let path: 'llm' | 'fallback' = 'llm';
        let groundingFailed = false;

        const system = buildSystemPrompt();
        const user = buildUserPrompt({
          invoice,
          payer,
          candidates,
        });

        try {
          // Attempt 1
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
              const candFacts: GroundingFactsInput = {
                invoice,
                payer,
                change: found.change,
                cashCost: found.cashCost,
                lowestDelta: found.lowestDelta,
                shortfallDelta: found.shortfallDelta,
                asOf: snapshot.business.asOf,
              };
              const candAllowed = buildAllowedSet(candFacts);
              const groundCheck = checkGrounding(parsed.data.reason, candAllowed);

              if (groundCheck.ok) {
                chosenCandidate = found;
                modelReason = parsed.data.reason;
                this.lastRunMetrics.llmValid += 1;
              } else {
                groundingFailed = true;
                this.lastRunMetrics.groundingFailures += 1;
                this.lastRunMetrics.retries += 1;

                // Retry ONCE with feedback on ungrounded offenders
                const retryPrompt = `${user}\n\nPREVIOUS REASON FAILED GROUNDING: Contains ungrounded tokens: ${groundCheck.offenders.join(', ')}.\nPlease remove these ungrounded values and quote only verified facts.`;
                const retryRaw = await this.llm.generateStructured<{
                  optionId: string;
                  reason: string;
                }>({
                  system,
                  user: retryPrompt,
                  jsonSchema,
                });

                const retryParsed = validator.safeParse(retryRaw);
                if (retryParsed.success) {
                  const retryFound = candidates.find(
                    (c) => c.id === retryParsed.data.optionId,
                  );
                  if (retryFound) {
                    const retryAllowed = buildAllowedSet({
                      invoice,
                      payer,
                      change: retryFound.change,
                      cashCost: retryFound.cashCost,
                      lowestDelta: retryFound.lowestDelta,
                      shortfallDelta: retryFound.shortfallDelta,
                      asOf: snapshot.business.asOf,
                    });
                    const retryGround = checkGrounding(
                      retryParsed.data.reason,
                      retryAllowed,
                    );
                    if (retryGround.ok) {
                      chosenCandidate = retryFound;
                      modelReason = retryParsed.data.reason;
                      this.lastRunMetrics.llmValid += 1;
                    } else {
                      this.lastRunMetrics.groundingFailures += 1;
                      // Keep model's chosen option if valid, but fall back to templated reason
                      path = 'fallback';
                      this.lastRunMetrics.fallbacks += 1;
                      chosenCandidate = retryFound;
                      modelReason = templatedReason(retryFound, invoice);
                    }
                  }
                }
              }
            }
          }

          // Retry ONCE if invalid schema or optionId
          if (!chosenCandidate && !groundingFailed) {
            this.lastRunMetrics.retries += 1;
            const retryPrompt = `${user}\n\nPREVIOUS ATTEMPT WAS INVALID. Please choose one valid optionId and reason.`;
            const retryRaw = await this.llm.generateStructured<{
              optionId: string;
              reason: string;
            }>({
              system,
              user: retryPrompt,
              jsonSchema,
            });

            const retryParsed = validator.safeParse(retryRaw);
            if (retryParsed.success) {
              const found = candidates.find(
                (c) => c.id === retryParsed.data.optionId,
              );
              if (found) {
                const candAllowed = buildAllowedSet({
                  invoice,
                  payer,
                  change: found.change,
                  cashCost: found.cashCost,
                  lowestDelta: found.lowestDelta,
                  shortfallDelta: found.shortfallDelta,
                  asOf: snapshot.business.asOf,
                });
                const groundCheck = checkGrounding(retryParsed.data.reason, candAllowed);
                if (groundCheck.ok) {
                  chosenCandidate = found;
                  modelReason = retryParsed.data.reason;
                  this.lastRunMetrics.llmValid += 1;
                } else {
                  this.lastRunMetrics.groundingFailures += 1;
                  path = 'fallback';
                  this.lastRunMetrics.fallbacks += 1;
                  chosenCandidate = found;
                  modelReason = templatedReason(found, invoice);
                }
              }
            }
          }
        } catch {
          // LLM call threw error; proceed to fallback
        }

        // Complete fallback if LLM produced no valid candidate
        if (!chosenCandidate) {
          path = 'fallback';
          this.lastRunMetrics.fallbacks += 1;
          chosenCandidate = deterministicChoice(candidates);
          modelReason = templatedReason(chosenCandidate, invoice);
        }

        // 3e. Map chosen change to ActionType and preliminary ActionParams
        let actionType: ActionType;
        let actionParams: ActionParams = {};

        if (chosenCandidate.id === 'escalate') {
          actionType = 'ESCALATE';
          actionParams = {};
        } else {
          switch (chosenCandidate.change.type) {
            case 'REMIND':
              actionType = 'REMIND';
              actionParams = {};
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

        // Pre-evaluate policy to check if blocked
        const prelimVerdict = evaluatePolicy(
          { type: actionType, params: actionParams },
          invoice,
          policy,
          {
            now: this.clock.now(),
            remindersLastWeek: this.remindersLookup(invoice.id),
          },
        );

        // Generate draft note for non-BLOCKED REMIND, OFFER_DISCOUNT, and OFFER_INSTALMENTS
        if (
          prelimVerdict.allowed &&
          (actionType === 'REMIND' ||
            actionType === 'OFFER_DISCOUNT' ||
            actionType === 'OFFER_INSTALMENTS')
        ) {
          const candFacts: GroundingFactsInput = {
            invoice,
            payer,
            change: chosenCandidate.change,
            cashCost: chosenCandidate.cashCost,
            lowestDelta: chosenCandidate.lowestDelta,
            shortfallDelta: chosenCandidate.shortfallDelta,
            asOf: snapshot.business.asOf,
          };

          const note = await draftNote(
            {
              action: { type: actionType, params: actionParams },
              invoice,
              payer,
              facts: candFacts,
            },
            this.llm,
          );
          actionParams.note = note;
        }

        // 3f. Final policy evaluation (sees final note)
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
          delete actionParams.note;
          status = 'BLOCKED';
          fullReason = `${modelReason}. Policy violations: ${verdict.violations.join('; ')}`;
        } else if (verdict.requiresApproval) {
          status = 'AWAITING_APPROVAL';
        } else {
          status = 'APPROVED';
          decidedBy = 'auto';
        }

        // 3h. Append provenance suffix
        if (path === 'llm') {
          const llmInfo = this.llm.info ?? {
            provider: 'mock',
            model: 'mock-model',
          };
          fullReason = `${fullReason} [via provider=${llmInfo.provider}; model=${llmInfo.model}; path=llm]`;
        } else {
          const llmInfo = this.llm.info ?? {
            provider: 'mock',
            model: 'mock-model',
          };
          fullReason = `${fullReason} [via provider=${llmInfo.provider}; model=${llmInfo.model}; path=fallback]`;
        }

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
    question: string,
    snapshot: Snapshot,
  ): Promise<ChatAnswer> {
    return runChat(question, snapshot, this.engine, this.llm);
  }
}

export function createAgent(options: CreateAgentOptions): SettleAgent {
  return new SettleAgent(options);
}
