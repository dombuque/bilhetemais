// Dados de demonstração via API (precisa de PAYMENT_SIMULATOR=true e do servidor a correr).
// uso: PG_DATABASE=bilheteplus_dev npm run seed-demo
import { hashPassword } from '../src/app';
import { createDb } from '../src/db';
import { migrate } from './migrate';

const DB = process.env.PG_DATABASE ?? 'bilheteplus_dev';
const API = process.env.API_URL ?? 'http://localhost:4100';
const PW = process.env.DEMO_PASSWORD ?? (() => { throw new Error('defina DEMO_PASSWORD (palavra-passe das contas de demonstração)'); })();

await migrate(DB);
const db = createDb(DB);
await db.query(`INSERT INTO users(email,name,password_hash,role) VALUES('admin@bilheteplus.test','Administrador',$1,'PLATFORM_ADMIN') ON CONFLICT DO NOTHING`, [hashPassword(PW)]);
await db.end();

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error}`);
  return j;
};
const login = async (email: string) => (await call('POST', '/auth/login', { email, password: PW })).token as string;

const root = await login('admin@bilheteplus.test');
const org = await call('POST', '/orgs', { legalName: 'Eventos Demo Lda', tradeName: 'Eventos Demo', nuit: '400000001', adminEmail: 'organizador@bilheteplus.test', adminName: 'Organizador Demo', adminPassword: PW }, root);
await call('POST', `/orgs/${org.id}/status`, { status: 'ACTIVE' }, root);
const admin = await login('organizador@bilheteplus.test');
const day = 86_400_000;
const ev = await call('POST', '/events', { name: 'Festival de Maputo', description: 'Dois dias de música, comida e cultura.', startsAt: new Date(Date.now() + day).toISOString(), endsAt: new Date(Date.now() + 2 * day).toISOString(), balanceRefundAllowed: true }, admin);
await call('POST', `/events/${ev.id}/publish`, {}, admin);
await call('POST', `/events/${ev.id}/ticket-types`, { name: 'Geral', priceMinor: 50000, quantity: 500 }, admin);
await call('POST', `/events/${ev.id}/ticket-types`, { name: 'VIP', kind: 'VIP', priceMinor: 150000, quantity: 50 }, admin);
await call('POST', `/events/${ev.id}/gates`, { name: 'Porta Principal' }, admin);
const bar = await call('POST', `/events/${ev.id}/merchants`, { name: 'Bar Central' }, admin);
for (const [name, priceMinor] of [['Cerveja', 12500], ['Água', 5000], ['Refrigerante', 7500], ['Prato do dia', 35000]] as const) await call('POST', `/merchants/${bar.id}/products`, { name, priceMinor }, admin);
for (const [email, role, extra] of [['balcao@bilheteplus.test', 'CASHIER', {}], ['porta@bilheteplus.test', 'GATE_OPERATOR', {}], ['bar@bilheteplus.test', 'MERCHANT_OPERATOR', { merchantId: bar.id }]] as const)
  await call('POST', '/users', { email, name: email.split('@')[0], password: PW, role, ...extra }, admin);

console.log(`Demo pronta. Palavra-passe de todos: ${PW}
  admin@bilheteplus.test (plataforma) · organizador@ · balcao@ · porta@ · bar@  (…@bilheteplus.test)
  Evento público: ${API}/e/${ev.subdomain}`);
