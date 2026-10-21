// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { readCsv, readSpreadsheet, readXlsx, writeCsv, writeXlsx, writeXlsxBook } from './spreadsheet.js';

describe('our own .xlsx reader and writer (plan 10 answer 1)', () => {
  it('writes a file that reads back the same, keeping text columns as text', () => {
    const rows = [
      ['Item code', 'Name', 'Barcode', 'HSN', 'Price', 'Active'],
      ['ITM-1', 'Ponni Rice & Dal <1 kg>', '0012345678905', '0902', 105.5, true],
      ['ITM-2', 'Ghee "pure"', null, '1006', 1200, false],
    ];
    const buf = writeXlsx('Items', rows, { textColumns: [0, 2, 3] });
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(readXlsx(buf)).toEqual([
      ['Item code', 'Name', 'Barcode', 'HSN', 'Price', 'Active'],
      ['ITM-1', 'Ponni Rice & Dal <1 kg>', '0012345678905', '0902', 105.5, true],
      ['ITM-2', 'Ghee "pure"', null, '1006', 1200, false],
    ]);
  });
  it('reads by file name and refuses old .xls files with a plain message', () => {
    expect(readSpreadsheet('items.csv', Buffer.from('a,b\n1,2\n'))).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => readSpreadsheet('items.xls', Buffer.from(''))).toThrow(/Save As/);
    expect(() => readSpreadsheet('items.xlsx', Buffer.from('not a zip at all, just text'))).toThrow(/not an Excel/);
  });
});

describe('CSV', () => {
  it('finds the separator and handles quotes', () => {
    expect(readCsv('Name;Price\r\n"Rice, Ponni";"1,05,000.50"\r\n')).toEqual([['Name', 'Price'], ['Rice, Ponni', '1,05,000.50']]);
    expect(readCsv('a\tb\nx\t"he said ""hi"""\n')).toEqual([['a', 'b'], ['x', 'he said "hi"']]);
  });
  it('writes with a byte-order mark so Excel reads Indian text correctly', () => {
    expect(writeCsv([['Name', 'Note'], ['Rice', 'a, b']])).toBe('﻿Name,Note\r\nRice,"a, b"\r\n');
  });
});

describe('files saved by Excel itself', () => {
  it('reads shared strings, rich text, formulas, numbers, booleans and a sheet that is not sheet1', async () => {
    const { writeZip } = await import('./spreadsheet.js');
    const x = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`);
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const file = writeZip([
      { name: 'xl/workbook.xml', data: x(`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Items" sheetId="3" r:id="rId7"/></sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: x(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${rel}/worksheet" Target="worksheets/sheet3.xml"/></Relationships>`) },
      {
        name: 'xl/sharedStrings.xml',
        data: x(`<sst xmlns="${main}" count="4" uniqueCount="4"><si><t>Item name</t></si><si><t>Barcode</t></si><si><r><rPr><b/></rPr><t xml:space="preserve">Ponni </t></r><r><t>Rice &amp; Dal</t></r></si><si><t>0012345678905</t></si></sst>`),
      },
      {
        name: 'xl/worksheets/sheet3.xml',
        data: x(
          `<worksheet xmlns="${main}"><sheetData><row r="1" spans="1:4"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Price</t></is></c><c r="D1" t="str"><f>"Total"</f><v>Total</v></c></row><row r="3" spans="1:4"><c r="A3" t="s"><v>2</v></c><c r="B3" s="4" t="s"><v>3</v></c><c r="C3" s="2"><v>1.0500000000000001E2</v></c><c r="E3" t="b"><v>1</v></c></row></sheetData></worksheet>`,
        ),
      },
    ]);
    expect(readXlsx(file)).toEqual([
      ['Item name', 'Barcode', 'Price', 'Total'],
      [],
      ['Ponni Rice & Dal', '0012345678905', 105.00000000000001, null, true],
    ]);
  });

  it('writes a workbook with several sheets, each read back by its name (module 8 GSTR-1)', () => {
    const buf = writeXlsxBook([
      { name: 'b2b', rows: [['Invoice', 'Taxable'], ['B/1', 1000]] },
      { name: 'hsn(b2c)', rows: [['HSN', 'Quantity'], ['6205', 2]], textColumns: [0] },
    ]);
    expect(readXlsx(buf)).toEqual([['Invoice', 'Taxable'], ['B/1', 1000]]);
    expect(readXlsx(buf, 'hsn(b2c)')).toEqual([['HSN', 'Quantity'], ['6205', 2]]);
    expect(() => readXlsx(buf, 'docs')).toThrow('no sheet docs');
  });
});
