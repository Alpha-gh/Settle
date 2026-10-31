import postgres from 'postgres';
import { getTestDatabaseUrl, loadEnvFileSafe, resetCachedEnv } from '../config/env.js';
import { closeDb } from './index.js';
import { runMigrations } from './migrate.js';
import { resetDemoData } from './seed.js';

/**
 * Ensures an isolated test database (settle_test) exists,
 * configures process.env.DATABASE_URL to point to it,
 * runs migrations, and seeds the baseline scenario.
 *
 * If PostgreSQL is unreachable, fails loudly with a clear, descriptive message.
 */
export async function setupTestDatabase(): Promise<string> {
  // Ensure repo root .env is loaded
  loadEnvFileSafe({ override: false });

  const testDbUrl = getTestDatabaseUrl();
  const testUrlObj = new URL(testDbUrl);
  const testDbName = testUrlObj.pathname.replace(/^\//, '') || 'settle_test';

  // Candidate maintenance database URLs to try for database creation
  const maintDbNames = ['postgres', 'template1'];
  const baseDb = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')
    : null;
  if (baseDb && !maintDbNames.includes(baseDb)) {
    maintDbNames.push(baseDb);
  }

  let connected = false;
  let lastError: any = null;

  for (const maintDbName of maintDbNames) {
    const maintUrlObj = new URL(testDbUrl);
    maintUrlObj.pathname = `/${maintDbName}`;
    const maintenanceUrl = maintUrlObj.toString();

    let maintSql: postgres.Sql | null = null;
    try {
      maintSql = postgres(maintenanceUrl, {
        max: 1,
        connect_timeout: 5,
        idle_timeout: 5,
      });

      // Verify connection and check if test database exists
      const existing = await maintSql.unsafe(
        `SELECT 1 FROM pg_database WHERE datname = '${testDbName.replace(/'/g, "''")}'`
      );

      if (existing.length === 0) {
        await maintSql.unsafe(`CREATE DATABASE "${testDbName}"`);
      }

      connected = true;
      await maintSql.end();
      break;
    } catch (err: any) {
      lastError = err;
      if (maintSql) {
        try {
          await maintSql.end();
        } catch {
          // ignore
        }
      }
      // If error is ECONNREFUSED / ETIMEDOUT / EACCES, server is unreachable, don't bother trying other db names
      if (
        err?.code === 'ECONNREFUSED' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'EACCES' ||
        err?.errors?.[0]?.code === 'ECONNREFUSED'
      ) {
        break;
      }
    }
  }

  if (!connected) {
    const errorMsg = [
      '',
      '================================================================================',
      '🚨 FATAL TEST DATABASE ERROR: PostgreSQL database is unreachable!',
      '--------------------------------------------------------------------------------',
      `Target Test DB URL: ${testDbUrl}`,
      `Host / Port:        ${testUrlObj.host}`,
      `Database Name:      ${testDbName}`,
      `Underlying Error:   ${lastError?.message || String(lastError)}`,
      '',
      'Please ensure PostgreSQL is running and accessible at the host/port configured',
      'in your repo-root .env (e.g. DATABASE_URL or TEST_DATABASE_URL).',
      '================================================================================',
      '',
    ].join('\n');

    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Switch process.env.DATABASE_URL to the verified test database
  process.env.DATABASE_URL = testDbUrl;
  resetCachedEnv();
  await closeDb();

  // Run schema migrations and seed initial demo dataset in settle_test
  try {
    await runMigrations();
    await resetDemoData();
  } catch (migErr: any) {
    const migErrorMsg = [
      '',
      '================================================================================',
      '🚨 FATAL TEST MIGRATION ERROR: Failed to run migrations on test database!',
      '--------------------------------------------------------------------------------',
      `Database URL:     ${testDbUrl}`,
      `Migration Error:  ${migErr?.message || String(migErr)}`,
      '================================================================================',
      '',
    ].join('\n');
    console.error(migErrorMsg);
    throw new Error(migErrorMsg);
  }

  return testDbUrl;
}

