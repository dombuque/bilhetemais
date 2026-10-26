import { hashPassword } from '../src/app';
import { createDb } from '../src/db';

const [email, name, argPassword] = process.argv.slice(2);
const password = argPassword ?? process.env.ADMIN_PASSWORD; // a variável evita expor a palavra-passe na lista de processos
if (!email || !name || !password) throw new Error('uso: ADMIN_PASSWORD=... npm run create-admin -- <email> <nome>   (ou passe a palavra-passe como 3.º argumento)');
const db = createDb(process.env.PG_DATABASE ?? 'bilheteplus');
await db.query(`INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,'PLATFORM_ADMIN')`, [email.toLowerCase(), name, hashPassword(password)]);
console.log('Administrador criado:', email);
await db.end();
