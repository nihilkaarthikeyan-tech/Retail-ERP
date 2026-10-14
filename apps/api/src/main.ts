// Copyright (c) 2026, Rademics. All rights reserved.
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from './env.js';

loadRootEnv();
// Imported after the environment is loaded, because modules read it.
const { AppModule } = await import('./app.module.js');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
  });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
await bootstrap();
