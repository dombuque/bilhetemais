import 'dotenv/config';
import pg from 'pg';
import type { Db, Tx } from './wallet';

const { Client, Pool, types } = pg;
// BIGINT (int8) como string; o dominio usa bigint em centavos e converte explicitamente.
types.setTypeParser(20, (v) => v);

const validDbName = /^[a-zA-Z0-9_]+$/;
export const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;

export const pgConfig = (database: string) => ({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database,
});

export async function ensureDatabaseExists(name: string) {
  if (!validDbName.test(name)) throw new Error(`Nome de base inválido: ${name}`);
  const admin = new Client(pgConfig(process.env.PG_ADMIN_DATABASE ?? 'postgres'));
  await admin.connect();
  try {
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
    if (r.rows.length === 0) await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
}

/** Pool com a interface Db. `schema` isola execuções (testes) dentro da mesma base. */
export function createDb(database: string, schema?: string): Db & { end(): Promise<void> } {
  const pool = new Pool({ ...pgConfig(database), max: 10, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  return {
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const tx: Tx = { query: (sql, params) => c.query(sql, params as any[]) as any };
        const out = await fn(tx);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    end: () => pool.end(),
  };
}
