import type { ForecastInput } from '@settle/shared';
import { expectedReceipts } from '../src/expectedReceipts.js';
import { forecast } from '../src/forecast.js';
import { generateOptions } from '../src/options.js';
import { simulate } from '../src/simulate.js';
import { seedSnapshot } from './seedScenario.js';

export function getSeedForecastInput(): ForecastInput {
  const receipts = expectedReceipts(
    seedSnapshot.invoices,
    seedSnapshot.payers,
    seedSnapshot.business.asOf,
  );
  return {
    business: seedSnapshot.business,
    obligations: seedSnapshot.obligations,
    receipts,
    horizonDays: 30,
    includeUncertain: false,
  };
}

export function generateAllFixtures(): Record<string, string> {
  const seedInput = getSeedForecastInput();
  const baselineForecast = forecast(seedInput);

  // Three largest overdue invoices: inv_001, inv_002, inv_003
  const inv1 = seedSnapshot.invoices.find((i) => i.id === 'inv_001')!;
  const payer1 = seedSnapshot.payers.find((p) => p.id === inv1.payerId)!;
  const options1 = generateOptions(seedInput, inv1, payer1, seedSnapshot.policy);
  const option1 = options1.find((o) => o.type === 'REMIND')!;
  const simOption1 = simulate(seedInput, option1);

  const inv2 = seedSnapshot.invoices.find((i) => i.id === 'inv_002')!;
  const payer2 = seedSnapshot.payers.find((p) => p.id === inv2.payerId)!;
  const options2 = generateOptions(seedInput, inv2, payer2, seedSnapshot.policy);
  const option2 = options2.find((o) => o.type === 'OFFER_DISCOUNT' && o.discountPct === 3)!;
  const simOption2 = simulate(seedInput, option2);

  const inv3 = seedSnapshot.invoices.find((i) => i.id === 'inv_003')!;
  const payer3 = seedSnapshot.payers.find((p) => p.id === inv3.payerId)!;
  const options3 = generateOptions(seedInput, inv3, payer3, seedSnapshot.policy);
  const option3 = options3.find((o) => o.type === 'OFFER_INSTALMENTS' && o.count === 2)!;
  const simOption3 = simulate(seedInput, option3);

  return {
    'seed-snapshot.json': JSON.stringify(seedSnapshot, null, 2) + '\n',
    'seed-input.json': JSON.stringify(seedInput, null, 2) + '\n',
    'forecast.baseline.json': JSON.stringify(baselineForecast, null, 2) + '\n',
    'simulate.option-1.json': JSON.stringify(simOption1, null, 2) + '\n',
    'simulate.option-2.json': JSON.stringify(simOption2, null, 2) + '\n',
    'simulate.option-3.json': JSON.stringify(simOption3, null, 2) + '\n',
  };
}

