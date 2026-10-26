// Copyright (c) 2026, Rademics. All rights reserved.
// When a screen crashes in someone's browser, the "Something went wrong" page
// sends a short note here so it lands in the server log (owner, 26 October
// 2026). Only a message, the page address and an error code are kept; never
// form contents.
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { RateLimit } from '../auth/rate-limit.js';
import { clientIp } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';

const clientErrorSchema = z.object({
  message: z.string().max(500),
  page: z.string().max(300),
  digest: z.string().max(100).optional(),
});
type ClientError = z.infer<typeof clientErrorSchema>;

@Controller('client-errors')
export class ClientErrorsController {
  private readonly log = new Logger('BrowserError');

  @Public()
  @RateLimit('clientError')
  @Post()
  @HttpCode(204)
  report(@Body(new ZodValidationPipe(clientErrorSchema)) input: ClientError, @Req() req: Request) {
    const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
    this.log.warn(`${clean(input.page)}: ${clean(input.message)}${input.digest ? ` (code ${clean(input.digest)})` : ''} from ${clientIp(req) ?? 'unknown address'}`);
  }
}
