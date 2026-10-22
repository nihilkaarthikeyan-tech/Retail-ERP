// Copyright (c) 2026, Rademics. All rights reserved.
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { requireEnv } from '../env.js';
import { TENANT_DB_ROLE, tenantStore } from './tenancy.js';

/**
 * Plan 14: a connection pool that tells the database, on every connection it
 * hands out, which shop is asking. The connection switches to the shop role, on
 * which row-level security shows only that shop's rows. With no shop known the
 * setting is empty and the database shows nothing (fails safe).
 */
function shopPool(connectionString: string, role: string | null): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  const rawConnect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;

  async function checkout(): Promise<pg.PoolClient> {
    const client = await rawConnect();
    try {
      const companyId = await shopFor(client);
      if (role) await client.query("SELECT set_config('role', $1, false), set_config('app.company_id', $2, false)", [role, companyId]);
      else await client.query("SELECT set_config('app.company_id', $1, false)", [companyId]);
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
    return client;
  }

  // The Prisma driver calls connect() for transactions and query() for single statements.
  async function query(config: pg.QueryConfig, values?: unknown[]): Promise<pg.QueryResult> {
    const client = await checkout();
    try {
      return await client.query(config, values);
    } finally {
      client.release();
    }
  }

  return Object.assign(pool, { connect: checkout, query });
}

/**
 * The shop a connection works for: the request's or job's shop; none (sees
 * nothing) when not known. The automated tests alone (TEST_DEFAULT_SHOP=first)
 * let code they call directly, outside any request, work for the first shop.
 */
async function shopFor(client: pg.PoolClient): Promise<string> {
  const store = tenantStore();
  if (store || process.env.TEST_DEFAULT_SHOP !== 'first') return store?.companyId ?? '';
  await client.query('RESET ROLE');
  const first = await client.query<{ id: string }>('SELECT id::text AS id FROM "Company" ORDER BY "createdAt" LIMIT 1');
  return first.rows[0]?.id ?? '';
}

/** The database client for everything a shop does: sees only the current shop's rows. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(shopPool(requireEnv('DATABASE_URL'), TENANT_DB_ROLE), { disposeExternalPool: true }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Plan 14: the client for work above the shops — finding which shop an email
 * belongs to at login, signing up a new shop, listing the shops for the nightly
 * jobs and the Rademics admin screen. Sees every shop; never used for a shop's
 * own screens. A separate pool, so its lookups are never merged with a shop's.
 */
@Injectable()
export class SystemPrisma extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // In the automated tests the system client also fills in the shop of rows a test writes directly.
    const url = requireEnv('DATABASE_URL');
    super({ adapter: process.env.TEST_DEFAULT_SHOP === 'first' ? new PrismaPg(shopPool(url, null), { disposeExternalPool: true }) : new PrismaPg({ connectionString: url }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
