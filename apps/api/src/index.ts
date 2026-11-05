import { buildApp } from './app.js';
import { validateEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { BusinessRepository } from './db/repositories.js';
import { resetDemoData } from './db/seed.js';

const start = async () => {
  // Validate environment variables on startup with clear error output
  const env = validateEnv();

  // Ensure DB schema migrations run automatically and seed when database is empty
  try {
    await runMigrations();
    const bizRepo = new BusinessRepository();
    const existing = await bizRepo.get();
    if (!existing) {
      console.log('Database is empty; seeding initial demo scenario from seed/demo.json...');
      await resetDemoData();
      console.log('Initial seed completed successfully.');
    }
  } catch (dbErr) {
    console.error('Fatal database initialization error:', dbErr);
    throw dbErr;
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
