// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §5: the settings centre. One list of every setting that exists,
// grouped by area of the shop, each with a plain label, one line saying what it
// changes and its default. The values are read and saved through each module's
// own settings API, so the rules stay in one place; the centre only shows them
// together. docs/settings-inventory.md describes the same list for the owner.
import type { PermissionKey } from './permissions.js';
import type { ModuleKey } from './modules.js';

/** Who may read or change a group of settings: the Owner/Admin, or anyone with one of these rights. */
export interface SettingsRight {
  ownerOnly?: boolean;
  any?: PermissionKey[];
}

/** One settings API. `put` APIs take the whole object, so the centre sends the other values unchanged. */
export interface SettingsSource {
  get: string;
  save: { path: string; method: 'PATCH' | 'PUT'; fields?: readonly string[] } | null;
  read: SettingsRight;
  change: SettingsRight;
}

export type SettingsSourceKey = 'catalogue' | 'parties' | 'stock' | 'purchase' | 'pos' | 'gst' | 'accounting' | 'summaryEmail' | 'print' | 'security' | 'loyalty' | 'giftCards';

export const SETTINGS_SOURCES: Record<SettingsSourceKey, SettingsSource> = {
  catalogue: { get: '/catalogue/settings', save: { path: '/catalogue/settings', method: 'PATCH' }, read: { any: ['catalogue.view'] }, change: { ownerOnly: true } },
  parties: { get: '/party-settings', save: { path: '/party-settings', method: 'PATCH' }, read: { any: ['customers.view', 'suppliers.view'] }, change: { ownerOnly: true } },
  stock: { get: '/stock/settings', save: { path: '/stock/settings', method: 'PATCH' }, read: { any: ['stock.view'] }, change: { any: ['stock.lock'] } },
  purchase: { get: '/purchase/settings', save: { path: '/purchase/settings', method: 'PATCH' }, read: { any: ['purchase.view'] }, change: { any: ['purchase.settings'] } },
  pos: { get: '/pos/settings', save: { path: '/pos/settings', method: 'PATCH' }, read: { any: ['pos.setup', 'pos.sell', 'pos.reports'] }, change: { any: ['pos.setup'] } },
  gst: { get: '/gst/settings', save: { path: '/gst/settings', method: 'PATCH' }, read: { any: ['gst_rates.manage', 'gst_rates.approve', 'pos.setup'] }, change: { any: ['gst_rates.manage'] } },
  accounting: { get: '/accounting/settings', save: null, read: { any: ['accounts.view', 'journals.post', 'payments.post', 'cash.deposit'] }, change: { ownerOnly: true } },
  summaryEmail: { get: '/summary-email/settings', save: { path: '/summary-email/settings', method: 'PUT', fields: ['enabled', 'sendAt', 'recipientIds', 'figures'] }, read: { any: ['reports.summary_email'] }, change: { any: ['reports.summary_email'] } },
  print: { get: '/print/settings', save: { path: '/print/settings', method: 'PUT', fields: ['paperSize', 'showLogo', 'storeLetterhead'] }, read: { any: ['print.settings'] }, change: { any: ['print.settings'] } },
  security: { get: '/settings/security', save: null, read: { ownerOnly: true }, change: { ownerOnly: true } },
  // Plan 13: the loyalty scheme (its tiers are kept on the loyalty screen) and the gift card rules.
  loyalty: { get: '/loyalty/settings', save: { path: '/loyalty/settings', method: 'PATCH' }, read: { any: ['loyalty.view', 'loyalty.manage', 'pos.setup'] }, change: { any: ['loyalty.manage'] } },
  giftCards: { get: '/gift-cards/settings', save: null, read: { any: ['giftcards.view', 'giftcards.sell', 'giftcards.manage'] }, change: { ownerOnly: true } },
};

export type SettingKind =
  /** On or off. */
  | 'boolean'
  /** One of a few choices. */
  | 'choice'
  /** Rupees, kept as a decimal string. */
  | 'money'
  /** A percentage, kept as a decimal string. */
  | 'percent'
  /** A whole number. */
  | 'count'
  /** A calendar date (YYYY-MM-DD) or none. */
  | 'date'
  /** A time of day (HH:MM, Indian time). */
  | 'time'
  /** Free text or none. */
  | 'text'
  /** One row of a list (a price list, a group…), chosen from that list. */
  | 'reference'
  /** Shown here; changed on its own screen (it needs a picker or extra checks there). */
  | 'elsewhere';

/** Where the choices of a `reference` setting come from. */
export interface SettingLookup {
  /** API list to read; tree lists have `children`. */
  url: string;
  tree?: boolean;
  /** Only rows whose field is true (e.g. price lists for selling). */
  onlyWhere?: string;
  /** Code of the row that is the default (null default = none). */
  defaultCode?: string;
}

export interface SettingDef {
  /** Unique id: source.field. */
  id: string;
  section: SettingsSectionKey;
  source: SettingsSourceKey;
  field: string;
  label: string;
  /** One line: what it changes. */
  help: string;
  kind: SettingKind;
  choices?: readonly { value: string | number; label: string }[];
  lookup?: SettingLookup;
  /** The default as the API sends it; null = none. For `reference` with `lookup.defaultCode`, the row with that code. */
  default: unknown;
  /** The default in plain words. */
  defaultText: string;
  /** The older screen where it can also be changed. */
  screen: { href: string; label: string } | null;
  /** How an `elsewhere` setting shows its value. */
  show?: 'onOff' | 'setOrNot' | 'approved' | 'list' | 'count';
  /** Extra words after a count, e.g. "minutes". */
  unit?: string;
  /** Why it cannot be changed here, when there is a reason worth saying. */
  note?: string;
}

