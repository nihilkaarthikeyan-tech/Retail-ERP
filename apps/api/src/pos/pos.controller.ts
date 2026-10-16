// Copyright (c) 2026, Rademics. All rights reserved.
// Point-of-sale endpoints (plan 06 §7). Rights are checked here and store
// rights and the registered till computer inside the services (rule 11).
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type ApprovalInput,
  approvalSchema,
  type CancelBillInput,
  cancelBillSchema,
  type CashMovementInput,
  cashMovementSchema,
  type CloseShiftInput,
  closeShiftSchema,
  type CouponInput,
  couponSchema,
  type GstRateInput,
  gstRateSchema,
  type OfferInput,
  offerSchema,
  type OpenShiftInput,
  openShiftSchema,
  type PaymentMethodInput,
  paymentMethodSchema,
  type PosBillQuery,
  posBillQuerySchema,
  type PosReportQuery,
  posReportQuerySchema,
  type PosSettingsInput,
  posSettingsSchema,
  type PosTransactionInput,
  posTransactionSchema,
  type ReasonInput,
  reasonSchema,
  type RegisterDeviceInput,
  registerDeviceSchema,
  type SetPinInput,
  setPinSchema,
  type SwitchCashierInput,
  switchCashierSchema,
  type TillInput,
  tillSchema,
  type UpdatePaymentMethodInput,
  updatePaymentMethodSchema,
  type UpdateTillInput,
  updateTillSchema,
} from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { OffersService } from './offers.service.js';
import { PinService } from './pin.service.js';
import { PosBillsService } from './pos-bills.service.js';
import { TILL_TOKEN_HEADER } from './pos-common.service.js';
import { PosReportsService } from './pos-reports.service.js';
import { PosSetupService } from './pos-setup.service.js';
import { PosSnapshotService } from './pos-snapshot.service.js';
import { ShiftsService } from './shifts.service.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller('pos')
export class PosController {
  constructor(
    private readonly setup: PosSetupService,
    private readonly pins: PinService,
    private readonly offers: OffersService,
    private readonly shifts: ShiftsService,
    private readonly bills: PosBillsService,
    private readonly snapshots: PosSnapshotService,
    private readonly reports: PosReportsService,
  ) {}

  // ---- GST rate list ----
  @Get('gst-rates') @RequireAnyPermission('gst_rates.manage', 'pos.setup', 'pos.sell') gstRates() {
    return this.setup.listGstRates();
  }
  @Post('gst-rates') @RequirePermission('gst_rates.manage') createGstRate(@Body(zod(gstRateSchema)) input: GstRateInput, @ReqActor() actor: Actor) {
    return this.setup.createGstRate(input, actor);
  }
  @Patch('gst-rates/:id') @RequirePermission('gst_rates.manage') updateGstRate(@Param('id', id()) rateId: string, @Body(zod(gstRateSchema.partial())) input: Partial<GstRateInput>, @ReqActor() actor: Actor) {
    return this.setup.updateGstRate(rateId, input, actor);
  }
  @Post('gst-rates/:id/approve') @HttpCode(200) @RequirePermission('gst_rates.approve') approveGstRate(@Param('id', id()) rateId: string, @ReqActor() actor: Actor) {
    return this.setup.approveGstRate(rateId, actor);
  }

