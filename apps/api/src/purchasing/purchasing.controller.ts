// Copyright (c) 2026, Rademics. All rights reserved.
// Purchasing endpoints (plan 05 §7). Every route checks a permission here and
// the store rights inside the service (rule 11).
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateGoodsReceiptInput,
  createGoodsReceiptSchema,
  type CreateOrdersFromSuggestionsInput,
  createOrdersFromSuggestionsSchema,
  type CreatePurchaseOrderInput,
  createPurchaseOrderSchema,
  type CreateSupplierBillInput,
  createSupplierBillSchema,
  type DebitNoteInput,
  debitNoteSchema,
  type FinaliseBillInput,
  finaliseBillSchema,
  type GoodsReceiptQuery,
  goodsReceiptQuerySchema,
  type HoldBillInput,
  holdBillSchema,
  type LandedChargeInput,
  landedChargeSchema,
  type PurchaseOrderQuery,
  purchaseOrderQuerySchema,
  type PurchaseReportQuery,
  purchaseReportQuerySchema,
  type PurchaseReturnInput,
  purchaseReturnSchema,
  type PurchaseSettingsInput,
  purchaseSettingsSchema,
  type ReasonInput,
  reasonSchema,
  type ReceiptCheckInput,
  receiptCheckSchema,
  type SupplierBillQuery,
  supplierBillQuerySchema,
  type UpdateGoodsReceiptInput,
  updateGoodsReceiptSchema,
  type UpdatePurchaseOrderInput,
  updatePurchaseOrderSchema,
  type UpdateSupplierBillInput,
  updateSupplierBillSchema,
} from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { LandedChargesService } from './landed-charges.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseReportsService } from './purchase-reports.service.js';
import { PurchaseSettingsService } from './purchase-settings.service.js';
import { ReorderService } from './reorder.service.js';
import { SupplierBillsService } from './supplier-bills.service.js';

const id = () => new ParseUUIDPipe();
const reason = () => new ZodValidationPipe(reasonSchema);

