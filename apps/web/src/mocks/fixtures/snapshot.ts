import type { Snapshot } from '@settle/shared';
import { mockBusiness } from './business';
import { mockPayers } from './payers';
import { mockInvoices } from './invoices';
import { mockObligations } from './obligations';
import { mockPolicy } from './policy';

export const baselineSnapshot: Snapshot = {
  business: mockBusiness,
  payers: mockPayers,
  invoices: mockInvoices,
  obligations: mockObligations,
  policy: mockPolicy,
};

