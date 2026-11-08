import type {
  EnginePort,
  ExpectedReceipt,
  ForecastInput,
  ForecastResult,
  Invoice,
  ISODate,
  Kpis,
  Payer,
  Policy,
  ScenarioChange,
  ScenarioComparison,
  Snapshot,
} from '@settle/shared';
import { expectedReceipts } from './expectedReceipts.js';
import { forecast } from './forecast.js';
import { kpis } from './kpis.js';
import { generateOptions } from './options.js';
import { simulate } from './simulate.js';

class Engine implements EnginePort {
  expectedReceipts(invoices: Invoice[], payers: Payer[], asOf: ISODate): ExpectedReceipt[] {
    return expectedReceipts(invoices, payers, asOf);
  }

  forecast(input: ForecastInput): ForecastResult {
    return forecast(input);
  }

  simulate(input: ForecastInput, change: ScenarioChange): ScenarioComparison {
    return simulate(input, change);
  }

  generateOptions(
    input: ForecastInput,
    invoice: Invoice,
    payer: Payer,
    policy: Policy,
  ): ScenarioChange[] {
    return generateOptions(input, invoice, payer, policy);
  }

  kpis(snapshot: Snapshot): Kpis {
    return kpis(snapshot);
  }
}

export function createEngine(): EnginePort {
  return new Engine();
}

export type * from '@settle/shared';
export type { EngineError, EngineErrorCode } from './errors.js';
