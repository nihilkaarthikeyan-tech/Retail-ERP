// Copyright (c) 2026, Rademics. All rights reserved.
// Purchase settings per company (blueprint 07 "Settings"; plan 05 answers 3, 4, 7).
import { Injectable } from '@nestjs/common';
import type { PurchaseSettingsInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { PurchaseSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PurchaseCommon } from './purchase-common.service.js';

@Injectable()
export class PurchaseSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PurchaseCommon,
  ) {}

  async get() {
    const company = await this.common.currentCompany();
    return toDto(await this.common.settings(this.prisma, company.id));
  }

  async update(input: PurchaseSettingsInput, actor: Actor) {
    const company = await this.common.currentCompany();
    return this.prisma.$transaction(async (tx) => {
      const before = await this.common.settings(tx, company.id);
      const after = await tx.purchaseSettings.update({ where: { companyId: company.id }, data: { ...input, updatedById: actor.userId } });
      await this.audit.recordUpdate(tx, actor, 'purchase_settings', company.id, toDto(before), toDto(after));
      return toDto(after);
    });
  }
}

function toDto(s: PurchaseSettings) {
  return {
    requireOrderForReceipt: s.requireOrderForReceipt,
    billNeedsOrder: s.billNeedsOrder,
    billNeedsReceipt: s.billNeedsReceipt,
    overOrderPercent: s.overOrderPercent.toString(),
    overReceiptPercent: s.overReceiptPercent.toString(),
    overBillingPercent: s.overBillingPercent.toString(),
    priceMismatch: s.priceMismatch,
    checkSupplierBillNo: s.checkSupplierBillNo,
    approvalLimit: s.approvalLimit.toFixed(2),
    fillLastPurchasePrice: s.fillLastPurchasePrice,
  };
}
