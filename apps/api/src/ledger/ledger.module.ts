// Copyright (c) 2026, Rademics. All rights reserved.
// The ledger core (plan 07 §3), available everywhere so the stock engine,
// purchasing and the till post their accounting in their own transactions.
import { Global, Module } from '@nestjs/common';
import { AccountingSetup } from './accounting-setup.service.js';
import { LedgerService } from './ledger.service.js';

@Global()
@Module({
  providers: [AccountingSetup, LedgerService],
  exports: [AccountingSetup, LedgerService],
})
export class LedgerModule {}