/** A link to a screen that belongs to a section (lists you keep, not single settings). */
export interface SettingsLink {
  href: string;
  label: string;
  right?: SettingsRight;
}

export interface SettingsSection {
  key: string;
  title: string;
  /** One line under the title. */
  lead: string;
  /** Hidden while this optional module is switched off (plan 12 §5). */
  module?: ModuleKey;
  /** Colour family (the area-* classes of the web app). */
  area: 'sales' | 'stock' | 'purchase' | 'accounts' | 'admin';
  links: readonly SettingsLink[];
}

const owner: SettingsRight = { ownerOnly: true };

export const SETTINGS_SECTIONS = [
  { key: 'company', title: 'Company and shops', lead: 'Your business details, your shops, the financial year and going live.', area: 'admin', links: [{ href: '/company', label: 'Company details and GSTINs', right: { any: ['company.view'] } }, { href: '/stores', label: 'Shops', right: { any: ['stores.view'] } }, { href: '/financial-years', label: 'Financial years', right: { any: ['financial_years.manage'] } }, { href: '/go-live', label: 'Going live', right: owner }] },
  { key: 'items', title: 'Items', lead: 'How new items start out.', area: 'sales', links: [{ href: '/catalogue/item-groups', label: 'Item groups', right: { any: ['catalogue.view'] } }, { href: '/catalogue/brands', label: 'Brands', right: { any: ['catalogue.view'] } }, { href: '/catalogue/units', label: 'Units', right: { any: ['catalogue.view'] } }, { href: '/catalogue/hsn-codes', label: 'HSN codes', right: { any: ['catalogue.view'] } }] },
  { key: 'variants', title: 'Sizes and colours', lead: 'The size and colour lists your styles are made in.', module: 'variants', area: 'sales', links: [{ href: '/catalogue/attributes', label: 'Sizes, colours and other attributes', right: { any: ['catalogue.view'] } }] },
  { key: 'prices', title: 'Prices', lead: 'Which price list is used, and how prices behave on a bill.', area: 'sales', links: [{ href: '/price-lists', label: 'Price lists', right: { any: ['prices.view'] } }, { href: '/prices', label: 'Prices', right: { any: ['prices.view'] } }] },
  { key: 'seasons', title: 'Seasons and markdowns', lead: 'Season tags and the markdown tool.', module: 'seasons', area: 'sales', links: [{ href: '/catalogue/seasons', label: 'Seasons', right: { any: ['catalogue.view'] } }, { href: '/markdowns', label: 'Markdowns', right: { any: ['prices.view'] } }] },
  { key: 'offers', title: 'Offers and coupons', lead: 'Offers, coupons and mix-and-match deals.', module: 'offers', area: 'sales', links: [{ href: '/pos/offers', label: 'Offers and coupons', right: { any: ['offers.manage'] } }] },
  { key: 'loyalty', title: 'Loyalty points', lead: 'What earns a point, what a point is worth, how long points last and the limits at the till.', module: 'loyalty', area: 'sales', links: [{ href: '/loyalty', label: 'Loyalty tiers, who joins, and the points reports', right: { any: ['loyalty.view', 'loyalty.manage'] } }] },
  { key: 'gift_cards', title: 'Gift cards', lead: 'Reloadable prepaid cards, sold and spent at the till.', module: 'gift_cards', area: 'sales', links: [{ href: '/gift-cards', label: 'Gift cards (list, history, block, reports)', right: { any: ['giftcards.view', 'giftcards.manage'] } }, { href: '/accounts/defaults', label: 'Default accounts (where expired balances go)', right: { any: ['accounts.view', 'accounts.manage'] } }] },
  { key: 'customers', title: 'Customers', lead: 'How new customers start out and which address decides the GST.', area: 'accounts', links: [{ href: '/customer-groups', label: 'Customer groups', right: { any: ['customers.view'] } }, { href: '/payment-terms', label: 'Payment terms', right: { any: ['customers.view'] } }] },
  { key: 'credit_sales', title: 'Credit sales', lead: 'Selling on account and credit limits.', module: 'credit_sales', area: 'accounts', links: [{ href: '/pos/payment-methods', label: 'Payment methods (On account)', right: { any: ['pos.setup'] } }] },
  { key: 'buying', title: 'Suppliers and buying', lead: 'Checks on goods receipts and supplier bills.', area: 'purchase', links: [{ href: '/supplier-groups', label: 'Supplier groups', right: { any: ['suppliers.view'] } }] },
  { key: 'purchase_orders', title: 'Purchase orders', lead: 'Approvals and limits for orders to suppliers.', module: 'purchase_orders', area: 'purchase', links: [] },
  { key: 'consignment', title: 'Supplier sale-or-return', lead: 'Goods you pay for only when sold.', module: 'consignment', area: 'purchase', links: [{ href: '/purchases/consignment', label: 'Sale or return', right: { any: ['purchase.view'] } }] },
  { key: 'stock', title: 'Stock', lead: 'Month-end lock and selling below zero.', area: 'stock', links: [{ href: '/stock/locations', label: 'Stock locations', right: { any: ['stock.view'] } }, { href: '/stock/reorder-levels', label: 'Reorder levels', right: { any: ['stock.view'] } }] },
  { key: 'batches', title: 'Batches and expiry', lead: 'Which batch the till sells first.', module: 'batches', area: 'stock', links: [{ href: '/stock/batches', label: 'Batches', right: { any: ['stock.view'] } }] },
  { key: 'till', title: 'Billing counter', lead: 'Closing the till, receipts and going live.', area: 'sales', links: [{ href: '/pos/tills', label: 'Tills (each till’s discount limit, price changes, printing, receipt footer)', right: { any: ['pos.setup'] } }, { href: '/pos/payment-methods', label: 'Payment methods', right: { any: ['pos.setup'] } }] },
  { key: 'salesperson', title: 'Salesperson', lead: 'Sales staff on bills.', module: 'salesperson', area: 'sales', links: [{ href: '/pos/sales-staff', label: 'Sales staff', right: { any: ['sales_staff.manage'] } }] },
  { key: 'delivery', title: 'Home delivery', lead: 'How the delivery charge is billed.', module: 'delivery', area: 'sales', links: [{ href: '/stores', label: 'Each shop’s delivery charge', right: { any: ['stores.view'] } }, { href: '/pos/deliveries', label: 'Home deliveries', right: { any: ['deliveries.manage'] } }] },
  { key: 'customer_orders', title: 'Customer orders', lead: 'Orders with an advance.', module: 'customer_orders', area: 'sales', links: [{ href: '/orders', label: 'Customer orders', right: { any: ['orders.manage'] } }] },
  { key: 'alterations', title: 'Alterations', lead: 'How alteration charges are billed.', module: 'alterations', area: 'sales', links: [{ href: '/alterations', label: 'Alteration job slips', right: { any: ['alterations.manage'] } }] },
  { key: 'gst', title: 'GST', lead: 'Which parts of the GST law apply to you. Your accountant approves these.', area: 'accounts', links: [{ href: '/pos/gst-rates', label: 'GST rates by HSN code', right: { any: ['gst_rates.manage', 'gst_rates.approve'] } }, { href: '/gst/settings', label: 'GST settings and the accountant’s approval', right: { any: ['gst_rates.manage', 'gst_rates.approve'] } }] },
  { key: 'einvoice', title: 'E-invoice', lead: 'Registering business invoices on the e-invoice portal.', module: 'einvoice', area: 'accounts', links: [{ href: '/gst/e-invoices', label: 'E-invoices', right: { any: ['einvoice.manage'] } }] },
  { key: 'eway', title: 'E-way bill', lead: 'When goods on the move need an e-way bill.', module: 'eway', area: 'accounts', links: [{ href: '/gst/e-way-bills', label: 'E-way bills', right: { any: ['eway.manage'] } }] },
  { key: 'accounts', title: 'Accounts', lead: 'Which accounts things post to, and closing the books.', area: 'accounts', links: [{ href: '/accounts/defaults', label: 'Default accounts', right: { any: ['accounts.view', 'accounts.manage'] } }, { href: '/accounts/banks', label: 'Bank accounts', right: { any: ['accounts.view', 'accounts.manage'] } }, { href: '/accounts/closing', label: 'Closing the books (books locked up to)', right: { any: ['accounts.view', 'books.lock'] } }] },
  { key: 'expenses', title: 'Expenses and cash book', lead: 'Simple expense entry.', module: 'expenses', area: 'accounts', links: [{ href: '/accounts/expenses', label: 'Expenses', right: { any: ['expenses.post', 'accounts.view'] } }] },
  { key: 'tally', title: 'Tally export', lead: 'Vouchers and ledgers for Tally.', module: 'tally', area: 'accounts', links: [{ href: '/accounts/tally', label: 'Export to Tally (ledger names)', right: { any: ['tally.export', 'accounts.manage'] } }] },
  { key: 'reports', title: 'Reports and summary email', lead: 'The daily email with the shop’s key figures.', area: 'sales', links: [{ href: '/reports/summary-email', label: 'Daily summary email (recipients, test send)', right: { any: ['reports.summary_email'] } }] },
  { key: 'printing', title: 'Printing and labels', lead: 'Paper, logo and letterhead on printed documents.', area: 'admin', links: [{ href: '/printing', label: 'Logo and standard terms', right: { any: ['print.settings'] } }, { href: '/labels/templates', label: 'Label templates', right: { any: ['print.settings'] } }] },
  { key: 'security', title: 'Users and security', lead: 'Passwords, lock-out and how long a login lasts.', area: 'admin', links: [{ href: '/users', label: 'Users', right: { any: ['users.view'] } }, { href: '/roles', label: 'Roles and rights', right: { any: ['roles.manage'] } }] },
  { key: 'numbering', title: 'Numbering', lead: 'How document numbers look.', area: 'admin', links: [{ href: '/numbering', label: 'Document numbering', right: { any: ['numbering.manage'] } }] },
] as const satisfies readonly SettingsSection[];

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]['key'];

