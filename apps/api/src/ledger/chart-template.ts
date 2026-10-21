// Copyright (c) 2026, Rademics. All rights reserved.
// The standard India-retail chart of accounts (blueprint 11 "Chart of
// accounts"; decision 55: a proposal until the Chartered Accountant approves it).
// Every account the system posts to has a system key; the default account for
// each role in ACCOUNT_ROLES is the account with the same key.
import type { AccountFamilyCode, AccountKind } from 'shared';

export interface TemplateAccount {
  key: string;
  number: string;
  name: string;
  kind?: AccountKind;
  balanceMustBe?: 'debit' | 'credit';
  children?: TemplateAccount[];
}

export interface TemplateFamily {
  family: AccountFamilyCode;
  root: TemplateAccount;
}

export const CHART_TEMPLATE: TemplateFamily[] = [
  {
    family: 'asset',
    root: {
      key: 'assets',
      number: '1000',
      name: 'Assets',
      children: [
        {
          key: 'current_assets',
          number: '1100',
          name: 'Current assets',
          children: [
            { key: 'cash_group', number: '1110', name: 'Cash in hand', children: [] },
            { key: 'bank_group', number: '1120', name: 'Bank accounts', children: [] },
            { key: 'customer_receivable', number: '1130', name: 'Customer balances', kind: 'receivable' },
            { key: 'stock', number: '1140', name: 'Stock in hand', kind: 'stock' },
            { key: 'goods_in_transit', number: '1141', name: 'Goods in transit', kind: 'transit' },
            { key: 'stock_transfer_clearing', number: '1142', name: 'Stock transfer clearing', kind: 'other' },
            {
              key: 'settlement_group',
              number: '1150',
              name: 'Card and UPI settlement',
              children: [
                { key: 'card_settlement', number: '1151', name: 'Card settlement', kind: 'other' },
                { key: 'upi_settlement', number: '1152', name: 'UPI settlement', kind: 'other' },
                { key: 'other_receipts', number: '1153', name: 'Other till receipts', kind: 'other' },
              ],
            },
            {
              key: 'tax_receivable',
              number: '1160',
              name: 'Tax receivable',
              children: [
                { key: 'gst_input_cgst', number: '1161', name: 'Input CGST', kind: 'tax' },
                { key: 'gst_input_sgst', number: '1162', name: 'Input SGST', kind: 'tax' },
                { key: 'gst_input_igst', number: '1163', name: 'Input IGST', kind: 'tax' },
              ],
            },
            { key: 'advances_deposits', number: '1170', name: 'Advances and deposits', children: [] },
          ],
        },
        { key: 'fixed_assets', number: '1200', name: 'Fixed assets', children: [] },
        { key: 'investments', number: '1300', name: 'Investments', children: [] },
        { key: 'temporary_opening', number: '1900', name: 'Temporary opening', kind: 'temporary_opening' },
      ],
    },
  },
  {
    family: 'liability',
    root: {
      key: 'liabilities',
      number: '2000',
      name: 'Liabilities',
      children: [
        {
          key: 'current_liabilities',
          number: '2100',
          name: 'Current liabilities',
          children: [
            { key: 'supplier_payable', number: '2110', name: 'Supplier balances', kind: 'payable' },
            { key: 'goods_received_not_billed', number: '2120', name: 'Goods received not billed', kind: 'grni' },
            {
              key: 'duties_taxes',
              number: '2130',
              name: 'Duties and taxes',
              children: [
                { key: 'gst_output_cgst', number: '2131', name: 'Output CGST', kind: 'tax' },
                { key: 'gst_output_sgst', number: '2132', name: 'Output SGST', kind: 'tax' },
                { key: 'gst_output_igst', number: '2133', name: 'Output IGST', kind: 'tax' },
                // Plan 08 G8: tax the shop pays itself on purchases under reverse charge, one account per head.
                { key: 'gst_rcm_cgst', number: '2136', name: 'CGST payable under reverse charge', kind: 'tax' },
                { key: 'gst_rcm_sgst', number: '2137', name: 'SGST payable under reverse charge', kind: 'tax' },
                { key: 'gst_rcm_igst', number: '2138', name: 'IGST payable under reverse charge', kind: 'tax' },
              ],
            },
            { key: 'loans_overdraft', number: '2140', name: 'Loans and overdraft', children: [] },
            // Plan 11 part 2: sale-or-return goods in our stock, owed only once sold (no party: the statement settles it).
            { key: 'consignment_payable', number: '2150', name: 'Owed to suppliers on consignment', kind: 'other' },
            // Plan 13 (decisions 14, 15): unspent loyalty points and money on gift cards are owed to customers.
            { key: 'loyalty_liability', number: '2160', name: 'Loyalty points owed to customers', kind: 'other' },
            { key: 'gift_card_liability', number: '2170', name: 'Gift card balances owed', kind: 'other' },
          ],
        },
      ],
    },
  },
  {
    family: 'equity',
    root: {
      key: 'capital_reserves',
      number: '3000',
      name: 'Capital and reserves',
      children: [
        { key: 'capital', number: '3100', name: 'Capital account', kind: 'equity' },
        { key: 'retained_earnings', number: '3200', name: 'Retained earnings', kind: 'equity' },
        { key: 'drawings', number: '3300', name: 'Owner’s drawings', kind: 'equity' },
      ],
    },
  },
  {
    family: 'income',
    root: {
      key: 'income',
      number: '4000',
      name: 'Income',
      children: [
        { key: 'direct_income', number: '4100', name: 'Direct income', children: [{ key: 'sales', number: '4110', name: 'Sales', kind: 'income' }] },
        {
          key: 'indirect_income',
          number: '4200',
          name: 'Indirect income',
          children: [
            { key: 'other_income', number: '4210', name: 'Other income', kind: 'income' },
            { key: 'interest_received', number: '4220', name: 'Interest received', kind: 'income' },
          ],
        },
      ],
    },
  },
  {
    family: 'expense',
    root: {
      key: 'expenses',
      number: '5000',
      name: 'Expenses',
      children: [
        {
          key: 'direct_expenses',
          number: '5100',
          name: 'Direct expenses',
          children: [
            { key: 'cost_of_goods_sold', number: '5110', name: 'Cost of goods sold', kind: 'cogs' },
            { key: 'purchase_expense', number: '5120', name: 'Purchases of services and expenses', kind: 'expense' },
            { key: 'freight_inward', number: '5130', name: 'Freight inward', kind: 'expense' },
            { key: 'purchase_price_difference', number: '5140', name: 'Purchase price difference', kind: 'cogs' },
            { key: 'stock_adjustment', number: '5150', name: 'Stock adjustment', kind: 'expense' },
            { key: 'write_off', number: '5160', name: 'Stock written off', kind: 'expense' },
          ],
        },
        {
          key: 'indirect_expenses',
          number: '5200',
          name: 'Indirect expenses',
          children: [
            { key: 'rent', number: '5210', name: 'Rent', kind: 'expense' },
            { key: 'salaries', number: '5220', name: 'Salaries and wages', kind: 'expense' },
            { key: 'electricity', number: '5230', name: 'Electricity', kind: 'expense' },
            { key: 'marketing', number: '5240', name: 'Marketing', kind: 'expense' },
            { key: 'samples_expense', number: '5250', name: 'Free samples', kind: 'expense' },
            { key: 'shop_use_expense', number: '5260', name: 'Goods used in the shop', kind: 'expense' },
            { key: 'rounding', number: '5270', name: 'Rounding', kind: 'rounding' },
            { key: 'cash_short_over', number: '5280', name: 'Cash short or over', kind: 'expense' },
            { key: 'card_commission', number: '5290', name: 'Card and UPI commission', kind: 'expense' },
            { key: 'bank_charges', number: '5300', name: 'Bank charges', kind: 'expense' },
            { key: 'bad_debts', number: '5310', name: 'Small amounts written off', kind: 'expense' },
            // Plan 13 (decision 15): the cost of points given to customers.
            { key: 'loyalty_expense', number: '5320', name: 'Loyalty points expense', kind: 'expense' },
          ],
        },
      ],
    },
  },
];

/**
 * Per-store cash accounts, created under "Cash in hand" for every store.
 * "Must be debit" is left for the accountant to switch on once opening balances are in.
 */
export const STORE_ACCOUNTS: { role: 'cash_in_till' | 'cash_in_hand'; name: string }[] = [
  { role: 'cash_in_till', name: 'Cash in till' },
  { role: 'cash_in_hand', name: 'Cash in hand' },
];
