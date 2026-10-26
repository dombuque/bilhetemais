import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { createDb, ensureDatabaseExists } from '../src/db';

export async function migrate(database: string, schema?: string) {
  await ensureDatabaseExists(database);
  const db = createDb(database, schema);
  try {
    if (schema) await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f])).rows.length) continue;
      await db.transaction(async (tx) => {
        await tx.query(readFileSync(new URL(f, dir), 'utf8'));
        await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]);
      });
      console.log('aplicada', f);
    }
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate(process.env.PG_DATABASE ?? 'bilheteplus');
  console.log('Migrações concluídas.');
}
