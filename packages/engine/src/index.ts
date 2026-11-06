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
import { EngineError } from './errors.js';
import { forecast } from './forecast.js';

class Engine implements EnginePort {
  expectedReceipts(_invoices: Invoice[], _payers: Payer[], _asOf: ISODate): ExpectedReceipt[] {
    throw new EngineError('NOT_IMPLEMENTED', 'expectedReceipts is not implemented yet');
  }

  forecast(input: ForecastInput): ForecastResult {
    return forecast(input);
  }

  simulate(_input: ForecastInput, _change: ScenarioChange): ScenarioComparison {
    throw new EngineError('NOT_IMPLEMENTED', 'simulate is not implemented yet');
  }

  generateOptions(
    _input: ForecastInput,
    _invoice: Invoice,
    _payer: Payer,
    _policy: Policy,
  ): ScenarioChange[] {
    throw new EngineError('NOT_IMPLEMENTED', 'generateOptions is not implemented yet');
  }

  kpis(_snapshot: Snapshot): Kpis {
    throw new EngineError('NOT_IMPLEMENTED', 'kpis is not implemented yet');
  }
}

export function createEngine(): EnginePort {
  return new Engine();
}

export type * from '@settle/shared';
export type { EngineError, EngineErrorCode } from './errors.js';

