// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { ModulesController } from './modules.controller.js';
import { ModulesService } from './modules.service.js';
import { ModuleGuard } from './require-module.js';

/** Plan 12: optional modules. Global so any service can check a switch and any controller can use @RequireModule. */
@Global()
@Module({
  controllers: [ModulesController],
  providers: [ModulesService, ModuleGuard],
  exports: [ModulesService, ModuleGuard],
})
export class ModulesModule {}
