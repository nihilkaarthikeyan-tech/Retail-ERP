// Copyright (c) 2026, Rademics. All rights reserved.
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
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
await bootstrap();
