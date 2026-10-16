// Copyright (c) 2026, Rademics. All rights reserved.
// Sample receipt for tests: acceptance scenario 6.1 (a cash sale of two items).
import type { Receipt } from '../receipt.js';

export function sampleSale(): Receipt {
  return {
    number: 'S1-T1-000123',
    kind: 'sale',
    duplicate: false,
    provisional: false,
    // 10:30 in India on 15 October 2026.
    soldAt: '2026-10-15T05:00:00.000Z',
    till: 'T1',
    footer: 'Thank you! Visit again.',
    lines: [
      { name: 'Basmati Rice 1 kg', code: 'RICE-BAS-1KG', hsn: '1006', quantity: '2', price: '120.00', discount: '0.00', amount: '240.00', free: false, serials: [] },
      { name: 'Surf Excel 1 kg', code: 'SURF-1KG', hsn: '3402', quantity: '1', price: '132.00', discount: '0.00', amount: '132.00', free: false, serials: [] },
    ],
    gstTable: [
      { rate: '5', taxable: '228.57', cgst: '5.72', sgst: '5.71', igst: '0.00' },
      { rate: '18', taxable: '111.86', cgst: '10.07', sgst: '10.07', igst: '0.00' },
    ],
    totals: { gross: '372.00', discount: '0.00', taxable: '340.43', rounding: '0.00', total: '372.00' },
    payments: [{ method: 'Cash', amount: '500.00', reference: null }],
    change: '128.00',
    store: { name: 'Bazaar Anna Nagar', address: '12, 2nd Avenue, Anna Nagar, Chennai 600040', phone: '044 2626 1234' },
    company: { legalName: 'Rademics Retail Private Limited', gstin: '33AABCR1234F1Z5' },
  };
}
