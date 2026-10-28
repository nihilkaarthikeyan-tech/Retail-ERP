// Copyright (c) 2026, Rademics. All rights reserved.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanHsnCode, cleanHsnDescription, HSN_FILE, readOfficialHsnFile } from './official-hsn.js';

describe('the official HSN list', () => {
  it('puts back leading zeros Excel dropped and takes out stray spaces', () => {
    expect(cleanHsnCode('30559')).toBe('030559');
    expect(cleanHsnCode('3074330')).toBe('03074330');
    expect(cleanHsnCode('2307 00')).toBe('230700');
    expect(cleanHsnCode(995411)).toBe('995411');
    expect(cleanHsnCode('6106')).toBe('6106');
    expect(cleanHsnCode('abc')).toBeNull();
    expect(cleanHsnCode('123456789')).toBeNull();
  });

  it('cleans descriptions of Excel line-break marks', () => {
    expect(cleanHsnDescription('DAIRY PRODUCE _x000D_\r\nOF ANIMAL ORIGIN~_x000D_\r\nMilk and cream')).toBe('DAIRY PRODUCE OF ANIMAL ORIGIN — Milk and cream');
  });

  it('reads the file from the GST portal: goods and services, no bad codes, the shop-type examples there', () => {
    const rows = readOfficialHsnFile(readFileSync(join(__dirname, '..', '..', 'data', 'gst', HSN_FILE)));
    const goods = rows.filter((r) => !r.isService);
    const services = rows.filter((r) => r.isService);
    expect(goods.length).toBeGreaterThan(21_000);
    expect(services.length).toBeGreaterThan(600);
    expect(rows.every((r) => /^(\d{2}|\d{4}|\d{6}|\d{8})$/.test(r.code))).toBe(true);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    expect(rows.some((r) => r.description.includes('_x000D_'))).toBe(false);
    const find = (code: string) => rows.find((r) => r.code === code)?.description ?? '';
    expect(find('6106')).toMatch(/BLOUSES/);
    expect(find('5208')).toMatch(/WOVEN FABRICS OF COTTON/);
    expect(find('3304')).toMatch(/BEAUTY OR MAKE-UP/);
    expect(find('995411')).toMatch(/Construction/);
  });
});
