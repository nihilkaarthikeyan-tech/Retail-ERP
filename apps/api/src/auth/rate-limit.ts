// Copyright (c) 2026, Rademics. All rights reserved.
// Rate limits (owner, 26 October 2026): how many requests one visitor may make,
// so nobody can hammer the login, sign-up or contact form, or the API as a
// whole. A visitor is their internet address (behind Cloudflare and Nginx, the
// real one). Limits are generous enough for a whole shop sharing one address.
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { clientIp } from '../common/request-context.js';

const MINUTE = 60_000;

/** Every request to the API, per visitor: about 20 a second. */
export const GENERAL_LIMIT = { ttl: MINUTE, limit: 1200 };

/** Tighter limits on the doors a stranger can knock on. */
export const RATE_LIMITS = {
  login: { ttl: 10 * MINUTE, limit: 20 },
  signup: { ttl: 60 * MINUTE, limit: 5 },
  forgotPassword: { ttl: 15 * MINUTE, limit: 5 },
  emailLink: { ttl: 15 * MINUTE, limit: 20 },
  contactForm: { ttl: 60 * MINUTE, limit: 5 },
  clientError: { ttl: MINUTE, limit: 20 },
} as const;

export const TOO_MANY = 'Too many tries from this connection. Please wait a few minutes and try again.';

/** A tighter limit for one route. */
export const RateLimit = (name: keyof typeof RATE_LIMITS) => Throttle({ default: RATE_LIMITS[name] });

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return clientIp(req as unknown as Request) ?? 'unknown';
  }

  /** RATE_LIMIT=off switches the limits off (the automated tests make thousands of requests from one address). */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return process.env.RATE_LIMIT === 'off' || super.shouldSkip(context);
  }
}
