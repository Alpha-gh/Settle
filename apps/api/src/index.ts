import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { BusinessRepository } from './db/repositories.js';
import { resetDemoData } from './db/seed.js';

const start = async () => {
  const env = getEnv();

  // Ensure DB schema and seed data exist
  try {
    await runMigrations();
    const bizRepo = new BusinessRepository();
    const existing = await bizRepo.get();
    if (!existing) {
      await resetDemoData();
    }
  } catch (dbErr) {
    console.error('Warning: Database initialization error:', dbErr);
  }

  const app = await buildApp();
  const port = env.PORT;
  const host = env.HOST;

  await app.listen({ port, host });
  console.log(`Server listening at http://${host}:${port}`);
};

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
