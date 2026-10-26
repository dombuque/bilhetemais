// Utilizador PostgreSQL próprio do Bilhete+ (sem poderes de administração), dono só das bases do Bilhete+.
//
//   node scripts/create-db-user.mjs --sql      gera um .sql LOCAL (com palavra-passe aleatória) para correr como superutilizador no servidor
//   node scripts/create-db-user.mjs --finish   depois de o SQL correr: verifica o novo utilizador e passa o .env a usá-lo
//
// A palavra-passe nunca é escrita no ecrã: fica apenas em ficheiros locais ignorados pelo git.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const ROLE = 'bilheteplus_app';
const DBS = ['bilheteplus', 'bilheteplus_dev', 'bilheteplus_test'];
const SQL_FILE = 'create-db-user.local.sql';
const PENDING = '.pg-app-password.local';
const mode = process.argv[2];

if (mode === '--sql') {
  const password = existsSync(PENDING) ? readFileSync(PENDING, 'utf8').trim() : randomBytes(24).toString('base64url');
  writeFileSync(PENDING, password, { mode: 0o600 });
  // objectos que já existem nas bases passam para o novo utilizador (só dentro destas bases; nada do Nucleus/semFila é tocado)
  const chown = `
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('ALTER %s %I.%I OWNER TO ${ROLE}', CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, n.nspname, c.relname) AS s
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND c.relkind IN ('r','p','v','m','S')
       AND pg_get_userbyid(c.relowner) <> '${ROLE}' AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i')))
    UNION ALL
    SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO ${ROLE}', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind = 'f' AND pg_get_userbyid(p.proowner) <> '${ROLE}'
    UNION ALL
    SELECT format('ALTER SCHEMA %I OWNER TO ${ROLE}', nspname) FROM pg_namespace
     WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg\\_%' AND pg_get_userbyid(nspowner) <> '${ROLE}'
  LOOP EXECUTE r.s; END LOOP;
END
$do$;`;
  const sql = `\\set ON_ERROR_STOP on
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
    CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}';
  ELSE
    ALTER ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}';
  END IF;
END $do$;
${DBS.map((db) => `
SELECT 'CREATE DATABASE ${db} OWNER ${ROLE}' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${db}') \\gexec
ALTER DATABASE ${db} OWNER TO ${ROLE};
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT ALL ON DATABASE ${db} TO ${ROLE};
\\connect ${db}
${chown}
\\connect postgres`).join('\n')}
\\echo 'Utilizador ${ROLE} pronto. Apague o ficheiro SQL do servidor.'
`;
  writeFileSync(SQL_FILE, sql, { mode: 0o600 });
  console.log(`Gerado ${SQL_FILE} (contém a palavra-passe; não o partilhe). Envie-o e execute-o no servidor como superutilizador.`);
  process.exit(0);
}

if (mode === '--finish') {
  if (!existsSync(PENDING)) throw new Error(`Não há ${PENDING}; corra primeiro --sql.`);
  const password = readFileSync(PENDING, 'utf8').trim();
  const base = { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: ROLE, password };
  for (const db of DBS) {
    const c = new pg.Client({ ...base, database: db });
    await c.connect();
    await c.query('CREATE TABLE _perm_check(x int)'); await c.query('DROP TABLE _perm_check');
    const own = (await c.query('SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname=current_database()')).rows[0].o;
    const su = (await c.query('SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user')).rows[0];
    await c.end();
    console.log(`${db}: liga e cria tabelas · dono ${own} · superuser=${su.rolsuper} createrole=${su.rolcreaterole} createdb=${su.rolcreatedb}`);
  }
  let env = readFileSync('.env', 'utf8');
  const set = (k, v) => { env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `\n${k}=${v}`; };
  set('PGUSER', ROLE); set('PGPASSWORD', password);
  writeFileSync('.env', env);
  unlinkSync(PENDING);
  console.log('.env passou a usar o utilizador do Bilhete+ (palavra-passe só no .env, não mostrada).');
  process.exit(0);
}
console.log('Uso: node scripts/create-db-user.mjs --sql | --finish');
