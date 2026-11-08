import { z } from 'zod';
import type {
  EnginePort,
  ForecastInput,
  ForecastResult,
  ISODate,
  Invoice,
  Payer,
  ScenarioChange,
  ScenarioComparison,
  Snapshot,
} from '@settle/shared';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date YYYY-MM-DD');

const centsSchema = z.number().int('Amount in cents must be an integer');

export const scenarioChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REMIND'),
    invoiceId: z.string(),
    newExpectedDate: isoDateSchema,
  }),
  z.object({
    type: z.literal('OFFER_DISCOUNT'),
    invoiceId: z.string(),
    discountPct: z.number().positive(),
    newExpectedDate: isoDateSchema,
  }),
  z.object({
    type: z.literal('OFFER_INSTALMENTS'),
    invoiceId: z.string(),
    count: z.number().int().min(2),
    spacingDays: z.number().int().min(1),
    firstDate: isoDateSchema,
  }),
  z.object({
    type: z.literal('PURCHASE'),
    label: z.string(),
    amount: centsSchema,
    date: isoDateSchema,
  }),
]);

export interface ChatToolDef {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  run(args: unknown): Promise<unknown>;
}

export class ChatToolContext {
  public lastForecast?: ForecastResult;
  public lastComparison?: ScenarioComparison;
  public executedToolCalls: Array<{
    name: string;
    args: unknown;
    result: unknown;
  }> = [];

  constructor(
    private readonly snapshot: Snapshot,
    private readonly engine: EnginePort,
  ) {}

  public getWorkingInput(): ForecastInput {
    const receipts = this.engine.expectedReceipts(
      this.snapshot.invoices,
      this.snapshot.payers,
      this.snapshot.business.asOf,
    );

    return {
      business: this.snapshot.business,
      obligations: this.snapshot.obligations,
      receipts,
      horizonDays: 30,
    };
  }

  public createTools(): ChatToolDef[] {
    const workingInput = this.getWorkingInput();
    const payerMap = new Map<string, Payer>(
      this.snapshot.payers.map((p) => [p.id, p]),
    );
    const invoiceMap = new Map<string, Invoice>(
      this.snapshot.invoices.map((i) => [i.id, i]),
    );

    const getForecastTool: ChatToolDef = {
      name: 'get_forecast',
      description:
        'Get 30-day cash flow forecast based on expected receipts and obligations.',
      jsonSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      run: async () => {
        const result = this.engine.forecast(workingInput);
        this.lastForecast = result;
        return result;
      },
    };

    const simulateScenarioTool: ChatToolDef = {
      name: 'simulate_scenario',
      description:
        'Simulate the impact of a scenario change on cash flow forecast.',
      jsonSchema: {
        type: 'object',
        properties: {
          change: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['REMIND', 'OFFER_DISCOUNT', 'OFFER_INSTALMENTS', 'PURCHASE'],
              },
              invoiceId: { type: 'string' },
              label: { type: 'string' },
              amount: { type: 'integer' },
              discountPct: { type: 'number' },
              count: { type: 'integer' },
              spacingDays: { type: 'integer' },
              newExpectedDate: { type: 'string' },
              firstDate: { type: 'string' },
              date: { type: 'string' },
            },
            required: ['type'],
          },
        },
        required: ['change'],
        additionalProperties: false,
      },
      run: async (rawArgs: unknown) => {
        const parsed = z
          .object({
            change: scenarioChangeSchema,
          })
          .safeParse(rawArgs);

        if (!parsed.success) {
          return {
            error: `Invalid scenario arguments: ${parsed.error.message}`,
          };
        }

        const sim = this.engine.simulate(workingInput, parsed.data.change);
        this.lastComparison = sim;
        this.lastForecast = sim.scenario;
        return sim;
      },
    };

    const listOverdueInvoicesTool: ChatToolDef = {
      name: 'list_overdue_invoices',
      description:
        'List overdue invoices with payer names and remaining amounts.',
      jsonSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      run: async () => {
        const asOf = this.snapshot.business.asOf;
        const overdue = this.snapshot.invoices
          .filter((inv) => {
            const remaining = inv.amount - inv.amountPaid;
            return (
              remaining > 0 &&
              inv.dueDate < asOf &&
              inv.status !== 'PAID' &&
              inv.status !== 'CANCELLED'
            );
          })
          .map((inv) => {
            const payer = payerMap.get(inv.payerId);
            return {
              id: inv.id,
              number: inv.number,
              payerName: payer ? payer.name : 'Unknown Payer',
              remainingAmount: inv.amount - inv.amountPaid,
              dueDate: inv.dueDate,
            };
          });

        return { invoices: overdue };
      },
    };

    const compareOptionsTool: ChatToolDef = {
      name: 'compare_options',
      description:
        'Generate and simulate options for collecting a specific invoice.',
      jsonSchema: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string' },
        },
        required: ['invoiceId'],
        additionalProperties: false,
      },
      run: async (rawArgs: unknown) => {
        const parsed = z
          .object({
            invoiceId: z.string(),
          })
          .safeParse(rawArgs);

        if (!parsed.success) {
          return { error: `Invalid arguments: ${parsed.error.message}` };
        }

        const invoice = invoiceMap.get(parsed.data.invoiceId);
        if (!invoice) {
          return { error: `Invoice not found: ${parsed.data.invoiceId}` };
        }

        const payer = payerMap.get(invoice.payerId);
        if (!payer) {
          return { error: `Payer not found for invoice: ${parsed.data.invoiceId}` };
        }

        const options = this.engine.generateOptions(
          workingInput,
          invoice,
          payer,
          this.snapshot.policy,
        );

        const candidates = options.map((change) => {
          const sim = this.engine.simulate(workingInput, change);
          this.lastComparison = sim;
          return {
            change,
            simulation: sim,
          };
        });

        return {
          invoiceId: invoice.id,
          number: invoice.number,
          candidates,
        };
      },
    };

    // Wrap each tool to log executed calls into context
    return [
      getForecastTool,
      simulateScenarioTool,
      listOverdueInvoicesTool,
      compareOptionsTool,
    ].map((tool) => ({
      ...tool,
      run: async (args: unknown) => {
        const result = await tool.run(args);
        this.executedToolCalls.push({
          name: tool.name,
          args,
          result,
        });
        return result;
      },
    }));
  }
}

