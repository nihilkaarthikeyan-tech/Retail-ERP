// Copyright (c) 2026, Rademics. All rights reserved.
import { Decimal } from 'shared';
import { envelope, nettedLines, voucherXml, xmlText } from './tally-export.service.js';

const D = (v: string) => new Decimal(v);

describe('Tally export helpers', () => {
  it('escapes XML and writes anything outside plain ASCII as a character reference', () => {
    expect(xmlText(`Murugan & Sons <"Toys"> 'A'`)).toBe('Murugan &amp; Sons &lt;&quot;Toys&quot;&gt; &apos;A&apos;');
    expect(xmlText('Cash in hand — MAIN ₹')).toBe('Cash in hand &#8212; MAIN &#8377;');
    expect(xmlText('a\u0001b')).toBe('a b');
  });

  it('nets lines per ledger in first-seen order and drops ledgers that net to zero', () => {
    const lines = nettedLines(
      [
        { ledger: 'Cash', debit: D('100'), credit: D('0') },
        { ledger: 'Sales', debit: D('0'), credit: D('90') },
        { ledger: 'Cash', debit: D('0'), credit: D('10') },
        { ledger: 'Output GST', debit: D('0'), credit: D('0') },
      ],
      'Voucher X',
    );
    expect(lines.map((l) => [l.ledger, l.amount.toFixed(2)])).toEqual([
      ['Cash', '90.00'],
      ['Sales', '-90.00'],
    ]);
  });

  it('refuses a voucher whose debits and credits differ, with a plain message', () => {
    expect(() => nettedLines([{ ledger: 'Cash', debit: D('100'), credit: D('0') }, { ledger: 'Sales', debit: D('0'), credit: D('99.99') }], 'Voucher JV-1 of 2026-10-16')).toThrow(
      'Voucher JV-1 of 2026-10-16 does not balance (debits and credits differ by ₹0.01)',
    );
  });

  it('writes debits as negative amounts with ISDEEMEDPOSITIVE Yes and credits as positive with No', () => {
    const xml = voucherXml({ id: 'e1', type: 'Payment', date: '2026-10-16', number: 'PAY-2026-27-00001', narration: 'Rent & power', lines: [{ ledger: 'Rent', amount: D('500') }, { ledger: 'HDFC', amount: D('-500') }] });
    expect(xml).toContain('<DATE>20261016</DATE>');
    expect(xml).toContain('<VOUCHERNUMBER>PAY-2026-27-00001</VOUCHERNUMBER>');
    expect(xml).toContain('<NARRATION>Rent &amp; power</NARRATION>');
    expect(xml).toMatch(/<LEDGERNAME>Rent<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-500.00<\/AMOUNT>/);
    expect(xml).toMatch(/<LEDGERNAME>HDFC<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>500.00<\/AMOUNT>/);
    const file = envelope('Vouchers', 'Rademics Retail', [xml]);
    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(file).toContain('<SVCURRENTCOMPANY>Rademics Retail</SVCURRENTCOMPANY>');
    expect(envelope('Vouchers', 'Rademics Retail', [xml])).toBe(file);
  });
});
