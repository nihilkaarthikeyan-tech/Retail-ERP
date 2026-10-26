// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailLinksService } from './email-links.service.js';
import { MailerService } from '../reports/mailer.service.js';
import { PermissionGuard } from './permission.guard.js';
import { SessionGuard } from './session.guard.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailLinksService,
    MailerService,
    // Order matters: the session guard attaches the user, the permission guard reads it.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, EmailLinksService],
})
export class AuthModule {}
