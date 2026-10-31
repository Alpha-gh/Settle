import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { getEnv } from '../config/env.js';

let sqlClient: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!dbInstance) {
    const env = getEnv();
    sqlClient = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
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