const onOff = (on: boolean) => (on ? 'On' : 'Off');
const SCREEN = {
  catalogue: { href: '/catalogue/settings', label: 'Catalogue settings' },
  parties: { href: '/party-settings', label: 'Party settings' },
  stock: { href: '/stock/settings', label: 'Inventory settings' },
  purchase: { href: '/purchases/settings', label: 'Purchase settings' },
  pos: { href: '/pos/settings', label: 'Till settings' },
  gst: { href: '/gst/settings', label: 'GST settings' },
  summaryEmail: { href: '/reports/summary-email', label: 'Daily summary email' },
  print: { href: '/printing', label: 'Printing settings' },
  loyalty: { href: '/loyalty', label: 'Loyalty points' },
} as const;

/** Every company-wide setting there is today, in the order the centre shows them. */
export const SETTINGS: readonly SettingDef[] = [
  // ---- Items (catalogue settings) ----
  { id: 'catalogue.autoItemCodes', section: 'items', source: 'catalogue', field: 'autoItemCodes', label: 'Number items automatically', help: 'A new item without a typed code gets the next number (ITM-000001). Typed codes are always allowed.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.catalogue },
  { id: 'catalogue.defaultItemGroupId', section: 'items', source: 'catalogue', field: 'defaultItemGroupId', label: 'Default item group', help: 'The group a new item starts in.', kind: 'reference', lookup: { url: '/catalogue/item-groups', tree: true }, default: null, defaultText: 'None', screen: SCREEN.catalogue },
  { id: 'catalogue.defaultUnitId', section: 'items', source: 'catalogue', field: 'defaultUnitId', label: 'Default unit', help: 'The unit a new item is counted in.', kind: 'reference', lookup: { url: '/catalogue/units', defaultCode: 'PCS' }, default: null, defaultText: 'PCS (pieces)', screen: SCREEN.catalogue },
  // ---- Prices ----
  { id: 'catalogue.defaultSellingPriceListId', section: 'prices', source: 'catalogue', field: 'defaultSellingPriceListId', label: 'Default selling price list', help: 'Used by the till and for an item’s first selling price.', kind: 'reference', lookup: { url: '/price-lists', onlyWhere: 'forSelling', defaultCode: 'STD-SELL' }, default: null, defaultText: 'Standard Selling', screen: SCREEN.catalogue },
  { id: 'catalogue.defaultBuyingPriceListId', section: 'prices', source: 'catalogue', field: 'defaultBuyingPriceListId', label: 'Default buying price list', help: 'Used for prices on purchase orders.', kind: 'reference', lookup: { url: '/price-lists', onlyWhere: 'forBuying', defaultCode: 'STD-BUY' }, default: null, defaultText: 'Standard Buying', screen: SCREEN.catalogue },
  { id: 'catalogue.fallbackToDefaultSellingList', section: 'prices', source: 'catalogue', field: 'fallbackToDefaultSellingList', label: 'Fall back to the default selling list', help: 'When a customer’s own price list has no price for an item, the default selling list’s price is used.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.catalogue },
  { id: 'catalogue.allowPriceChangeOnBill', section: 'prices', source: 'catalogue', field: 'allowPriceChangeOnBill', label: 'Allow changing the price on a bill', help: 'Off: only a manager, with their PIN, can change a price at the till.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.catalogue },
  { id: 'catalogue.blockSellingBelowCost', section: 'prices', source: 'catalogue', field: 'blockSellingBelowCost', label: 'Block selling below cost', help: 'A till line priced under the item’s cost needs a manager’s PIN.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.catalogue },
  { id: 'catalogue.saveTypedPrices', section: 'prices', source: 'catalogue', field: 'saveTypedPrices', label: 'Save typed prices into the price list', help: 'When an item has no price, the price typed on the bill becomes its price from that day.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.catalogue },
  // ---- Loyalty points (plan 13; starting values approved by the owner on 21 October 2026) ----
  { id: 'loyalty.schemeName', section: 'loyalty', source: 'loyalty', field: 'schemeName', label: 'Name of the scheme', help: 'Shown on receipts and the customer page.', kind: 'text', default: 'Loyalty points', defaultText: 'Loyalty points', screen: SCREEN.loyalty },
  { id: 'loyalty.earnSpend', section: 'loyalty', source: 'loyalty', field: 'earnSpend', label: 'Rupees spent to earn points (₹)', help: 'With the next setting: ₹100 spent earns 1 point. What is paid with points or a gift card does not earn.', kind: 'money', default: '100', defaultText: '₹100', screen: SCREEN.loyalty },
  { id: 'loyalty.earnPoints', section: 'loyalty', source: 'loyalty', field: 'earnPoints', label: 'Points earned for that much', help: 'Whole points; part of a point is dropped. Tiers can give more.', kind: 'count', unit: 'points', default: 1, defaultText: '1 point', screen: SCREEN.loyalty },
  { id: 'loyalty.pointValue', section: 'loyalty', source: 'loyalty', field: 'pointValue', label: 'What one point is worth when spent (₹)', help: 'Changing it changes the worth of every unspent point; the accounts are adjusted the same day.', kind: 'money', default: '1', defaultText: '₹1', screen: SCREEN.loyalty },
  { id: 'loyalty.validityDays', section: 'loyalty', source: 'loyalty', field: 'validityDays', label: 'Points last', help: 'Points not spent by then expire at night and are written back in the accounts.', kind: 'count', unit: 'days', default: 365, defaultText: '365 days', screen: SCREEN.loyalty },
  { id: 'loyalty.minRedeem', section: 'loyalty', source: 'loyalty', field: 'minRedeem', label: 'Fewest points spent at a time', help: 'A customer must spend at least this many points on a bill.', kind: 'count', unit: 'points', default: 100, defaultText: '100 points', screen: SCREEN.loyalty },
  { id: 'loyalty.maxSharePercent', section: 'loyalty', source: 'loyalty', field: 'maxSharePercent', label: 'Most of a bill paid with points (%)', help: 'The rest is paid by cash, card or UPI.', kind: 'percent', default: '50', defaultText: '50%', screen: SCREEN.loyalty },
  { id: 'loyalty.joinAll', section: 'loyalty', source: 'loyalty', field: 'joinAll', label: 'Every named customer joins', help: 'Off: only customers in the groups chosen on the loyalty screen earn points. Walk-in bills never earn.', kind: 'boolean', default: true, defaultText: 'On', screen: SCREEN.loyalty },
  { id: 'loyalty.customerGroupIds', section: 'loyalty', source: 'loyalty', field: 'customerGroupIds', label: 'Customer groups that join', help: 'Used when not every customer joins.', kind: 'elsewhere', show: 'count', unit: 'groups', default: [], defaultText: 'None chosen', screen: SCREEN.loyalty, note: 'Chosen on the loyalty screen.' },
  { id: 'loyalty.expiryTo', section: 'loyalty', source: 'loyalty', field: 'expiryTo', label: 'Expired points are written back to', help: 'The account credited when points expire. Your accountant decides.', kind: 'choice', choices: [{ value: 'loyalty_expense', label: 'Loyalty points expense (reduces it)' }, { value: 'other_income', label: 'Other income' }], default: 'loyalty_expense', defaultText: 'Loyalty points expense', screen: SCREEN.loyalty },
  { id: 'loyalty.tiers', section: 'loyalty', source: 'loyalty', field: 'tiers', label: 'Tiers', help: 'For example Silver from ₹0 and Gold from ₹25,000 spent in a year, each with its own earn rate.', kind: 'elsewhere', show: 'count', unit: 'tiers', default: [], defaultText: 'None (one rate for all)', screen: SCREEN.loyalty, note: 'Kept on the loyalty screen.' },
  // ---- Gift cards (plan 13 section 2) ----
  { id: 'giftCards.validityMonths', section: 'gift_cards', source: 'giftCards', field: 'validityMonths', label: 'A card lasts', help: 'From the day it is sold; what is left at the end is written back at night, after showing in the expiring-cards report.', kind: 'elsewhere', show: 'count', unit: 'months', default: 12, defaultText: '12 months', screen: null, note: 'Fixed at 12 months for now (plan 13).' },
  { id: 'giftCards.refundToCard', section: 'gift_cards', source: 'giftCards', field: 'refundToCard', label: 'Returns go back on the card', help: 'Money for goods paid with a gift card goes back on that card, not in cash (an expired card is refunded by the till).', kind: 'elsewhere', show: 'onOff', default: true, defaultText: 'On', screen: null, note: 'Fixed for now (plan 13).' },
  { id: 'giftCards.expiryAccountSet', section: 'gift_cards', source: 'giftCards', field: 'expiryAccountSet', label: 'Account expired balances go to', help: 'Other income, unless your accountant chooses another account for Expired gift card balances.', kind: 'elsewhere', show: 'setOrNot', default: true, defaultText: 'Other income', screen: { href: '/accounts/defaults', label: 'Default accounts' }, note: 'Chosen on the Default accounts screen.' },
  // ---- Customers (party settings) ----
  { id: 'parties.defaultCustomerGroupId', section: 'customers', source: 'parties', field: 'defaultCustomerGroupId', label: 'Default customer group', help: 'The group a customer added at the till, or without a group, goes into.', kind: 'reference', lookup: { url: '/customer-groups', tree: true, defaultCode: 'RETAIL' }, default: null, defaultText: 'Retail', screen: SCREEN.parties },
  { id: 'parties.defaultPaymentTermsId', section: 'customers', source: 'parties', field: 'defaultPaymentTermsId', label: 'Default payment terms', help: 'When neither the customer or supplier nor its group names terms.', kind: 'reference', lookup: { url: '/payment-terms', defaultCode: 'CASH' }, default: null, defaultText: 'Cash', screen: SCREEN.parties },
  { id: 'parties.gstTreatmentFrom', section: 'customers', source: 'parties', field: 'gstTreatmentFrom', label: 'Address that decides same-state or other-state GST', help: 'Which of a customer’s addresses sets CGST + SGST or IGST.', kind: 'choice', choices: [{ value: 'billing', label: 'Billing address' }, { value: 'delivery', label: 'Delivery address' }], default: 'billing', defaultText: 'Billing address', screen: SCREEN.parties },
  { id: 'parties.defaultCreditLimit', section: 'credit_sales', source: 'parties', field: 'defaultCreditLimit', label: 'Default credit limit (₹)', help: 'What a new customer may owe. 0 means no credit until someone sets a limit.', kind: 'money', default: '0', defaultText: '₹0 (no credit)', screen: SCREEN.parties },
  // ---- Suppliers and buying ----
  { id: 'parties.defaultSupplierGroupId', section: 'buying', source: 'parties', field: 'defaultSupplierGroupId', label: 'Default supplier group', help: 'The group a new supplier goes into when none is chosen.', kind: 'reference', lookup: { url: '/supplier-groups', tree: true, defaultCode: 'LOCAL' }, default: null, defaultText: 'Local suppliers', screen: SCREEN.parties },
  { id: 'purchase.overReceiptPercent', section: 'buying', source: 'purchase', field: 'overReceiptPercent', label: 'Extra allowed when receiving (%)', help: 'How much more than ordered may be received. 0 means not more than ordered.', kind: 'percent', default: '0', defaultText: '0%', screen: SCREEN.purchase },
  { id: 'purchase.overBillingPercent', section: 'buying', source: 'purchase', field: 'overBillingPercent', label: 'Extra allowed when billing (%)', help: 'How much more than received a supplier may bill.', kind: 'percent', default: '0', defaultText: '0%', screen: SCREEN.purchase },
  { id: 'purchase.priceMismatch', section: 'buying', source: 'purchase', field: 'priceMismatch', label: 'When the bill price differs from the order', help: 'Allow it, allow it with a warning, or refuse the bill.', kind: 'choice', choices: [{ value: 'allow', label: 'Allow it' }, { value: 'warn', label: 'Allow it with a warning' }, { value: 'block', label: 'Do not allow it' }], default: 'warn', defaultText: 'Allow it with a warning', screen: SCREEN.purchase },
  { id: 'purchase.checkSupplierBillNo', section: 'buying', source: 'purchase', field: 'checkSupplierBillNo', label: 'Check supplier bill numbers', help: 'Stops the same bill number being entered twice for one supplier.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.purchase },
  { id: 'purchase.billNeedsReceipt', section: 'buying', source: 'purchase', field: 'billNeedsReceipt', label: 'A bill for goods needs a goods receipt', help: 'Goods must be received before they are billed. A supplier can be excused on its own page.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.purchase },
  { id: 'purchase.fillLastPurchasePrice', section: 'buying', source: 'purchase', field: 'fillLastPurchasePrice', label: 'Fill in the last purchase price', help: 'When the supplier has no list price, new lines start with the last price paid.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.purchase },
  // ---- Purchase orders ----
  { id: 'purchase.approvalLimit', section: 'purchase_orders', source: 'purchase', field: 'approvalLimit', label: 'Approval limit (₹)', help: 'Orders above this total need a Store Manager or the Owner to finalise.', kind: 'money', default: '50000', defaultText: '₹50,000', screen: SCREEN.purchase },
  { id: 'purchase.overOrderPercent', section: 'purchase_orders', source: 'purchase', field: 'overOrderPercent', label: 'Extra allowed when ordering (%)', help: 'How far an order may go above the suggested quantity.', kind: 'percent', default: '0', defaultText: '0%', screen: SCREEN.purchase },
  { id: 'purchase.requireOrderForReceipt', section: 'purchase_orders', source: 'purchase', field: 'requireOrderForReceipt', label: 'Goods must come against a purchase order', help: 'Off: a manager can still receive goods without an order by giving a reason.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.purchase },
  { id: 'purchase.billNeedsOrder', section: 'purchase_orders', source: 'purchase', field: 'billNeedsOrder', label: 'A bill for goods needs a purchase order', help: 'Every goods line of a supplier bill must come from an order.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.purchase },
  // ---- Stock ----
  { id: 'stock.stockLockDate', section: 'stock', source: 'stock', field: 'stockLockDate', label: 'Stock locked up to', help: 'Month-end lock: nothing can be posted or cancelled on or before this date.', kind: 'date', default: null, defaultText: 'Not locked', screen: SCREEN.stock },
  { id: 'stock.allowNegativeAtTill', section: 'stock', source: 'stock', field: 'allowNegativeAtTill', label: 'Allow selling below zero at the till', help: 'A sale is never stopped for missing stock; it is flagged on the Negative stock list instead.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.stock },
  { id: 'stock.batchPickOrder', section: 'batches', source: 'stock', field: 'batchPickOrder', label: 'Batch the till sells first', help: 'Which batch of an item goes out first.', kind: 'choice', choices: [{ value: 'earliest_expiry', label: 'Earliest expiry first' }, { value: 'oldest_first', label: 'Oldest batch first' }], default: 'earliest_expiry', defaultText: 'Earliest expiry first', screen: SCREEN.stock },
  // ---- Billing counter ----
  { id: 'pos.cashDifferenceApprovalAmount', section: 'till', source: 'pos', field: 'cashDifferenceApprovalAmount', label: 'Cash difference needing a manager (₹)', help: 'A bigger difference between counted and expected cash at closing needs a manager’s PIN and a remark.', kind: 'money', default: '100', defaultText: '₹100', screen: SCREEN.pos },
  { id: 'pos.printReceiptCopies', section: 'till', source: 'pos', field: 'printReceiptCopies', label: 'Receipt copies', help: 'How many receipts print for each bill.', kind: 'choice', choices: [{ value: 0, label: 'None (print on request)' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }], default: 1, defaultText: '1', screen: SCREEN.pos },
  { id: 'pos.liveAllowed', section: 'till', source: 'pos', field: 'liveAllowed', label: 'Tills bill for real (live)', help: 'Only the Owner switches this on, after the accountant approves the GST rates.', kind: 'elsewhere', show: 'onOff', default: false, defaultText: 'Off (not live yet)', screen: SCREEN.pos, note: 'Needs the accountant’s approval first, so it is switched on the Till settings screen.' },
  { id: 'pos.deliveryItemId', section: 'delivery', source: 'pos', field: 'deliveryItemId', label: 'Item the delivery charge is billed as', help: 'A service item with its own HSN code and GST rate.', kind: 'elsewhere', show: 'setOrNot', default: null, defaultText: 'Not set', screen: SCREEN.pos, note: 'Chosen by searching the items, on the Till settings screen.' },
  { id: 'pos.alterationItemId', section: 'alterations', source: 'pos', field: 'alterationItemId', label: 'Item alteration charges are billed as', help: 'A service item with its own HSN code and GST rate.', kind: 'elsewhere', show: 'setOrNot', default: null, defaultText: 'Not set', screen: SCREEN.pos, note: 'Chosen by searching the items, on the Till settings screen.' },
  // ---- GST ----
  { id: 'gst.scheme', section: 'gst', source: 'gst', field: 'scheme', label: 'GST scheme', help: 'Composition: bills of supply without GST, and no input credit.', kind: 'choice', choices: [{ value: 'regular', label: 'Regular (tax invoices with GST)' }, { value: 'composition', label: 'Composition scheme (bills of supply)' }], default: 'regular', defaultText: 'Regular', screen: SCREEN.gst },
  { id: 'gst.filingFrequency', section: 'gst', source: 'gst', field: 'filingFrequency', label: 'Returns filed', help: 'Quarterly is for a turnover up to ₹5 crore.', kind: 'choice', choices: [{ value: 'quarterly', label: 'Quarterly' }, { value: 'monthly', label: 'Monthly' }], default: 'quarterly', defaultText: 'Quarterly', screen: SCREEN.gst },
  { id: 'gst.turnoverBand', section: 'gst', source: 'gst', field: 'turnoverBand', label: 'Turnover band', help: 'Last year’s turnover of all GSTINs under your PAN; it decides HSN digits and e-invoicing.', kind: 'choice', choices: [{ value: 'up_to_5cr', label: 'Up to ₹5 crore' }, { value: '5cr_to_10cr', label: 'Above ₹5 crore, below ₹10 crore' }, { value: 'above_10cr', label: '₹10 crore and above' }, { value: 'above_500cr', label: 'Above ₹500 crore' }], default: 'up_to_5cr', defaultText: 'Up to ₹5 crore', screen: SCREEN.gst },
  { id: 'gst.hsnDigits', section: 'gst', source: 'gst', field: 'hsnDigits', label: 'HSN digits on invoices', help: '4 digits up to ₹5 crore turnover, 6 above.', kind: 'choice', choices: [{ value: 4, label: '4 digits' }, { value: 6, label: '6 digits' }, { value: 8, label: '8 digits' }], default: 4, defaultText: '4 digits', screen: SCREEN.gst },
  { id: 'gst.receiptTaxTable', section: 'gst', source: 'gst', field: 'receiptTaxTable', label: 'GST table on till receipts', help: 'Prints the tax by rate at the foot of each receipt.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.gst },
  { id: 'gst.combineSmallSales', section: 'gst', source: 'gst', field: 'combineSmallSales', label: 'Combine sales under ₹200 in the reports', help: 'Shows them as one daily invoice in the GST reports; every bill is still kept.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.gst },
  { id: 'gst.freeSampleTax', section: 'gst', source: 'gst', field: 'freeSampleTax', label: 'Free samples', help: 'How GST is handled on samples given free. Your accountant decides.', kind: 'choice', choices: [{ value: 'not_set', label: 'Not set yet (the accountant decides)' }, { value: 'reverse_input_credit', label: 'No tax on the sample; input credit on it is reversed' }, { value: 'tax_on_value', label: 'Tax on the value of the sample' }], default: 'not_set', defaultText: 'Not set yet', screen: SCREEN.gst },
  { id: 'gst.approved', section: 'gst', source: 'gst', field: 'approved', label: 'Approved by the Chartered Accountant', help: 'Until it is approved every bill is marked provisional and the tills cannot go live.', kind: 'elsewhere', show: 'approved', default: false, defaultText: 'Not approved', screen: SCREEN.gst, note: 'Recorded with a note on the GST settings screen.' },
  // ---- E-invoice and e-way bill ----
  { id: 'gst.eInvoiceApplies', section: 'einvoice', source: 'gst', field: 'eInvoiceApplies', label: 'E-invoicing applies to this business', help: 'Business invoices are registered on the e-invoice portal (turnover above ₹5 crore).', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.gst },
  { id: 'gst.eWayLimit', section: 'eway', source: 'gst', field: 'eWayLimit', label: 'E-way bill needed above (₹)', help: 'Goods moved above this value need an e-way bill.', kind: 'money', default: '50000', defaultText: '₹50,000', screen: SCREEN.gst },
  { id: 'gst.eWayStateLimits', section: 'eway', source: 'gst', field: 'eWayStateLimits', label: 'Own limits of some states', help: 'Some states set a different limit for goods moving within the state.', kind: 'elsewhere', show: 'list', default: {}, defaultText: 'None', screen: null, note: 'No screen yet; proposed in the settings list.' },
  { id: 'gst.defaultTransporterId', section: 'eway', source: 'gst', field: 'defaultTransporterId', label: 'Usual transporter’s GSTIN or id', help: 'Filled in on new e-way bills.', kind: 'text', default: null, defaultText: 'None', screen: SCREEN.gst },
  { id: 'gst.defaultTransporterName', section: 'eway', source: 'gst', field: 'defaultTransporterName', label: 'Usual transporter’s name', help: 'Filled in on new e-way bills.', kind: 'text', default: null, defaultText: 'None', screen: SCREEN.gst },
  // ---- Accounts ----
  { id: 'accounting.ageingBands', section: 'accounts', source: 'accounting', field: 'ageingBands', label: 'Age bands for unpaid bills (days)', help: 'The columns of the “who owes what, by age” reports.', kind: 'elsewhere', show: 'list', default: [30, 60, 90, 120], defaultText: '30, 60, 90, 120', screen: null, note: 'No screen yet; proposed in the settings list.' },
  { id: 'accounting.chartApprovedAt', section: 'accounts', source: 'accounting', field: 'chartApprovedAt', label: 'Chart of accounts approved by the accountant', help: 'Recorded by the Owner once the Chartered Accountant has checked the chart.', kind: 'elsewhere', show: 'approved', default: null, defaultText: 'Not approved', screen: { href: '/accounts', label: 'Chart of accounts' } },
  // ---- Reports and summary email ----
  { id: 'summaryEmail.enabled', section: 'reports', source: 'summaryEmail', field: 'enabled', label: 'Send the daily summary email', help: 'Once a day an email with the key figures goes to the people you pick.', kind: 'boolean', default: false, defaultText: onOff(false), screen: SCREEN.summaryEmail },
  { id: 'summaryEmail.sendAt', section: 'reports', source: 'summaryEmail', field: 'sendAt', label: 'Send at (Indian time)', help: 'In the evening it covers that day; in the morning, the day before.', kind: 'time', default: '21:00', defaultText: '21:00', screen: SCREEN.summaryEmail },
  { id: 'summaryEmail.recipientIds', section: 'reports', source: 'summaryEmail', field: 'recipientIds', label: 'Who receives it', help: 'Chosen from your users.', kind: 'elsewhere', show: 'count', unit: 'people', default: [], defaultText: 'Nobody', screen: SCREEN.summaryEmail, note: 'Picked from the list of users on the summary email screen.' },
  { id: 'summaryEmail.figures', section: 'reports', source: 'summaryEmail', field: 'figures', label: 'Figures in the email', help: 'Sales, payments, stock, dues and the other figures it carries.', kind: 'elsewhere', show: 'count', unit: 'figures', default: null, defaultText: 'All of them', screen: SCREEN.summaryEmail, note: 'Ticked one by one on the summary email screen.' },
  // ---- Printing ----
  { id: 'print.paperSize', section: 'printing', source: 'print', field: 'paperSize', label: 'Paper size', help: 'For purchase orders, receipts, statements and other printed documents.', kind: 'choice', choices: [{ value: 'A4', label: 'A4 (full sheet)' }, { value: 'A5', label: 'A5 (half sheet)' }], default: 'A4', defaultText: 'A4', screen: SCREEN.print },
  { id: 'print.showLogo', section: 'printing', source: 'print', field: 'showLogo', label: 'Print the logo at the top', help: 'Uses the logo uploaded on the Printing settings screen.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.print },
  { id: 'print.storeLetterhead', section: 'printing', source: 'print', field: 'storeLetterhead', label: 'Each shop’s own name, address and GSTIN', help: 'Off: the company’s address and GSTIN go on every shop’s documents.', kind: 'boolean', default: true, defaultText: onOff(true), screen: SCREEN.print },
  { id: 'print.hasLogo', section: 'printing', source: 'print', field: 'hasLogo', label: 'Logo', help: 'A PNG or JPEG picture of your logo.', kind: 'elsewhere', show: 'setOrNot', default: false, defaultText: 'None', screen: SCREEN.print, note: 'Uploaded on the Printing settings screen.' },
  // ---- Users and security (read only for now) ----
  { id: 'security.minPasswordLength', section: 'security', source: 'security', field: 'minPasswordLength', label: 'Shortest password', help: 'Passwords shorter than this are refused.', kind: 'elsewhere', show: 'count', unit: 'characters', default: 10, defaultText: '10 characters', screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
  { id: 'security.lockoutAttempts', section: 'security', source: 'security', field: 'lockoutAttempts', label: 'Wrong passwords before a lock-out', help: 'After this many wrong tries in a row the login is locked for a while.', kind: 'elsewhere', show: 'count', unit: 'tries', default: 5, defaultText: '5 tries', screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
  { id: 'security.lockoutSeconds', section: 'security', source: 'security', field: 'lockoutSeconds', label: 'Lock-out lasts', help: 'How long a locked login waits before it can try again.', kind: 'elsewhere', show: 'count', unit: 'seconds', default: 900, defaultText: '900 seconds (15 minutes)', screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
  { id: 'security.sessionIdleMinutes', section: 'security', source: 'security', field: 'sessionIdleMinutes', label: 'Log out after no use for', help: 'A login left unused this long ends by itself.', kind: 'elsewhere', show: 'count', unit: 'minutes', default: 30, defaultText: '30 minutes', screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
  { id: 'security.sessionMaxHours', section: 'security', source: 'security', field: 'sessionMaxHours', label: 'Longest a login lasts', help: 'Even in use, a login ends after this long and the person logs in again.', kind: 'elsewhere', show: 'count', unit: 'hours', default: 12, defaultText: '12 hours', screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
  { id: 'security.singleSessionPerUser', section: 'security', source: 'security', field: 'singleSessionPerUser', label: 'One login per person at a time', help: 'On: logging in on a second computer ends the first.', kind: 'elsewhere', show: 'onOff', default: false, defaultText: onOff(false), screen: null, note: 'Set by whoever runs the server for now; a screen is proposed.' },
];

/** Settings that can be changed in the centre itself (the rest open their own screen). */
export function changeableHere(s: SettingDef): boolean {
  return s.kind !== 'elsewhere' && SETTINGS_SOURCES[s.source].save !== null;
}

/** Plain-words search: every word typed must appear in the label, the explanation or the section title. */
export function matchesSearch(s: SettingDef, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const section = SETTINGS_SECTIONS.find((x) => x.key === s.section)?.title ?? '';
  const text = `${s.label} ${s.help} ${section} ${s.defaultText}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** May this user do what `right` asks? */
export function hasSettingsRight(user: { isOwnerAdmin: boolean; permissions: readonly string[] } | null, right: SettingsRight | undefined): boolean {
  if (!user) return false;
  if (!right) return true;
  if (user.isOwnerAdmin) return true;
  if (right.ownerOnly) return false;
  return !right.any || right.any.some((k) => user.permissions.includes(k));
}
