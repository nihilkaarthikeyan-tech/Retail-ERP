// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG, parseConfig } from './config.js';

describe('settings', () => {
  it('fills in defaults', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.port).toBe(47120);
  });

  it('accepts each printer kind', () => {
    expect(parseConfig({ printer: { kind: 'network', host: '192.168.1.50' } }).printer).toEqual({
      kind: 'network',
      host: '192.168.1.50',
      port: 9100,
    });
    expect(parseConfig({ printer: { kind: 'windows', share: 'RECEIPT' } }).printer).toEqual({ kind: 'windows', share: 'RECEIPT' });
    expect(parseConfig({ printer: { kind: 'serial', port: 'com3' } }).printer).toEqual({ kind: 'serial', port: 'COM3', baudRate: 9600 });
  });

  it('normalises the allowed ERP addresses', () => {
    expect(parseConfig({ allowedOrigins: ['https://erp.example.in/'] }).allowedOrigins).toEqual(['https://erp.example.in']);
  });

  it.each([
    [{ port: 80 }],
    [{ paperWidth: 72 }],
    [{ allowedOrigins: [] }],
    [{ allowedOrigins: ['*'] }],
    [{ allowedOrigins: ['https://erp.example.in/pos'] }],
    [{ printer: { kind: 'windows', share: 'RECEIPT" & del *' } }],
    [{ printer: { kind: 'serial', port: 'COM3 & calc' } }],
    [{ printer: { kind: 'laser' } }],
    [{ drawer: { pin: 3 } }],
  ])('refuses bad settings %j', (input) => {
    expect(() => parseConfig(input)).toThrow(ConfigError);
  });
});
