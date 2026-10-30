// Copyright (c) 2026, Rademics. All rights reserved.
// Optional modules and shop types (plan 12). Core modules are always on and are not
// listed here. A company with no saved choice for a module has it switched on, so
// companies that existed before plan 12 keep everything.

export const OPTIONAL_MODULES = {
  variants: { label: 'Sizes and colours', description: 'Styles in sizes and colours, the size × colour grid, and reports by size and colour.', needs: [] },
  batches: { label: 'Batches and expiry', description: 'Batch numbers and expiry dates on items, with expiry checks at the till.', needs: [] },
  serials: { label: 'Serial numbers and warranty', description: 'A serial number for every piece, at receipt and at sale.', needs: [] },
  seasons: { label: 'Seasons and markdowns', description: 'Season or collection on items, season sell-through, and the markdown tool.', needs: [] },
  purchase_orders: { label: 'Purchase orders', description: 'Orders to suppliers before the goods arrive, with follow-up of what is still due.', needs: [] },
  consignment: { label: 'Supplier sale-or-return', description: 'Goods you pay for only when sold; monthly statements turn sales into supplier bills.', needs: [] },
  transfers: { label: 'Transfers between shops', description: 'Sending stock from one shop to another, with goods in transit.', needs: [] },
  customer_orders: { label: 'Customer orders', description: 'Orders with an advance, goods set aside when ready, collected on a till bill.', needs: [] },
  alterations: { label: 'Alterations', description: 'Alteration job slips with tailor, promised date and charge.', needs: ['salesperson'] },
  delivery: { label: 'Home delivery', description: 'Delivery details and charges on bills, and the list of deliveries.', needs: [] },
  salesperson: { label: 'Salesperson', description: 'The salesperson on each bill and line, and sales by salesperson.', needs: [] },
  offers: { label: 'Offers and coupons', description: 'Percentage and amount offers, buy-get, any-N-for-a-price and coupons.', needs: [] },
  credit_sales: { label: 'Credit sales', description: 'Selling on account at the till, with credit limits and manager approval.', needs: [] },
  expenses: { label: 'Expenses and cash book', description: 'Simple expense entry and the cash and bank books.', needs: [] },
  einvoice: { label: 'E-invoice', description: 'E-invoice files for the government portal and their status. Needed above ₹5 crore turnover.', needs: [] },
  eway: { label: 'E-way bill', description: 'E-way bill files for moving goods over the limit, and the register.', needs: [] },
  tally: { label: 'Tally export', description: 'Vouchers and ledgers for an accountant who uses Tally.', needs: [] },
  loyalty: { label: 'Loyalty points', description: 'Customers earn points on what they spend and pay with them later.', needs: [] },
  gift_cards: { label: 'Gift cards', description: 'Reloadable prepaid gift cards, sold and spent at the till.', needs: [] },
} as const satisfies Record<string, { label: string; description: string; needs: readonly string[] }>;

export type ModuleKey = keyof typeof OPTIONAL_MODULES;
export const MODULE_KEYS = Object.keys(OPTIONAL_MODULES) as ModuleKey[];

export function isModuleKey(value: string): value is ModuleKey {
  return Object.prototype.hasOwnProperty.call(OPTIONAL_MODULES, value);
}

/** Saved choices → the full on/off map; a module with no saved choice is on. */
export function moduleMap(saved: readonly { moduleKey: string; enabled: boolean }[]): Record<ModuleKey, boolean> {
  const map = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>;
  for (const s of saved) if (isModuleKey(s.moduleKey)) map[s.moduleKey] = s.enabled;
  return map;
}

/** The modules switched on together with `key` (its needs, and theirs). */
export function withNeeds(key: ModuleKey): ModuleKey[] {
  const out = new Set<ModuleKey>([key]);
  const queue: ModuleKey[] = [key];
  while (queue.length) {
    for (const n of OPTIONAL_MODULES[queue.shift()!].needs as readonly ModuleKey[]) {
      if (!out.has(n)) {
        out.add(n);
        queue.push(n);
      }
    }
  }
  return [...out];
}

/** The modules that need `key`, so switching `key` off would leave them without it. */
export function neededBy(key: ModuleKey): ModuleKey[] {
  return MODULE_KEYS.filter((k) => k !== key && withNeeds(k).includes(key));
}

