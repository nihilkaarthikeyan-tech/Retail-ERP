// Copyright (c) 2026, Rademics. All rights reserved.
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailLinksService } from './email-links.service.js';
import { MailerService } from '../reports/mailer.service.js';
import { PermissionGuard } from './permission.guard.js';
import { GENERAL_LIMIT, RateLimitGuard, TOO_MANY } from './rate-limit.js';
import { SessionGuard } from './session.guard.js';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [GENERAL_LIMIT], errorMessage: TOO_MANY })],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailLinksService,
    MailerService,
    // Order matters: rate limits first (before any database work), then the session
    // guard attaches the user, then the permission guard reads it.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, EmailLinksService],
})
export class AuthModule {}