@Controller('purchase')
export class PurchasingController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
    private readonly bills: SupplierBillsService,
    private readonly charges: LandedChargesService,
    private readonly reorder: ReorderService,
    private readonly reports: PurchaseReportsService,
    private readonly settings: PurchaseSettingsService,
  ) {}

  // ---- Purchase orders ----
  @Get('orders') @RequirePermission('purchase.view') listOrders(@Query(new ZodValidationPipe(purchaseOrderQuerySchema)) q: PurchaseOrderQuery, @ReqUser() user: AuthUser) {
    return this.orders.list(q, user);
  }
  @Post('orders') @RequirePermission('purchase.order') createOrder(@Body(new ZodValidationPipe(createPurchaseOrderSchema)) input: CreatePurchaseOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.create(input, actor, user);
  }
  @Get('orders/:id') @RequirePermission('purchase.view') getOrder(@Param('id', id()) orderId: string, @ReqUser() user: AuthUser) {
    return this.orders.get(orderId, user);
  }
  @Get('orders/:id/open-lines') @RequirePermission('purchase.view') openLines(@Param('id', id()) orderId: string, @ReqUser() user: AuthUser) {
    return this.orders.openLines(orderId, user);
  }
  @Patch('orders/:id') @RequirePermission('purchase.order') updateOrder(@Param('id', id()) orderId: string, @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) input: UpdatePurchaseOrderInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.update(orderId, input, actor, user);
  }
  @Post('orders/:id/finalise') @HttpCode(200) @RequirePermission('purchase.order') finaliseOrder(@Param('id', id()) orderId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.finalise(orderId, actor, user);
  }
  @Post('orders/:id/hold') @HttpCode(200) @RequirePermission('purchase.approve') holdOrder(@Param('id', id()) orderId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.hold(orderId, input.reason, actor, user);
  }
  @Post('orders/:id/release') @HttpCode(200) @RequirePermission('purchase.approve') releaseOrder(@Param('id', id()) orderId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.release(orderId, actor, user);
  }
  @Post('orders/:id/close') @HttpCode(200) @RequirePermission('purchase.approve') closeOrder(@Param('id', id()) orderId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.close(orderId, input.reason, actor, user);
  }
  @Post('orders/:id/reopen') @HttpCode(200) @RequirePermission('purchase.approve') reopenOrder(@Param('id', id()) orderId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.reopen(orderId, actor, user);
  }
  @Post('orders/:id/cancel') @HttpCode(200) @RequirePermission('purchase.order') cancelOrder(@Param('id', id()) orderId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.orders.cancel(orderId, input.reason, actor, user);
  }

  // ---- Goods receipts and returns ----
  @Get('receipts') @RequirePermission('purchase.view') listReceipts(@Query(new ZodValidationPipe(goodsReceiptQuerySchema)) q: GoodsReceiptQuery, @ReqUser() user: AuthUser) {
    return this.receipts.list(q, user);
  }
  @Post('receipts') @RequirePermission('purchase.receive') createReceipt(@Body(new ZodValidationPipe(createGoodsReceiptSchema)) input: CreateGoodsReceiptInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.create(input, actor, user);
  }
  @Get('receipts/:id') @RequirePermission('purchase.view') getReceipt(@Param('id', id()) receiptId: string, @ReqUser() user: AuthUser) {
    return this.receipts.get(receiptId, user);
  }
  @Patch('receipts/:id') @RequirePermission('purchase.receive') updateReceipt(@Param('id', id()) receiptId: string, @Body(new ZodValidationPipe(updateGoodsReceiptSchema)) input: UpdateGoodsReceiptInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.update(receiptId, input, actor, user);
  }
  @Post('receipts/:id/finalise') @HttpCode(200) @RequirePermission('purchase.receive') finaliseReceipt(@Param('id', id()) receiptId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.finalise(receiptId, actor, user);
  }
  @Post('receipts/:id/check') @HttpCode(200) @RequirePermission('purchase.receive') checkReceipt(@Param('id', id()) receiptId: string, @Body(new ZodValidationPipe(receiptCheckSchema)) input: ReceiptCheckInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.check(receiptId, input, actor, user);
  }
  @Post('receipts/:id/close') @HttpCode(200) @RequirePermission('purchase.bill') closeReceipt(@Param('id', id()) receiptId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.close(receiptId, input.reason, actor, user);
  }
  @Post('receipts/:id/cancel') @HttpCode(200) @RequireAnyPermission('purchase.receive', 'purchase.return') cancelReceipt(@Param('id', id()) receiptId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.cancel(receiptId, input.reason, actor, user);
  }
  @Post('receipts/:id/return') @RequirePermission('purchase.return') returnGoods(@Param('id', id()) receiptId: string, @Body(new ZodValidationPipe(purchaseReturnSchema)) input: PurchaseReturnInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.receipts.createReturn(receiptId, input, actor, user);
  }

  // ---- Supplier bills and debit notes ----
  @Get('bills') @RequirePermission('purchase.view') listBills(@Query(new ZodValidationPipe(supplierBillQuerySchema)) q: SupplierBillQuery, @ReqUser() user: AuthUser) {
    return this.bills.list(q, user);
  }
  @Post('bills') @RequirePermission('purchase.bill') createBill(@Body(new ZodValidationPipe(createSupplierBillSchema)) input: CreateSupplierBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.create(input, actor, user);
  }
  @Get('bills/:id') @RequirePermission('purchase.view') getBill(@Param('id', id()) billId: string, @ReqUser() user: AuthUser) {
    return this.bills.get(billId, user);
  }
  @Patch('bills/:id') @RequirePermission('purchase.bill') updateBill(@Param('id', id()) billId: string, @Body(new ZodValidationPipe(updateSupplierBillSchema)) input: UpdateSupplierBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.update(billId, input, actor, user);
  }
  @Post('bills/:id/finalise') @HttpCode(200) @RequirePermission('purchase.bill') finaliseBill(@Param('id', id()) billId: string, @Body(new ZodValidationPipe(finaliseBillSchema)) input: FinaliseBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.finalise(billId, input, actor, user);
  }
  @Post('bills/:id/cancel') @HttpCode(200) @RequireAnyPermission('purchase.bill', 'purchase.return') cancelBill(@Param('id', id()) billId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.cancel(billId, input.reason, actor, user);
  }
  @Post('bills/:id/hold') @HttpCode(200) @RequirePermission('purchase.bill') holdBill(@Param('id', id()) billId: string, @Body(new ZodValidationPipe(holdBillSchema)) input: HoldBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.hold(billId, input, actor, user);
  }
  @Post('bills/:id/release') @HttpCode(200) @RequirePermission('purchase.bill') releaseBill(@Param('id', id()) billId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.release(billId, actor, user);
  }
  @Post('bills/:id/debit-note') @RequirePermission('purchase.return') debitNote(@Param('id', id()) billId: string, @Body(new ZodValidationPipe(debitNoteSchema)) input: DebitNoteInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.debitNote(billId, input, actor, user);
  }

  // ---- Extra charges on goods received ----
  @Get('charges') @RequirePermission('purchase.view') listCharges(@ReqUser() user: AuthUser) {
    return this.charges.list(user);
  }
  @Post('charges/preview') @HttpCode(200) @RequirePermission('purchase.charges') previewCharges(@Body(new ZodValidationPipe(landedChargeSchema)) input: LandedChargeInput, @ReqUser() user: AuthUser) {
    return this.charges.preview(input, user);
  }
  @Post('charges') @RequirePermission('purchase.charges') createCharge(@Body(new ZodValidationPipe(landedChargeSchema)) input: LandedChargeInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.charges.create(input, actor, user);
  }
  @Get('charges/:id') @RequirePermission('purchase.view') getCharge(@Param('id', id()) chargeId: string, @ReqUser() user: AuthUser) {
    return this.charges.get(chargeId, user);
  }
  @Post('charges/:id/finalise') @HttpCode(200) @RequirePermission('purchase.charges') finaliseCharge(@Param('id', id()) chargeId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.charges.finalise(chargeId, actor, user);
  }
  @Post('charges/:id/cancel') @HttpCode(200) @RequirePermission('purchase.charges') cancelCharge(@Param('id', id()) chargeId: string, @Body(reason()) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.charges.cancel(chargeId, input.reason, actor, user);
  }

  // ---- Reorder suggestions ----
  @Get('reorder-suggestions') @RequirePermission('purchase.view') suggestions(@ReqUser() user: AuthUser, @Query('storeId') storeId?: string) {
    return this.reorder.list(storeId || undefined, user);
  }
  @Post('reorder-suggestions/run') @HttpCode(200) @RequirePermission('purchase.order') runSuggestions(@ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.reorder.runNow(actor, user);
  }
  @Post('reorder-suggestions/create-orders') @RequirePermission('purchase.order') ordersFromSuggestions(@Body(new ZodValidationPipe(createOrdersFromSuggestionsSchema)) input: CreateOrdersFromSuggestionsInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.reorder.createOrders(input, actor, user);
  }

  // ---- Reports and settings ----
  @Get('reports/order-follow-up') @RequirePermission('purchase.view') followUp(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.orderFollowUp(q, user);
  }
  @Get('reports/received-not-billed') @RequirePermission('purchase.view') notBilled(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.receivedNotBilled(q, user);
  }
  @Get('reports/register') @RequirePermission('purchase.view') register(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.register(q, user);
  }
  @Get('reports/by-supplier') @RequirePermission('purchase.view') bySupplier(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.bySupplier(q, user);
  }
  @Get('reports/by-item') @RequirePermission('purchase.view') byItem(@Query(new ZodValidationPipe(purchaseReportQuerySchema)) q: PurchaseReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.byItem(q, user);
  }
  @Get('settings') @RequirePermission('purchase.view') getSettings() {
    return this.settings.get();
  }
  @Patch('settings') @RequirePermission('purchase.settings') updateSettings(@Body(new ZodValidationPipe(purchaseSettingsSchema)) input: PurchaseSettingsInput, @ReqActor() actor: Actor) {
    return this.settings.update(input, actor);
  }
}
