import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { getEnv } from '../config/env.js';

let sqlClient: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPostgresOptions(databaseUrl: string): postgres.Options<any> {
  const isSslRequested =
    /[?&]ssl(mode)?=(require|true|prefer)/i.test(databaseUrl) ||
    databaseUrl.includes('render.com') ||
    databaseUrl.includes('neon.tech') ||
    databaseUrl.includes('supabase.co');

  const options: postgres.Options<any> = {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  };

  if (isSslRequested) {
    options.ssl = { rejectUnauthorized: false };
  }

  return options;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!dbInstance) {
    const env = getEnv();
    const options = getPostgresOptions(env.DATABASE_URL);
    sqlClient = postgres(env.DATABASE_URL, options);
    dbInstance = drizzle(sqlClient, { schema });
  }
  return dbInstance;
}

export function getRawSql(): postgres.Sql {
  if (!sqlClient) {
    getDb();
  }
  return sqlClient!;
}

export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
    dbInstance = null;
  }
}