  // ---- Payment methods, tills, settings ----
  @Get('payment-methods') @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') paymentMethods() {
    return this.setup.listPaymentMethods();
  }
  @Post('payment-methods') @RequirePermission('pos.setup') createPaymentMethod(@Body(zod(paymentMethodSchema)) input: PaymentMethodInput, @ReqActor() actor: Actor) {
    return this.setup.createPaymentMethod(input, actor);
  }
  @Patch('payment-methods/:id') @RequirePermission('pos.setup') updatePaymentMethod(@Param('id', id()) methodId: string, @Body(zod(updatePaymentMethodSchema)) input: UpdatePaymentMethodInput, @ReqActor() actor: Actor) {
    return this.setup.updatePaymentMethod(methodId, input, actor);
  }
  @Get('tills') @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') tills(@ReqUser() user: AuthUser) {
    return this.setup.listTills(user);
  }
  @Post('tills') @RequirePermission('pos.setup') createTill(@Body(zod(tillSchema)) input: TillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.setup.createTill(input, actor, user);
  }
  @Get('tills/:id') @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') till(@Param('id', id()) tillId: string, @ReqUser() user: AuthUser) {
    return this.setup.getTill(tillId, user);
  }
  @Patch('tills/:id') @RequirePermission('pos.setup') updateTill(@Param('id', id()) tillId: string, @Body(zod(updateTillSchema)) input: UpdateTillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.setup.updateTill(tillId, input, actor, user);
  }
  @Post('tills/:id/register') @RequirePermission('pos.setup') register(@Param('id', id()) tillId: string, @Body(zod(registerDeviceSchema)) input: RegisterDeviceInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.setup.registerDevice(tillId, input, actor, user);
  }
  @Get('settings') @RequireAnyPermission('pos.setup', 'pos.sell', 'pos.reports') settings() {
    return this.setup.getSettings();
  }
  @Patch('settings') @RequirePermission('pos.setup') updateSettings(@Body(zod(posSettingsSchema)) input: PosSettingsInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.setup.updateSettings(input, actor, user);
  }

  // ---- PINs, approvals, cashier switching ----
  @Post('pin') @HttpCode(200) @RequireAnyPermission('pos.sell', 'pos.approve') setPin(@Body(zod(setPinSchema)) input: SetPinInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.pins.setOwnPin(input, actor, user);
  }
  @Get('pin') @RequireAnyPermission('pos.sell', 'pos.approve') hasPin(@ReqUser() user: AuthUser) {
    return this.pins.hasPin(user.id);
  }
  @Delete('pins/:userId') @RequirePermission('pos.shift.manage') clearPin(@Param('userId', id()) userId: string, @ReqActor() actor: Actor) {
    return this.pins.clearPin(userId, actor);
  }
  @Get('tills/:id/people') @RequirePermission('pos.sell') people(@Param('id', id()) tillId: string, @ReqUser() user: AuthUser) {
    return this.pins.approvers(tillId, user);
  }
  @Post('approvals') @HttpCode(200) @RequirePermission('pos.sell') approve(@Body(zod(approvalSchema)) input: ApprovalInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.pins.approve(input, actor, user);
  }
  @Post('switch-cashier') @HttpCode(200) @RequirePermission('pos.sell') switchCashier(@Body(zod(switchCashierSchema)) input: SwitchCashierInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.pins.switchCashier(input, actor, user);
  }

  // ---- Offers and coupons ----
  @Get('offers') @RequireAnyPermission('offers.manage', 'pos.sell') listOffers() {
    return this.offers.list();
  }
  @Post('offers') @RequirePermission('offers.manage') createOffer(@Body(zod(offerSchema)) input: OfferInput, @ReqActor() actor: Actor) {
    return this.offers.createOffer(input, actor);
  }
  @Patch('offers/:id') @RequirePermission('offers.manage') updateOffer(@Param('id', id()) offerId: string, @Body(zod(offerSchema)) input: OfferInput, @ReqActor() actor: Actor) {
    return this.offers.updateOffer(offerId, input, actor);
  }
  @Post('coupons') @RequirePermission('offers.manage') createCoupon(@Body(zod(couponSchema)) input: CouponInput, @ReqActor() actor: Actor) {
    return this.offers.createCoupon(input, actor);
  }

  // ---- The till itself (needs the registered computer's token) ----
  @Get('till/:id/snapshot') @RequirePermission('pos.sell') snapshot(@Param('id', id()) tillId: string, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string, @Query('since') since?: string) {
    return this.snapshots.snapshot(tillId, since || undefined, user, token);
  }
  @Get('till/:id/shift') @RequirePermission('pos.sell') currentShift(@Param('id', id()) tillId: string, @ReqUser() user: AuthUser) {
    return this.shifts.current(tillId, user);
  }
  @Post('shifts') @RequirePermission('pos.sell') openShift(@Body(zod(openShiftSchema)) input: OpenShiftInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.shifts.open(input, actor, user, token);
  }
  @Get('shifts/:id') @RequireAnyPermission('pos.sell', 'pos.reports') shift(@Param('id', id()) shiftId: string, @ReqUser() user: AuthUser) {
    return this.shifts.get(shiftId, user);
  }
  @Post('shifts/:id/cash-movements') @RequirePermission('pos.sell') cashMovement(@Param('id', id()) shiftId: string, @Body(zod(cashMovementSchema)) input: CashMovementInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.shifts.cashMovement(shiftId, input, actor, user, token);
  }
  @Post('shifts/:id/close') @HttpCode(200) @RequirePermission('pos.close') closeShift(@Param('id', id()) shiftId: string, @Body(zod(closeShiftSchema)) input: CloseShiftInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.shifts.close(shiftId, input, actor, user, token);
  }
  @Post('shifts/:id/cancel') @HttpCode(200) @RequirePermission('pos.shift.manage') cancelShift(@Param('id', id()) shiftId: string, @Body(zod(reasonSchema)) input: ReasonInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.shifts.cancel(shiftId, input.reason, actor, user);
  }
  @Post('bills') @RequirePermission('pos.sell') postBill(@Body(zod(posTransactionSchema)) input: PosTransactionInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser, @Headers(TILL_TOKEN_HEADER) token?: string) {
    return this.bills.post(input, actor, user, token);
  }
  @Get('bills') @RequireAnyPermission('pos.sell', 'pos.reports') listBills(@Query(zod(posBillQuerySchema)) q: PosBillQuery, @ReqUser() user: AuthUser) {
    return this.bills.list(q, user);
  }
  @Get('bills/:id') @RequireAnyPermission('pos.sell', 'pos.reports') getBill(@Param('id', id()) billId: string, @ReqUser() user: AuthUser) {
    return this.bills.get(billId, user);
  }
  @Post('bills/:id/cancel') @HttpCode(200) @RequirePermission('pos.sell') cancelBill(@Param('id', id()) billId: string, @Body(zod(cancelBillSchema)) input: CancelBillInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.cancel(billId, input.reason, input.approvalToken, actor, user);
  }
  @Post('bills/:id/reprint') @HttpCode(200) @RequirePermission('pos.sell') reprint(@Param('id', id()) billId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.bills.reprint(billId, actor, user);
  }

  // ---- Reports ----
  @Get('reports/register') @RequirePermission('pos.reports') registerReport(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.register(q, user);
  }
  @Get('reports/payments') @RequirePermission('pos.reports') paymentsReport(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.payments(q, user);
  }
  @Get('reports/hourly') @RequirePermission('pos.reports') hourly(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.hourly(q, user);
  }
  @Get('reports/by-cashier') @RequirePermission('pos.reports') byCashier(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.byCashier(q, user);
  }
  @Get('reports/shifts') @RequirePermission('pos.reports') shiftsReport(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.shifts(q, user);
  }
  @Get('reports/offline-check') @RequirePermission('pos.reports') offlineCheck(@Query(zod(posReportQuerySchema)) q: PosReportQuery, @ReqUser() user: AuthUser) {
    return this.reports.offlineCheck(q, user);
  }
  @Get('reports/sync-problems') @RequirePermission('pos.reports') syncProblems(@ReqUser() user: AuthUser, @Query('all') all?: string) {
    return this.reports.syncProblems(user, all === 'true');
  }
  @Post('sync-problems/:id/resolve') @HttpCode(200) @RequirePermission('pos.shift.manage') resolve(@Param('id', id()) problemId: string, @Body(zod(reasonSchema)) input: ReasonInput, @ReqUser() user: AuthUser) {
    return this.reports.resolveSyncProblem(problemId, input.reason, user.id);
  }
}