export const SHOP_TYPES = {
  fancy: {
    label: 'Fancy and gift',
    description: 'Fashion jewellery, cosmetics, toys, bags, gifts, stationery and decor.',
    modules: ['offers', 'delivery', 'transfers', 'purchase_orders'],
    itemGroups: ['Fashion jewellery', 'Cosmetics', 'Toys', 'Bags and wallets', 'Gift articles', 'Stationery', 'Home decor', 'Hair accessories'],
    hsnCodes: ['7117', '3304', '4202', '9503', '9615', '9004', '9102', '4820', '9608', '6117', '3926'],
    newItemMaxDiscountPercent: '10',
    newItemAutoNumberBatches: true,
  },
  clothing: {
    label: 'Clothing',
    description: 'Garments for men, women and children, in sizes and colours.',
    modules: ['variants', 'seasons', 'salesperson', 'alterations', 'customer_orders', 'offers', 'transfers', 'purchase_orders', 'delivery'],
    itemGroups: ['Men shirts', 'Men trousers', 'Men T-shirts', 'Women kurtis', 'Women tops', 'Sarees', 'Kids wear', 'Innerwear'],
    hsnCodes: ['6105', '6106', '6109', '6104', '6111', '6115', '6203', '6204', '6205', '6206', '6207', '6208', '6209', '6211', '6214'],
    newItemMaxDiscountPercent: '10',
    newItemAutoNumberBatches: true,
  },
  footwear: {
    label: 'Footwear',
    description: 'Shoes, sandals and slippers in sizes and colours.',
    modules: ['variants', 'seasons', 'salesperson', 'offers', 'transfers', 'purchase_orders'],
    itemGroups: ['Men footwear', 'Women footwear', 'Kids footwear', 'Sports shoes', 'Slippers', 'Accessories'],
    hsnCodes: ['6401', '6402', '6403', '6404', '6405', '6406'],
    newItemMaxDiscountPercent: '0',
    newItemAutoNumberBatches: true,
  },
  cosmetics: {
    label: 'Cosmetics and beauty',
    description: 'Make-up, skin and hair care, perfumes — sold by batch with expiry dates.',
    modules: ['batches', 'offers', 'transfers', 'purchase_orders'],
    itemGroups: ['Make-up', 'Skin care', 'Hair care', 'Perfumes', 'Personal care', 'Accessories'],
    hsnCodes: ['3303', '3304', '3305', '3306', '3401', '9615', '9603'],
    newItemMaxDiscountPercent: '0',
    // Cosmetics packs carry the maker's batch number, which the shop types in (recalls).
    newItemAutoNumberBatches: false,
  },
  mobiles: {
    label: 'Mobiles and electronics',
    description: 'Phones, accessories and small electronics with serial numbers and warranty.',
    modules: ['serials', 'customer_orders', 'offers', 'transfers', 'purchase_orders', 'credit_sales'],
    itemGroups: ['Mobile phones', 'Tablets', 'Chargers and cables', 'Earphones and speakers', 'Covers and screen guards', 'Small electronics'],
    hsnCodes: ['8517', '8504', '8507', '8518', '8544', '3926'],
    newItemMaxDiscountPercent: '0',
    newItemAutoNumberBatches: true,
  },
  general: {
    label: 'General store',
    description: 'A mix of everyday goods; switch on more modules any time.',
    modules: ['offers'],
    itemGroups: ['General'],
    hsnCodes: ['3401', '3306', '3924', '4820', '9608'],
    newItemMaxDiscountPercent: '0',
    newItemAutoNumberBatches: true,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    description: string;
    modules: readonly ModuleKey[];
    itemGroups: readonly string[];
    /** Decision L1 (owner, 28 October 2026): common HSN headings added to the shop's own list, with the official descriptions. */
    hsnCodes: readonly string[];
    /** Decision L6: a new item's starting maximum discount %. */
    newItemMaxDiscountPercent: string;
    /** Decision L12: whether a new batch item numbers its batches itself. */
    newItemAutoNumberBatches: boolean;
  }
>;

export type ShopTypeKey = keyof typeof SHOP_TYPES;
export const SHOP_TYPE_KEYS = Object.keys(SHOP_TYPES) as ShopTypeKey[];

/** The full on/off map a shop type starts with, needs included. */
export function modulesForShopType(type: ShopTypeKey): Record<ModuleKey, boolean> {
  const on = new Set<ModuleKey>((SHOP_TYPES[type].modules as readonly ModuleKey[]).flatMap((m) => withNeeds(m)));
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, on.has(k)])) as Record<ModuleKey, boolean>;
}

/** The plain message shown when an action of a switched-off module is refused (API 403, code MODULE_OFF). */
export function moduleOffMessage(key: ModuleKey): string {
  return `${OPTIONAL_MODULES[key].label} is switched off in Settings → My modules`;
}

/** GET /modules: the company's shop type and which optional modules are on. */
export interface ModulesState {
  shopType: ShopTypeKey | null;
  modules: Record<ModuleKey, boolean>;
}

/** PATCH /modules/:key. Switching off with things still in use first answers needsConfirm with the warnings. */
export interface ModuleSwitchResult extends ModulesState {
  /** False when the owner must confirm first (nothing was changed). */
  done: boolean;
  needsConfirm: boolean;
  /** Things still in use, e.g. "3 customer orders are still open". */
  warnings: string[];
  /** Modules switched on (done) or that would be (needs, included automatically). */
  switchedOn: ModuleKey[];
  /** Modules switched off (done) or that would be (with the modules that need it). */
  switchedOff: ModuleKey[];
  message: string;
}

/** POST /modules/shop-type. Always asks first (needsConfirm) unless confirm is true; never deletes anything. */
export interface ShopTypeResult extends ModulesState {
  done: boolean;
  needsConfirm: boolean;
  type: ShopTypeKey;
  label: string;
  /** Modules this switches on and off. */
  switchOn: ModuleKey[];
  switchOff: ModuleKey[];
  /** Things still in use in the modules it switches off. */
  warnings: string[];
  /** Starting item groups and attributes created (done) or to be created (names that already exist are skipped). */
  itemGroups: string[];
  attributes: string[];
  /** Decision L1: common HSN codes added to the shop's own list. */
  hsnCodes: string[];
  message: string;
}
