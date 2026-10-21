// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 rule 2: before a module is switched off, the owner is told what is
// still in use (for example "3 customer orders are still open"). Switching off
// only hides; nothing listed here is changed or deleted.
import { businessDate, type ModuleKey } from 'shared';
import type { Db } from '../audit/audit.service.js';

/** "1 customer order is still open" / "3 customer orders are still open"; nothing for zero. */
function say(n: number, one: string, many: string): string[] {
  if (n <= 0) return [];
  return [`${n} ${n === 1 ? one : many}`];
}

const today = () => new Date(`${businessDate()}T00:00:00Z`);

/** What is still in use in one module of the company. */
export async function moduleWarnings(db: Db, companyId: string, key: ModuleKey): Promise<string[]> {
  switch (key) {
    case 'variants':
      return say(
        await db.item.count({ where: { isParentStyle: true, active: true } }),
        'style has sizes and colours (its variants still sell as ordinary items)',
        'styles have sizes and colours (their variants still sell as ordinary items)',
      );
    case 'batches':
      return say(await db.item.count({ where: { trackBatches: true, active: true } }), 'item is tracked by batch', 'items are tracked by batch');
    case 'serials':
      return say(await db.item.count({ where: { trackSerials: true, active: true } }), 'item is tracked by serial number', 'items are tracked by serial number');
    case 'seasons':
      return [
        ...say(await db.season.count({ where: { companyId, active: true } }), 'season is in use', 'seasons are in use'),
        ...say(await db.item.count({ where: { seasonId: { not: null }, active: true } }), 'item has a season', 'items have a season'),
      ];
    case 'purchase_orders':
      return say(
        await db.purchaseOrder.count({ where: { companyId, status: { in: ['draft', 'to_receive_and_bill', 'to_receive', 'to_bill', 'on_hold'] } } }),
        'purchase order is still open',
        'purchase orders are still open',
      );
    case 'consignment': {
      const rows = await db.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT r.id)::int AS n
        FROM "GoodsReceiptLine" l JOIN "GoodsReceipt" r ON r.id = l."receiptId"
        WHERE r."companyId" = ${companyId}::uuid AND r."isConsignment" AND NOT r."isReturn"
          AND r.status NOT IN ('draft', 'cancelled')
          AND l."basicAcceptedQuantity" - l."billedQuantity" - l."returnedAcceptedQuantity" > 0`;
      return [
        ...say(rows[0]?.n ?? 0, 'sale-or-return receipt still has goods not settled with the supplier', 'sale-or-return receipts still have goods not settled with the supplier'),
        ...say(await db.consignmentStatement.count({ where: { companyId, status: 'draft' } }), 'sale-or-return statement is still a draft', 'sale-or-return statements are still drafts'),
      ];
    }
    case 'transfers': {
      const sends = await db.stockDocument.findMany({
        where: { companyId, kind: 'transfer_send', status: 'finalised' },
        select: { lines: { select: { basicQuantity: true, receivedQuantity: true } } },
      });
      const inTransit = sends.filter((s) => s.lines.some((l) => l.receivedQuantity.lt(l.basicQuantity))).length;
      return [
        ...say(inTransit, 'transfer is still in transit', 'transfers are still in transit'),
        ...say(await db.stockDocument.count({ where: { companyId, kind: 'transfer_send', status: 'draft' } }), 'transfer is still a draft', 'transfers are still drafts'),
      ];
    }
    case 'customer_orders':
      return say(await db.customerOrder.count({ where: { companyId, status: { in: ['open', 'ready'] } } }), 'customer order is still open', 'customer orders are still open');
    case 'alterations':
      return say(
        await db.alterationJob.count({ where: { companyId, status: { in: ['received', 'with_tailor', 'ready'] } } }),
        'alteration job is still open',
        'alteration jobs are still open',
      );
    case 'delivery':
      return say(await db.posDelivery.count({ where: { companyId, status: 'pending' } }), 'home delivery is still pending', 'home deliveries are still pending');
    case 'salesperson':
      return say(await db.salesStaff.count({ where: { companyId, active: true } }), 'salesperson is set up', 'salespeople are set up');
    case 'offers': {
      const running = { OR: [{ endDate: null }, { endDate: { gte: today() } }] };
      return [
        ...say(await db.offer.count({ where: { companyId, active: true, ...running } }), 'offer is running (it stops applying at the till)', 'offers are running (they stop applying at the till)'),
        ...say(await db.coupon.count({ where: { companyId, ...running } }), 'coupon can still be used', 'coupons can still be used'),
      ];
    }
    case 'credit_sales':
      return say(await db.customer.count({ where: { companyId, creditLimit: { gt: 0 } } }), 'customer has a credit limit', 'customers have a credit limit');
    case 'einvoice':
      return say(await db.eInvoice.count({ where: { companyId, status: { in: ['waiting', 'failed'] } } }), 'e-invoice is still waiting', 'e-invoices are still waiting');
    case 'eway':
      return say(await db.eWayBill.count({ where: { companyId, status: 'draft' } }), 'e-way bill is still a draft', 'e-way bills are still drafts');
    case 'expenses':
    case 'tally':
      // Expenses are already in the accounts; the Tally export only reads them.
      return [];
    case 'loyalty': {
      const points = await db.loyaltyEntry.aggregate({ where: { companyId }, _sum: { points: true } });
      return say(points._sum.points ?? 0, 'loyalty point is still unspent', 'loyalty points are still unspent');
    }
    case 'gift_cards':
      return say(await db.giftCard.count({ where: { companyId, status: 'active', balance: { gt: 0 } } }), 'gift card still has money on it', 'gift cards still have money on them');
  }
}
