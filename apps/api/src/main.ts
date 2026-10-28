// Copyright (c) 2026, Rademics. All rights reserved.
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { loadRootEnv } from './env.js';

loadRootEnv();
// Imported after the environment is loaded, because modules read it.
const { AppModule } = await import('./app.module.js');

/** JSON bodies up to 1 MB: item pictures (≤ 500 KB) travel base64-encoded. */
export const JSON_BODY_LIMIT = '1mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // JSON only (audit 1, 28 October 2026): no form-style bodies, which the app never sends.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Audit 1: the API's own answers carry the basic security headers (the web pages get theirs from next.config.ts).
  app.disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });
  // On the server the API sits behind Nginx: trust it for the visitor's address
  // (login history, audit log). Unset in development.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim()),
    credentials: true,
    // Lets the browser read the file name of downloads (templates, exports, failed rows).
    exposedHeaders: ['Content-Disposition'],
  });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  new Logger('Main').log(`API listening on port ${port}`);
}
await bootstrap();
