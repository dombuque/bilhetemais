import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, hashPassword } from '../src/app';
import { totpAt } from '../src/totp';
import { hashToken } from '../src/wallet';
import { createDb } from '../src/db';
import { migrate } from '../scripts/migrate';

const TEST_DB = process.env.PG_TEST_DATABASE ?? 'bilheteplus_test';
const WEBHOOK_SECRET = 'whsec_test';
const MT = (n: number) => n * 100;

let db: ReturnType<typeof createDb>, server: Server, base: string, schema: string;

let buyerToken: string | undefined;
/** Comprar bilhetes online exige conta de participante: regista uma na primeira compra. */
async function buyTicket(sub: string, body: unknown, token?: string) {
  if (!buyerToken) buyerToken = (await call('POST', '/account/register', { name: 'Comprador Teste', email: 'comprador@teste.mz', password: 'pw-comprador-1' })).body.token;
  return call('POST', `/public/events/${sub}/orders`, body, token ?? buyerToken);
}
async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const r = await fetch(base + path, {
    method, body: raw,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers },
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}
const login = async (email: string, password = 'pw123456') => (await call('POST', '/auth/login', { email, password })).body.token as string;
const webhook = (evt: object) => {
  const raw = JSON.stringify(evt);
  return fetch(base + '/webhooks/simulator', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex') },
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
};

// estado partilhado entre cenários (executam por ordem)
const S: Record<string, any> = {};
const geoCalls: string[] = [];
// M-Pesa simulado: as respostas são controladas pelo teste
const googleStub: Record<string, any> = {};
const smsSent: { to: string; text: string }[] = [];
const pushSent: { endpoint: string; msg: any }[] = []; // notificações simuladas // SMS simulado: guarda o que seria enviado
const mpesaStub: any = { next: [] as any[], calls: [] as any[], query: { outcome: 'PENDING', code: 'INS-0', message: 'por confirmar' } };
let appInst: any;

beforeAll(async () => {
  schema = 't_' + randomUUID().replace(/-/g, '');
  await migrate(TEST_DB, schema);
  db = createDb(TEST_DB, schema);
  await db.query(`INSERT INTO users(email,name,password_hash,role) VALUES('root@bilhete.test','Root',$1,'PLATFORM_ADMIN')`, [hashPassword('pw123456')]);
  appInst = createApp(db, { tokenSecret: 'secret-test', webhookSecret: WEBHOOK_SECRET, selfRegistration: true,
    publicUrl: 'https://bilhete.test',
    baseDomain: 'bilhete.test',
    sms: { send: async (to: string, text: string) => { smsSent.push({ to, text }); } },
    push: { publicKey: 'BPUBLIC-TEST-KEY', send: async (sub: any, msg: any) => { if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); pushSent.push({ endpoint: sub.endpoint, msg }); } },
    google: { clientId: 'cid', clientSecret: 'sec', exchange: async (code: string) => { const p = googleStub[code]; if (!p) throw new Error('código recusado'); return p; } },
    mpesa: {
      charge: async (p: any) => { mpesaStub.calls.push(p); const n = mpesaStub.next.shift(); return typeof n === 'function' ? n() : n ?? { outcome: 'SUCCESS', code: 'INS-0', message: 'ok', transactionId: 'TX-' + mpesaStub.calls.length }; },
      query: async () => mpesaStub.query,
    },
    geocoder: async (q) => { geoCalls.push(q); return [{ name: 'Maputo, Moçambique', lat: -25.9692, lng: 32.5732, type: 'city' }]; } });
  server = appInst.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60000);

afterAll(async () => {
  server?.close();
  await db?.query(`DROP SCHEMA "${schema}" CASCADE`);
  await db?.end();
});

describe('Bilhete+ API — critérios de aceitação', () => {
  it('1. empresa regista-se, só opera depois de activada', async () => {
    const root = await login('root@bilhete.test');
    for (const n of ['A', 'B']) {
      const o = await call('POST', '/orgs', { legalName: `Org ${n} Lda`, tradeName: `Org ${n}`, nuit: '40000000' + n.charCodeAt(0), adminEmail: `admin${n}@org.test`, adminName: n, adminPassword: 'pw123456', activate: false }, root);
      expect(o.status).toBe(200);
      S['org' + n] = o.body.id;
    }
    const pending = await login('adminA@org.test');
    expect((await call('POST', '/events', { name: 'X', startsAt: '2030-01-01', endsAt: '2030-01-02' }, pending)).status).toBe(403);
    for (const n of ['A', 'B']) expect((await call('POST', `/orgs/${S['org' + n]}/status`, { status: 'ACTIVE' }, root)).status).toBe(200);
    S.adminA = await login('adminA@org.test');
    S.adminB = await login('adminB@org.test');
  });

  it('2-3. cria evento e gera subdomínio único (sem reservados nem colisões)', async () => {
    const ev = { name: 'Festival de Maputo', startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-02T04:00:00Z', balanceRefundAllowed: false };
    const a = await call('POST', '/events', ev, S.adminA);
    expect(a.body.subdomain).toBe('festival-de-maputo');
    S.event = a.body.id;
    const dup = await call('POST', '/events', ev, S.adminB);
    expect(dup.body.subdomain).toBe('festival-de-maputo-2');
    expect((await call('POST', '/events', { ...ev, name: 'Admin' }, S.adminA)).body.subdomain).toBe('admin-evento');
    S.eventB = dup.body.id;
    expect((await call('POST', `/events/${S.event}/publish`, {}, S.adminA)).status).toBe(200);
    S.type = (await call('POST', `/events/${S.event}/ticket-types`, { name: 'Geral', priceMinor: MT(500), quantity: 3 }, S.adminA)).body.id;
    S.gateId = (await call('POST', `/events/${S.event}/gates`, { name: 'Porta 1' }, S.adminA)).body.id;
    S.merchant = (await call('POST', `/events/${S.event}/merchants`, { name: 'Bar Central' }, S.adminA)).body.id;
    S.beer = (await call('POST', `/merchants/${S.merchant}/products`, { name: 'Cerveja', priceMinor: MT(125) }, S.adminA)).body.id;
    for (const [k, role, extra] of [['cashier', 'CASHIER', {}], ['gate', 'GATE_OPERATOR', {}], ['pos', 'MERCHANT_OPERATOR', { merchantId: S.merchant }]] as const) {
      expect((await call('POST', '/users', { email: `${k}@org.test`, name: k, password: 'pw123456', role, ...extra }, S.adminA)).status).toBe(200);
      S[k] = await login(`${k}@org.test`);
    }
    expect((await call('GET', '/public/events/festival-de-maputo')).body.ticketTypes[0].available).toBe(3);
  });

  it('4. compra online: pendente até ao webhook assinado; webhook repetido é ignorado', async () => {
    const o = await buyTicket('festival-de-maputo', { buyerName: 'Ana', buyerContact: '84', items: [{ ticketTypeId: S.type, qty: 1 }] });
    expect(o.body.status).toBe('PENDING_PAYMENT');
    expect((await call('GET', `/public/orders/${o.body.orderId}`)).body.tickets[0].token).toBeNull();
    const bad = await fetch(base + '/webhooks/simulator', { method: 'POST', body: '{"id":"e1"}', headers: { 'content-type': 'application/json', 'x-signature': 'x'.repeat(64) } });
    expect(bad.status).toBe(401);
    const evt = { id: 'evt-1', type: 'payment.succeeded', kind: 'ORDER', ref: o.body.orderId };
    expect((await webhook(evt)).body.ok).toBe(true);
    expect((await webhook(evt)).body.replayed).toBe(true);
    const done = (await call('GET', `/public/orders/${o.body.orderId}`)).body;
    expect(done.status).toBe('PAID');
    S.onlineToken = done.tickets[0].token;
    expect(S.onlineToken).toBeTruthy();
  });

  it('5-8. caixa: venda presencial com bilhete impresso, carrega 1.000 MT em numerário', async () => {
    expect((await call('POST', `/events/${S.event}/counter/sales`, { buyerName: 'X', items: [{ ticketTypeId: S.type, qty: 1 }] }, S.cashier)).status).toBe(409); // caixa fechada
    expect((await call('POST', `/events/${S.event}/cashier-sessions/open`, {}, S.cashier)).status).toBe(200);
    const sale = await call('POST', `/events/${S.event}/counter/sales`, { buyerName: 'Bruno', items: [{ ticketTypeId: S.type, qty: 1 }], format: 'PHYSICAL' }, S.cashier);
    expect(sale.body.tickets[0].format).toBe('PHYSICAL');
    S.physicalTicket = sale.body.tickets[0];
    const top = await call('POST', `/events/${S.event}/counter/topup-cash`, { token: S.physicalTicket.token, amountMinor: MT(1000), idempotencyKey: 'c-1' }, S.cashier);
    expect(top.body.balanceMinor).toBe(String(MT(1000)));
    const again = await call('POST', `/events/${S.event}/counter/topup-cash`, { token: S.physicalTicket.token, amountMinor: MT(1000), idempotencyKey: 'c-1' }, S.cashier);
    expect(again.body.replayed).toBe(true);
    expect(again.body.balanceMinor).toBe(String(MT(1000)));
  });

  it('9-10, 17-18. pagamento com bilhete físico; duplicado e saldo insuficiente', async () => {
    const pay = (key: string, qty: number, token = S.physicalTicket.token) => call('POST', '/pos/pay', { token, idempotencyKey: key, items: [{ productId: S.beer, qty }] }, S.pos);
    const a = await pay('k1', 2); // 250 MT
    expect(a.body.balanceMinor).toBe(String(MT(750)));
    S.paymentEntry = a.body.entryId;
    expect((await pay('k1', 2)).body.replayed).toBe(true);
    expect((await call('POST', `/events/${S.event}/counter/balance`, { token: S.physicalTicket.token }, S.cashier)).body.balanceMinor).toBe(String(MT(750)));
    expect((await pay('k2', 100)).status).toBe(402);
  });

  it('6, 11-13. NFC: associa cartão ao bilhete online, carrega por prestador, paga', async () => {
    const nfc = 'nfc-uid-cripto-123';
    expect((await call('POST', `/events/${S.event}/counter/credentials`, { token: S.onlineToken, kind: 'NFC', newToken: nfc }, S.cashier)).status).toBe(200);
    const top = await call('POST', `/public/tickets/${S.onlineToken}/topup`, { provider: 'simulator', amountMinor: MT(400) });
    expect((await call('GET', `/public/tickets/${S.onlineToken}`)).body.balanceMinor).toBe('0'); // regresso à página não credita
    await webhook({ id: 'evt-2', type: 'payment.succeeded', kind: 'TOPUP', ref: top.body.topupId });
    await webhook({ id: 'evt-2b', type: 'payment.succeeded', kind: 'TOPUP', ref: top.body.topupId }); // mesma ref, evento novo: não duplica
    const p = await call('POST', '/pos/pay', { token: nfc, idempotencyKey: 'n1', items: [{ productId: S.beer, qty: 1 }] }, S.pos);
    expect(p.body.balanceMinor).toBe(String(MT(275)));
    expect((await call('GET', `/public/tickets/${S.onlineToken}`)).body.balanceMinor).toBe(String(MT(275)));
    S.nfc = nfc;
  });

  it('14-16. credencial perdida: bloqueio, substituição, histórico mantido, antiga rejeitada', async () => {
    const r = await call('POST', `/events/${S.event}/counter/credentials`, { token: S.nfc, kind: 'NFC', replace: true, newToken: 'nfc-novo-456' }, S.cashier);
    expect(r.status).toBe(200);
    const old = await call('POST', '/pos/pay', { token: S.nfc, idempotencyKey: 'n2', items: [{ productId: S.beer, qty: 1 }] }, S.pos);
    expect(old.status).toBe(403);
    const fresh = await call('POST', '/pos/pay', { token: 'nfc-novo-456', idempotencyKey: 'n3', items: [{ productId: S.beer, qty: 1 }] }, S.pos);
    expect(fresh.body.balanceMinor).toBe(String(MT(150)));
    const hist = await call('GET', `/public/tickets/${S.onlineToken}`);
    expect(hist.body.movements.length).toBe(3);
    // bloqueio explícito
    await call('POST', `/events/${S.event}/counter/block`, { token: 'nfc-novo-456' }, S.cashier);
    expect((await call('POST', '/pos/pay', { token: 'nfc-novo-456', idempotencyKey: 'n4', items: [{ productId: S.beer, qty: 1 }] }, S.pos)).status).toBe(403);
  });

  it('19. entrada: válido uma vez, depois já utilizado; revogado e desconhecido recusados', async () => {
    const scan = (token: string) => call('POST', `/events/${S.event}/scan`, { token, gateId: S.gateId }, S.gate);
    expect((await scan(S.physicalTicket.token)).body.result).toBe('VALID');
    const again = (await scan(S.physicalTicket.token)).body;
    expect(again.result).toBe('ALREADY_USED');
    expect(again.ticket).toMatchObject({ type: expect.any(String), holder: expect.any(String) }); // a portaria vê quem é
    expect(again.ticket.usedAt).toBeTruthy();
    expect((await scan('desconhecido')).body.result).toBe('UNAUTHORIZED');
    const sales = await call('POST', `/events/${S.event}/counter/sales`, { buyerName: 'Rev', items: [{ ticketTypeId: S.type, qty: 1 }] }, S.cashier);
    await call('POST', `/tickets/${sales.body.tickets[0].id}/revoke`, {}, S.adminA);
    expect((await scan(sales.body.tickets[0].token)).body.result).toBe('REVOKED');
  });

  it('stock: não vende acima da quantidade do tipo de bilhete', async () => {
    const r = await call('POST', `/events/${S.event}/counter/sales`, { buyerName: 'Z', items: [{ ticketTypeId: S.type, qty: 5 }] }, S.cashier);
    expect(r.status).toBe(409);
  });

  it('22. isolamento: empresa B e operadores não acedem a dados de A nem fora das suas funções', async () => {
    expect((await call('GET', `/events/${S.event}/report`, undefined, S.adminB)).status).toBe(404);
    expect((await call('POST', `/events/${S.event}/ticket-types`, { name: 'x', priceMinor: 1, quantity: 1 }, S.adminB)).status).toBe(404);
    expect((await call('POST', `/events/${S.event}/scan`, { token: S.physicalTicket.token }, S.adminA)).status).toBe(403);
    expect((await call('GET', `/events/${S.event}/report`, undefined, S.cashier)).status).toBe(403);
    expect((await call('POST', '/pos/pay', { token: S.physicalTicket.token, idempotencyKey: 'z', items: [{ productId: S.beer, qty: 1 }] }, S.cashier)).status).toBe(403);
    expect((await call('GET', `/events/${S.event}/report`)).status).toBe(401);
    // carteira de outro evento não paga no comerciante deste
    expect((await call('POST', `/events/${S.eventB}/cashier-sessions/open`, {}, S.cashier)).status).toBe(404);
  });

  it('24. reembolsos: devolução de venda do comerciante (uma só vez) e regras do evento para saldo', async () => {
    const sale = await db.query<any>('SELECT id FROM merchant_sales WHERE ledger_entry_id=$1', [S.paymentEntry]);
    const r1 = await call('POST', '/pos/refund', { saleId: sale.rows[0].id }, S.pos);
    expect(r1.body.balanceMinor).toBe(String(MT(750) + MT(250)));
    expect((await call('POST', '/pos/refund', { saleId: sale.rows[0].id }, S.pos)).body.replayed).toBe(true);
    expect((await call('POST', '/pos/refund', { saleId: sale.rows[0].id }, S.pos)).body.balanceMinor).toBe(String(MT(1000)));
    // evento não permite devolução de saldo
    expect((await call('POST', `/public/tickets/${S.physicalTicket.token}/refund-request`, { amountMinor: MT(100) })).status).toBe(403);
    // evento que permite
    await db.query(`UPDATE events SET balance_refund_allowed=true WHERE id=$1`, [S.event]);
    const rq = await call('POST', `/public/tickets/${S.physicalTicket.token}/refund-request`, { amountMinor: MT(200) });
    expect(rq.status).toBe(200);
    expect((await call('POST', `/refund-requests/${rq.body.refundRequestId}/decide`, { approve: true }, S.adminB)).status).toBe(404);
    const d = await call('POST', `/refund-requests/${rq.body.refundRequestId}/decide`, { approve: true }, S.adminA);
    expect(d.body.balanceMinor).toBe(String(MT(800)));
    expect((await call('POST', `/refund-requests/${rq.body.refundRequestId}/decide`, { approve: true }, S.adminA)).status).toBe(409);
  });

  it('21, 23. relatórios reflectem os movimentos e a reconciliação fecha a zero; fecho de caixa', async () => {
    const rep = (await call('GET', `/events/${S.event}/report`, undefined, S.adminA)).body;
    // carregamentos: 1000 (numerário) + 400 (digital)
    expect(rep.wallets.topupsMinor).toBe(String(MT(1400)));
    expect(rep.reconciliation.differenceMinor).toBe('0');
    expect(rep.reconciliation.cashMinor).toBe(String(MT(1000)));
    expect(rep.reconciliation.digitalConfirmedMinor).toBe(String(MT(400)));
    // pagamentos: 250 + 125 + 125 = 500, menos 250 devolvidos, menos 200 de levantamento
    expect(rep.wallets.paymentsMinor).toBe(String(MT(500)));
    expect(rep.wallets.refundsMinor).toBe(String(MT(250)));
    expect(rep.wallets.balanceInCirculationMinor).toBe(String(MT(1400 - 500 + 250 - 200)));
    expect(rep.merchants[0].salesMinor).toBe(String(MT(500)));
    expect(rep.tickets.entered).toBe(1);
    // caixa: 3 vendas de bilhete (500 MT cada; a 3ª e a do esgotamento falhada não contam) + 1000 numerário
    const close = await call('POST', `/events/${S.event}/cashier-sessions/close`, { countedMinor: MT(2000) }, S.cashier);
    expect(close.body.expectedMinor).toBe(String(MT(500) * 2 + MT(1000)));
    expect(close.body.differenceMinor).toBe(String(MT(2000) - (MT(500) * 2 + MT(1000))));
  });

  it('registo self-service: empresa regista-se online e só cria eventos depois de aprovada', async () => {
    const reg = { legalName: 'Nova Lda', tradeName: 'Nova', nuit: '400111222', contactName: 'Carla', email: 'carla@nova.test', password: 'pw123456', acceptTerms: true };
    expect((await call('POST', '/public/register', { ...reg, acceptTerms: false })).status).toBe(400);
    expect((await call('POST', '/public/register', { ...reg, password: 'curta' })).status).toBe(400);
    expect((await call('POST', '/public/register', { ...reg, nuit: '123' })).status).toBe(400);
    const ok = await call('POST', '/public/register', reg);
    expect(ok.body.status).toBe('PENDING');
    expect((await call('POST', '/public/register', { ...reg, nuit: '400111223' })).status).toBe(409); // e-mail repetido
    expect((await call('POST', '/public/register', { ...reg, email: 'outra@nova.test' })).status).toBe(409); // NUIT repetido
    const t = await login('carla@nova.test');
    expect((await call('GET', '/me', undefined, t)).body.orgStatus).toBe('PENDING');
    const ev = { name: 'Evento Novo', startsAt: '2031-01-01T10:00:00Z', endsAt: '2031-01-01T20:00:00Z' };
    expect((await call('POST', '/events', ev, t)).status).toBe(403);
    // pendente pode completar o perfil e anexar documentos
    expect((await call('PUT', '/org/profile', { address: 'Av. 25 de Setembro', phone: '840000000' }, t)).status).toBe(200);
    const pdf = Buffer.from('%PDF-1.4\n%teste');
    const up = await fetch(base + '/org/documents', { method: 'POST', body: pdf as any, headers: { 'content-type': 'application/pdf', authorization: 'Bearer ' + t, 'x-doc-label': 'Certidão NUIT', 'x-filename': 'nuit.pdf' } });
    expect(up.status).toBe(200);
    const fake = await fetch(base + '/org/documents', { method: 'POST', body: Buffer.from('MZ-executavel') as any, headers: { 'content-type': 'application/pdf', authorization: 'Bearer ' + t } });
    expect(fake.status).toBe(400);
    // a plataforma revê
    const root = await login('root@bilhete.test');
    expect((await call('GET', '/orgs', undefined, t)).status).toBe(403);
    const list = (await call('GET', '/orgs', undefined, root)).body;
    expect(list[0].status).toBe('PENDING'); // pendentes primeiro
    const org = list.find((o: any) => o.nuit === '400111222');
    expect(org.documents).toBe(1);
    const full = (await call('GET', `/orgs/${org.id}`, undefined, root)).body;
    const dl = await fetch(`${base}/orgs/${org.id}/documents/${full.documents[0].id}`, { headers: { authorization: 'Bearer ' + root } });
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect((await call('POST', `/orgs/${org.id}/status`, { status: 'REJECTED' }, root)).status).toBe(400); // exige motivo
    expect((await call('POST', `/orgs/${org.id}/status`, { status: 'REJECTED', reason: 'NUIT não confere' }, root)).status).toBe(200);
    expect((await call('POST', '/events', ev, t)).status).toBe(403);
    await call('POST', `/orgs/${org.id}/status`, { status: 'ACTIVE' }, root);
    expect((await call('POST', '/events', ev, t)).status).toBe(200);
  });

  it('personalização: tema da empresa herdado e substituído pelo evento; logótipo e capa validados', async () => {
    const bad = await call('PUT', `/events/${S.event}/theme`, { primary: 'vermelho' }, S.adminA);
    expect(bad.status).toBe(400);
    expect((await call('PUT', `/events/${S.event}/theme`, { primary: '#112233' }, S.adminB)).status).toBe(404); // outra empresa
    await call('PUT', '/org/theme', { primary: '#0a7d3b', accent: '#ffcc00', font: 'rounded' }, S.adminA);
    await call('PUT', `/events/${S.event}/theme`, { primary: '#C2185B', tagline: 'Três noites de música', heroStyle: 'gradient' }, S.adminA);
    const pub = (await call('GET', '/public/events/festival-de-maputo')).body;
    expect(pub.theme).toMatchObject({ primary: '#c2185b', accent: '#ffcc00', font: 'rounded', tagline: 'Três noites de música' });
    // imagens: só PNG/JPEG/WebP reais, até 1 MB
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const put = (path: string, body: Buffer, type = 'image/png', tk = S.adminA) =>
      fetch(base + path, { method: 'PUT', body: body as any, headers: { 'content-type': type, authorization: 'Bearer ' + tk } });
    expect((await put(`/events/${S.event}/assets/cover`, Buffer.from('<svg onload=alert(1)>'), 'image/png')).status).toBe(400);
    expect((await put(`/events/${S.event}/assets/cover`, Buffer.alloc(1_200_000, 1), 'image/png')).status).toBe(413);
    expect((await put(`/events/${S.event}/assets/cover`, png, 'image/png', S.adminB)).status).toBe(404);
    expect((await put(`/events/${S.event}/assets/cover`, png)).status).toBe(200);
    expect((await put('/org/assets/logo', png)).status).toBe(200); // logótipo da empresa
    const cover = await fetch(base + '/public/events/festival-de-maputo/assets/cover');
    expect(cover.headers.get('content-type')).toBe('image/png');
    const logo = await fetch(base + '/public/events/festival-de-maputo/assets/logo'); // evento sem logótipo próprio → o da empresa
    expect(logo.status).toBe(200);
    expect((await fetch(base + '/public/events/festival-de-maputo/assets/outro')).status).toBe(404);
    const after = (await call('GET', '/public/events/festival-de-maputo')).body;
    expect(after.assets.cover).toBeTruthy();
    expect(after.assets.logo).toBeTruthy();
  });

  it('parâmetros por evento: herança de outro evento, substituição por chave e aplicação nas regras', async () => {
    // pai: reentrada permitida e máx. 5 bilhetes por encomenda
    expect((await call('PUT', `/events/${S.event}/settings`, { reentryAllowed: true, maxTicketsPerOrder: 5, minTopupMinor: 'x' }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/events/${S.event}/settings`, { reentryAllowed: true, maxTicketsPerOrder: 5 }, S.adminA)).status).toBe(200);
    // filho: herda (aparência + parâmetros) e copia a estrutura; sem categorias, sem carteira
    const child = await call('POST', '/events', { name: 'Feira de Maputo', startsAt: '2031-02-01T10:00:00Z', endsAt: '2031-02-01T20:00:00Z', inheritFrom: S.event, copy: ['ticketTypes', 'gates'], location: 'FEIMA' }, S.adminA);
    expect(child.status).toBe(200);
    S.child = child.body.id;
    await call('POST', `/events/${S.child}/publish`, {}, S.adminA);
    const ov = (await call('GET', `/events/${S.child}/overview`, undefined, S.adminA)).body;
    expect(ov.ticketTypes).toHaveLength(1); // copiado do pai
    expect(ov.gates).toHaveLength(1);
    expect(ov.parent.id).toBe(S.event);
    expect(ov.settings.effective).toMatchObject({ reentryAllowed: true, maxTicketsPerOrder: 5 });
    expect(ov.settings.sources.reentryAllowed).toBe('Festival de Maputo');
    expect((await call('GET', `/public/events/${child.body.subdomain}`)).body.theme.primary).toBe('#c2185b'); // aparência herdada
    // o filho substitui só o que quer
    await call('PUT', `/events/${S.child}/settings`, { maxTicketsPerOrder: 1, ticketCategories: 'single', walletEnabled: false, minTopupMinor: 100 }, S.adminA);
    const ov2 = (await call('GET', `/events/${S.child}/overview`, undefined, S.adminA)).body;
    expect(ov2.settings.effective).toMatchObject({ reentryAllowed: true, maxTicketsPerOrder: 1, walletEnabled: false, ticketCategories: 'single' });
    expect(ov2.settings.sources.maxTicketsPerOrder).toBe('Feira de Maputo');
    const parentOv = (await call('GET', `/events/${S.event}/overview`, undefined, S.adminA)).body;
    expect(parentOv.settings.effective.maxTicketsPerOrder).toBe(5); // o pai não muda
    // regras aplicadas
    const sub = child.body.subdomain;
    const tt = (await call('GET', `/public/events/${sub}`)).body.ticketTypes[0].id;
    expect((await buyTicket(sub, { buyerName: 'Z', items: [{ ticketTypeId: tt, qty: 2 }] })).status).toBe(400);
    const ord = await buyTicket(sub, { buyerName: 'Z', items: [{ ticketTypeId: tt, qty: 1 }] });
    expect(ord.status).toBe(200);
    await webhook({ id: 'evt-child-1', type: 'payment.succeeded', kind: 'ORDER', ref: ord.body.orderId });
    const tok = (await call('GET', `/public/orders/${ord.body.orderId}`)).body.tickets[0].token;
    expect((await call('POST', `/public/tickets/${tok}/topup`, { provider: 'simulator', amountMinor: 5000 })).status).toBe(409); // carteira desactivada
    // reentrada herdada do pai: a segunda leitura continua válida
    const scan = () => call('POST', `/events/${S.child}/scan`, { token: tok }, S.gate);
    expect((await scan()).body.result).toBe('VALID');
    expect((await scan()).body.result).toBe('VALID');
    // herança: sem ciclos, sem auto-herança, só da própria empresa
    expect((await call('PUT', `/events/${S.event}/parent`, { parentId: S.child }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/events/${S.child}/parent`, { parentId: S.child }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/events/${S.child}/parent`, { parentId: S.eventB }, S.adminA)).status).toBe(404);
    expect((await call('PUT', `/events/${S.child}/parent`, { parentId: null }, S.adminA)).status).toBe(200);
    expect((await call('GET', `/events/${S.child}/overview`, undefined, S.adminA)).body.settings.effective.reentryAllowed).toBe(false); // deixou de herdar
    // limites de carregamento no evento-pai
    await call('PUT', `/events/${S.event}/settings`, { maxTopupMinor: 100000, maxBalanceMinor: 150000 }, S.adminA);
    await call('POST', `/events/${S.event}/cashier-sessions/open`, {}, S.cashier); // a caixa anterior foi fechada
    expect((await call('POST', `/events/${S.event}/counter/topup-cash`, { token: S.physicalTicket.token, amountMinor: 200000, idempotencyKey: 'big' }, S.cashier)).status).toBe(400);
  });

  it('galeria, programação e localização do evento (imagens guardadas na base de dados)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const send = (id: string, tk: string, body: Buffer, caption = '') => fetch(`${base}/events/${id}/images`, { method: 'POST', body: body as any, headers: { 'content-type': 'image/png', authorization: 'Bearer ' + tk, 'x-caption': encodeURIComponent(caption) } });
    const a = await send(S.event, S.adminA, png, 'Palco principal');
    expect(a.status).toBe(200);
    const imgId = ((await a.json()) as any).id;
    expect((await send(S.event, S.adminA, Buffer.from('nao-sou-imagem'))).status).toBe(400);
    expect((await send(S.event, S.adminB, png)).status).toBe(404);
    const pub = (await call('GET', '/public/events/festival-de-maputo')).body;
    expect(pub.gallery).toEqual([{ id: imgId, caption: 'Palco principal' }]);
    const file = await fetch(`${base}/public/events/festival-de-maputo/images/${imgId}`);
    expect(file.headers.get('content-type')).toBe('image/png');
    const stored = await db.query<any>('SELECT octet_length(data) AS n FROM event_images WHERE id=$1', [imgId]);
    expect(stored.rows[0].n).toBe(png.length); // os bytes estão na base de dados
    // programação e detalhes
    expect((await call('POST', `/events/${S.event}/sessions`, { title: 'Abertura', startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-01T17:00:00Z' }, S.adminA)).status).toBe(400); // fim antes do início
    expect((await call('POST', `/events/${S.event}/sessions`, { title: 'Abertura', startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-01T19:00:00Z', stage: 'Palco 1' }, S.adminA)).status).toBe(200);
    expect((await call('PUT', `/events/${S.event}/details`, { location: 'Estádio Nacional', mapUrl: 'javascript:alert(1)' }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/events/${S.event}/details`, { location: 'Estádio Nacional', mapUrl: 'https://maps.example/x' }, S.adminA)).status).toBe(200);
    const pub2 = (await call('GET', '/public/events/festival-de-maputo')).body;
    expect(pub2.programme[0]).toMatchObject({ title: 'Abertura', stage: 'Palco 1' });
    expect(pub2.location).toBe('Estádio Nacional');
    expect((await call('DELETE', `/events/${S.event}/images/${imgId}`, undefined, S.adminA)).status).toBe(200);
    expect((await call('GET', '/public/events/festival-de-maputo')).body.gallery).toEqual([]);
  });

  it('área própria por empresa: entrada, equipa e isolamento total entre empresas', async () => {
    const root = await login('root@bilhete.test');
    // endereço próprio e único da área de entrada
    const orgs = (await call('GET', '/orgs', undefined, root)).body;
    const slugs = orgs.map((o: any) => o.slug).filter(Boolean);
    const meA = (await call('GET', '/me', undefined, S.adminA)).body;
    const meB = (await call('GET', '/me', undefined, S.adminB)).body;
    expect(meA.orgSlug).toBe('org-a');
    expect(meB.orgSlug).toBe('org-b');
    expect(new Set([...slugs, 'org-a']).size).toBe(slugs.length || 1); // sem repetidos
    const page = (await call('GET', `/public/org/${meA.orgSlug}`)).body;
    expect(page.name).toBe('Org A');
    expect((await call('GET', '/public/org/nao-existe')).body.name).toBeNull(); // resposta neutra: não revela que endereços existem
    // entrar pela área da própria empresa funciona; pela de outra empresa não (mesmo com credenciais certas)
    const login2 = (email: string, org?: string) => call('POST', '/auth/login', { email, password: 'pw123456', org });
    expect((await login2('adminA@org.test', 'org-a')).status).toBe(200);
    expect((await login2('adminA@org.test', 'org-b')).status).toBe(401);
    expect((await login2('cashier@org.test', 'org-b')).status).toBe(401);
    expect((await login2('root@bilhete.test', 'org-a')).status).toBe(401); // a plataforma não entra por área de empresa
    expect((await login2('root@bilhete.test')).status).toBe(200);
    // a equipa de cada empresa é só dela
    const teamA = (await call('GET', '/users', undefined, S.adminA)).body;
    const teamB = (await call('GET', '/users', undefined, S.adminB)).body;
    expect(teamA.map((u: any) => u.email)).toEqual(expect.arrayContaining(['cashier@org.test', 'gate@org.test', 'pos@org.test', 'admina@org.test']));
    expect(teamB.map((u: any) => u.email)).toEqual(['adminb@org.test']);
    expect((await call('GET', '/users', undefined, S.cashier)).status).toBe(403);
    const cashierId = teamA.find((u: any) => u.email === 'cashier@org.test').id;
    // a empresa B não consegue gerir utilizadores da A
    expect((await call('PATCH', `/users/${cashierId}`, { status: 'DISABLED' }, S.adminB)).status).toBe(404);
    expect((await call('POST', `/users/${cashierId}/password`, { password: 'novapass123' }, S.adminB)).status).toBe(404);
    expect((await call('GET', '/merchants', undefined, S.adminB)).body).toEqual([]); // sem comerciantes da A
    // a empresa A gere a sua equipa: repor palavra-passe termina sessões; desactivar impede entrada
    expect((await call('POST', `/users/${cashierId}/password`, { password: 'curta' }, S.adminA)).status).toBe(400);
    expect((await call('POST', `/users/${cashierId}/password`, { password: 'novapass123' }, S.adminA)).status).toBe(200);
    expect((await call('GET', '/me', undefined, S.cashier)).status).toBe(401); // sessão antiga terminou
    const fresh = await call('POST', '/auth/login', { email: 'cashier@org.test', password: 'novapass123', org: 'org-a' });
    expect(fresh.status).toBe(200);
    expect((await call('PATCH', `/users/${cashierId}`, { status: 'DISABLED' }, S.adminA)).status).toBe(200);
    expect((await call('GET', '/me', undefined, fresh.body.token)).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'cashier@org.test', password: 'novapass123' })).status).toBe(401);
    const adminAId = teamA.find((u: any) => u.email === 'admina@org.test').id;
    expect((await call('PATCH', `/users/${adminAId}`, { status: 'DISABLED' }, S.adminA)).status).toBe(400); // não se auto-desactiva
    // alterar a própria palavra-passe
    expect((await call('POST', '/me/password', { current: 'errada', password: 'outrapass123' }, S.gate)).status).toBe(401);
    expect((await call('POST', '/me/password', { current: 'pw123456', password: 'outrapass123' }, S.gate)).status).toBe(200);
    // a plataforma vê equipa e eventos de cada empresa (leitura), sem poder operá-las
    const full = (await call('GET', `/orgs/${meA.orgSlug === 'org-a' ? orgs.find((o: any) => o.slug === 'org-a').id : ''}`, undefined, root)).body;
    expect(full.users.length).toBeGreaterThanOrEqual(4);
    expect(full.events.length).toBeGreaterThanOrEqual(1);
    expect((await call('GET', `/orgs/${full.id}`, undefined, S.adminB)).status).toBe(403);
    // os eventos de uma empresa não aparecem na outra
    const evA = (await call('GET', '/events', undefined, S.adminA)).body.map((e: any) => e.id);
    const evB = (await call('GET', '/events', undefined, S.adminB)).body.map((e: any) => e.id);
    expect(evA.filter((id: string) => evB.includes(id))).toEqual([]);
  });

  it('MFA (TOTP): activação, código no login, sem reutilização, recuperação de uso único e desactivação', async () => {
    const setup = await call('POST', '/me/mfa/setup', {}, S.gate);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    const stored = await db.query<any>(`SELECT mfa_secret FROM users WHERE email='gate@org.test'`);
    expect(stored.rows[0].mfa_secret).not.toContain(setup.body.secret); // segredo cifrado na base de dados
    expect((await call('POST', '/me/mfa/enable', { code: '000000' }, S.gate)).status).toBe(400);
    const en = await call('POST', '/me/mfa/enable', { code: totpAt(setup.body.secret) }, S.gate);
    expect(en.body.recoveryCodes).toHaveLength(8);
    expect((await call('GET', '/me', undefined, S.gate)).body.mfaEnabled).toBe(true);
    const L = (code?: string) => call('POST', '/auth/login', { email: 'gate@org.test', password: 'outrapass123', org: 'org-a', code });
    expect((await L()).body.error).toBe('MFA_REQUIRED');
    expect((await L('123456')).status).toBe(401);
    const next = totpAt(setup.body.secret, Date.now() + 30_000); // passo seguinte: dentro da tolerância e ainda não usado
    expect((await L(next)).status).toBe(200);
    expect((await L(next)).status).toBe(401); // o mesmo código não se reutiliza
    const rec = en.body.recoveryCodes[0];
    expect((await L(rec)).status).toBe(200);
    expect((await L(rec)).status).toBe(401); // código de recuperação: uso único
    // desactivar exige palavra-passe e código
    expect((await call('POST', '/me/mfa/disable', { password: 'errada', code: next }, S.gate)).status).toBe(401);
    const off = await call('POST', '/me/mfa/disable', { password: 'outrapass123', code: totpAt(setup.body.secret, Date.now() + 60_000) }, S.gate);
    expect([200, 401]).toContain(off.status); // o passo +2 está fora da janela: não se aceita código futuro
    expect(off.status).toBe(401);
  });

  it('e-mails na fila (sem SMTP ficam SKIPPED), códigos de bilhete curtos e limite nas rotas públicas', async () => {
    const n = await db.query<any>(`SELECT subject,status FROM notifications WHERE to_email='carla@nova.test' ORDER BY created_at`);
    expect(n.rows.map((r: any) => r.subject)).toEqual(expect.arrayContaining([expect.stringContaining('Recebemos o registo'), expect.stringContaining('aprovada')]));
    expect(n.rows.every((r: any) => r.status === 'SKIPPED')).toBe(true);
    expect(S.onlineToken).toHaveLength(22); // cabe num código de barras legível
    // limite de pedidos POST públicos por minuto e IP
    const limited = createApp(db, { tokenSecret: 'secret-test', webhookSecret: WEBHOOK_SECRET, publicRateLimit: 3 }).listen(0);
    try {
      const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/public/events/festival-de-maputo/orders`;
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
      expect(codes.slice(0, 3)).not.toContain(429);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally { limited.close(); }
  });

  it('acertos com comerciantes: comissão, devido, pagamentos limitados ao que se deve; CSV seguro; comprovativos', async () => {
    expect((await call('PUT', `/merchants/${S.merchant}/commission`, { bps: 20000 }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/merchants/${S.merchant}/commission`, { bps: 1000 }, S.adminB)).status).toBe(404);
    expect((await call('PUT', `/merchants/${S.merchant}/commission`, { bps: 1000 }, S.adminA)).status).toBe(200); // 10 %
    const st = (await call('GET', `/events/${S.event}/settlements`, undefined, S.adminA)).body;
    const bar = st.merchants.find((m: any) => m.merchantId === S.merchant);
    // vendas 500 MT − devolução 250 MT = 250 MT líquidos; comissão 10 % = 25 MT; devido 225 MT
    expect(bar).toMatchObject({ grossMinor: String(MT(500)), refundsMinor: String(MT(250)), netMinor: String(MT(250)), commissionMinor: String(MT(25)), dueMinor: String(MT(225)), outstandingMinor: String(MT(225)) });
    const pay = (amountMinor: number, tk = S.adminA) => call('POST', `/events/${S.event}/settlements/${S.merchant}/payouts`, { amountMinor, reference: 'M-PESA 123' }, tk);
    expect((await pay(MT(300))).status).toBe(409); // excede o que se deve
    expect((await pay(MT(100), S.adminB)).status).toBe(404);
    expect((await pay(MT(100))).body.outstandingMinor).toBe(String(MT(125)));
    expect((await pay(MT(125))).body.outstandingMinor).toBe('0');
    expect((await pay(1)).status).toBe(409); // já está tudo pago
    // CSV: delimitado por ; com BOM, e células perigosas neutralizadas
    await call('POST', `/events/${S.event}/merchants`, { name: '=HYPERLINK("http://mau")' }, S.adminA);
    const csv = await fetch(`${base}/events/${S.event}/export/settlements`, { headers: { authorization: 'Bearer ' + S.adminA } });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const raw = new Uint8Array(await csv.arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 para o Excel abrir os acentos bem
    const body = new TextDecoder().decode(raw);
    expect(body).toContain('Bar Central;500,00;250,00;250,00;1000;25,00;225,00;225,00;0,00');
    expect(body).toContain("\"'=HYPERLINK(\"\"http://mau\"\")\""); // plica à frente: o Excel não executa
    const led = (await (await fetch(`${base}/events/${S.event}/export/ledger`, { headers: { authorization: 'Bearer ' + S.adminA } })).text()).trim().split('\r\n');
    const n = await db.query<any>(`SELECT count(*)::int AS c FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id WHERE w.event_id=$1`, [S.event]);
    expect(led.length - 1).toBe(n.rows[0].c);
    expect((await fetch(`${base}/events/${S.event}/export/ledger`, { headers: { authorization: 'Bearer ' + S.adminB } })).status).toBe(404);
    expect((await fetch(`${base}/events/${S.event}/export/segredos`, { headers: { authorization: 'Bearer ' + S.adminA } })).status).toBe(404);
    // comprovativo: só de movimentos da própria carteira
    const own = await db.query<any>(`SELECT l.id FROM wallet_ledger_entries l JOIN tickets t ON t.wallet_id=l.wallet_id WHERE t.token_hash=$1 AND l.type='PAYMENT' LIMIT 1`, [hashToken(S.onlineToken)]);
    const rc = await call('GET', `/public/tickets/${S.onlineToken}/receipts/${own.rows[0].id}`);
    expect(rc.body).toMatchObject({ merchant: 'Bar Central', type: 'PAYMENT', event: 'Festival de Maputo' });
    expect(rc.body.number).toHaveLength(8);
    expect((await call('GET', `/public/tickets/${S.onlineToken}/receipts/${S.paymentEntry}`)).status).toBe(404); // movimento de outra carteira
  });

  it('portaria offline: lista só com hashes, sincronização idempotente e conflitos entre portas sinalizados; alertas e actividade', async () => {
    const sub = (await call('GET', `/events/${S.child}/overview`, undefined, S.adminA)).body.event.subdomain;
    const buy = async (hook: string) => {
      const tt = (await call('GET', `/public/events/${sub}`)).body.ticketTypes[0].id;
      const o = await buyTicket(sub, { buyerName: 'Off', items: [{ ticketTypeId: tt, qty: 1 }] });
      await webhook({ id: hook, type: 'payment.succeeded', kind: 'ORDER', ref: o.body.orderId });
      return (await call('GET', `/public/orders/${o.body.orderId}`)).body.tickets[0].token as string;
    };
    const tA = await buy('evt-off-a'), tB = await buy('evt-off-b');
    expect((await call('GET', `/events/${S.child}/gate-manifest`, undefined, S.cashier2 ?? S.adminA)).status).toBe(403); // só a portaria
    const man = (await call('GET', `/events/${S.child}/gate-manifest`, undefined, S.gate)).body;
    expect(man.tickets.find((x: any) => x.h === hashToken(tA))).toMatchObject({ s: 'ISSUED' });
    expect(JSON.stringify(man)).not.toContain(tA); // o dispositivo nunca recebe os códigos, só os hashes
    const now = Date.now();
    const batch = (scans: object[]) => call('POST', `/events/${S.child}/scan-batch`, { scans }, S.gate);
    const scans = [
      { clientId: 'c1', token: tA, at: new Date(now - 5000).toISOString(), localResult: 'VALID' },
      { clientId: 'c2', token: tA, at: new Date(now - 4000).toISOString(), localResult: 'VALID' }, // outra porta, também offline
      { clientId: 'c3', token: 'invalido', at: new Date(now - 3000).toISOString(), localResult: 'UNAUTHORIZED' },
      { clientId: 'c4', token: tB, at: new Date(now - 2000).toISOString(), localResult: 'VALID' },
    ];
    const r1 = (await batch(scans)).body;
    expect(Object.fromEntries(r1.results.map((x: any) => [x.clientId, x.result]))).toEqual({ c1: 'VALID', c2: 'ALREADY_USED', c3: 'UNAUTHORIZED', c4: 'VALID' });
    expect(r1.conflicts).toBe(1); // c2: o dispositivo disse VALID mas o bilhete já entrara
    const r2 = (await batch(scans)).body; // reenvio (falha de rede): não duplica
    expect(r2.conflicts).toBe(0);
    const cnt = await db.query<any>(`SELECT count(*)::int AS c FROM entry_scans WHERE event_id=$1 AND offline`, [S.child]);
    expect(cnt.rows[0].c).toBe(4);
    // alertas e actividade
    const alerts = (await call('GET', `/events/${S.child}/alerts`, undefined, S.adminA)).body.map((a: any) => a.text).join(' | ');
    expect(alerts).toContain('conflito');
    const aud = (await call('GET', '/audit', undefined, S.adminA)).body.map((a: any) => a.action);
    expect(aud).toContain('merchant.payout');
    expect((await call('GET', '/audit', undefined, S.adminB)).body.map((a: any) => a.action)).not.toContain('merchant.payout'); // actividade de outra empresa não aparece
    expect((await call('GET', '/audit', undefined, S.gate)).status).toBe(403);
  });

  it('descoberta pública: pesquisa sem acentos, filtros, só eventos publicados de empresas aprovadas', async () => {
    expect((await call('PUT', `/events/${S.event}/details`, { category: 'ESPETACULOS' }, S.adminA)).status).toBe(400);
    expect((await call('PUT', `/events/${S.event}/details`, { location: 'Estádio Nacional', mapUrl: 'https://maps.example/x', category: 'musica' }, S.adminA)).status).toBe(200);
    const find = async (qs: string) => (await call('GET', '/public/events' + qs)).body;
    const slugs = (b: any) => b.items.map((i: any) => i.slug);
    const all = await find('');
    expect(slugs(all)).toContain('festival-de-maputo');
    expect(slugs(all)).not.toContain('festival-de-maputo-2'); // rascunho de outra empresa
    expect(slugs(all)).not.toContain('admin-evento'); // rascunho
    const item = all.items.find((i: any) => i.slug === 'festival-de-maputo');
    expect(item).toMatchObject({ name: 'Festival de Maputo', organization: 'Org A', category: 'MUSICA', location: 'Estádio Nacional' });
    expect(item.minPriceMinor).toBe(String(MT(500)));
    // texto: sem acentos nem maiúsculas, várias palavras, também no organizador
    expect(slugs(await find('?q=estadio'))).toContain('festival-de-maputo');
    expect(slugs(await find('?q=ESTÁDIO%20nacional'))).toContain('festival-de-maputo');
    expect(slugs(await find('?q=org%20a%20festival'))).toContain('festival-de-maputo');
    expect((await find('?q=nada-assim-existe')).total).toBe(0);
    expect((await find('?q=%25')).total).toBe(0); // % e _ não funcionam como curinga
    expect((await find(`?q=${encodeURIComponent("x'; DROP TABLE events;--")}`)).total).toBe(0);
    // filtros
    expect(slugs(await find('?category=MUSICA'))).toContain('festival-de-maputo');
    expect(slugs(await find('?category=TEATRO'))).not.toContain('festival-de-maputo');
    expect((await call('GET', '/public/events?category=SPAM')).status).toBe(400);
    expect(slugs(await find('?free=1'))).not.toContain('festival-de-maputo'); // tem bilhetes pagos
    expect(slugs(await find('?when=today'))).not.toContain('festival-de-maputo'); // é em 2030
    expect(all.facets.find((f: any) => f.category === 'MUSICA').n).toBeGreaterThanOrEqual(1);
    // paginação limitada
    const pg = await find('?limit=1&offset=0');
    expect(pg.items.length).toBeLessThanOrEqual(1);
    expect((await find('?limit=9999')).items.length).toBeLessThanOrEqual(24);
    // empresa suspensa deixa de aparecer
    const root = await login('root@bilhete.test');
    const orgA = (await call('GET', '/orgs', undefined, root)).body.find((o: any) => o.slug === 'org-a');
    await call('POST', `/orgs/${orgA.id}/status`, { status: 'SUSPENDED', reason: 'teste' }, root);
    expect(slugs(await find('')) ).not.toContain('festival-de-maputo');
    await call('POST', `/orgs/${orgA.id}/status`, { status: 'ACTIVE' }, root);
    expect(slugs(await find(''))).toContain('festival-de-maputo');
  });

  it('mapa: coordenadas validadas, nos resultados e na página do evento; pesquisa de moradas com cache; CSP para os mosaicos', async () => {
    const put = (b: object, tk = S.adminA) => call('PUT', `/events/${S.event}/details`, { location: 'Estádio Nacional', category: 'MUSICA', ...b }, tk);
    expect((await put({ latitude: -25.9692 })).status).toBe(400); // só uma coordenada
    expect((await put({ latitude: 95, longitude: 32.5 })).status).toBe(400); // fora do intervalo
    expect((await put({ latitude: 'abc', longitude: 32.5 })).status).toBe(400);
    expect((await put({ latitude: -25.9692, longitude: 32.5732 }, S.adminB)).status).toBe(404); // evento de outra empresa
    expect((await put({ latitude: -25.9692, longitude: 32.5732 })).status).toBe(200);
    const item = (await call('GET', '/public/events?q=festival')).body.items.find((i: any) => i.slug === 'festival-de-maputo');
    expect(item).toMatchObject({ lat: -25.9692, lng: 32.5732 });
    const page = (await call('GET', '/public/events/festival-de-maputo')).body;
    expect(page).toMatchObject({ lat: -25.9692, lng: 32.5732 });
    // eventos sem coordenadas continuam a existir, com lat/lng nulos
    const child = (await call('GET', '/public/events?q=feira')).body.items.find((i: any) => i.slug.startsWith('feira-de-maputo'));
    expect(child ? child.lat : null).toBeNull();
    // moradas: validação, resultado, cache (sem acentos nem maiúsculas) e limite
    expect((await call('GET', '/public/geocode?q=ab')).status).toBe(400);
    const g1 = (await call('GET', '/public/geocode?q=Maputo')).body;
    expect(g1[0]).toMatchObject({ name: 'Maputo, Moçambique', lat: -25.9692 });
    await call('GET', '/public/geocode?q=MAPUTO');
    expect(geoCalls).toEqual(['Maputo']); // a 2.ª pesquisa veio da cache
    // a política de segurança permite os mosaicos do mapa e nada mais de fora
    const csp = (await fetch(base + '/public/config')).headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://tiles.openfreemap.org');
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('empresas criadas pela administração em /staff; registo público fechado por omissão', async () => {
    const root = await login('root@bilhete.test');
    // a administração cria a empresa e ela já fica activa (palavra-passe forte exigida)
    const org = { legalName: 'Criada Lda', tradeName: 'Criada Pelo Admin', nuit: '400999888', adminEmail: 'dono@criada.test', adminName: 'Dono', adminPassword: 'pw123456' };
    expect((await call('POST', '/orgs', { ...org, adminPassword: 'curta' }, root)).status).toBe(400);
    const made = await call('POST', '/orgs', org, root);
    expect(made.body.status).toBe('ACTIVE');
    const t = await login('dono@criada.test');
    expect((await call('GET', '/me', undefined, t)).body).toMatchObject({ orgStatus: 'ACTIVE', orgSlug: 'criada-pelo-admin' });
    expect((await call('POST', '/events', { name: 'Primeiro', startsAt: '2031-05-01T10:00:00Z', endsAt: '2031-05-01T12:00:00Z' }, t)).status).toBe(200);
    expect((await call('POST', '/orgs', org, t)).status).toBe(403); // só a administração cria empresas
    // sem o interruptor ligado, ninguém se regista sozinho
    const closed = createApp(db, { tokenSecret: 'secret-test', webhookSecret: WEBHOOK_SECRET }).listen(0);
    try {
      const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
      const r = await fetch(url + '/public/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ legalName: 'X', tradeName: 'X', nuit: '123456789', contactName: 'X', email: 'x@x.test', password: 'pw123456', acceptTerms: true }) });
      expect(r.status).toBe(404);
      expect(((await (await fetch(url + '/public/config')).json()) as any).selfRegistration).toBe(false);
    } finally { closed.close(); }
    expect((await call('GET', '/public/config')).body.selfRegistration).toBe(true); // instância dos testes com o interruptor ligado
  });

  it('contas de participantes: comprar exige sessão; registo, entrada, os meus bilhetes, palavra-passe e apagar conta', async () => {
    const order = { items: [{ ticketTypeId: S.type, qty: 1 }] };
    const guest = await call('POST', '/public/events/festival-de-maputo/orders', order);
    expect(guest.status).toBe(401);
    expect(guest.body.error).toBe('LOGIN_REQUIRED');
    expect((await call('POST', '/public/events/festival-de-maputo/orders', order, 'token-falso')).status).toBe(401);
    // registo
    expect((await call('POST', '/account/register', { name: 'Rita', email: 'sem-arroba', password: 'pw-rita-12345' })).status).toBe(400);
    expect((await call('POST', '/account/register', { name: 'Rita', email: 'rita@teste.mz', password: 'curta' })).status).toBe(400);
    const reg = await call('POST', '/account/register', { name: 'Rita', email: 'Rita@Teste.mz', password: 'pw-rita-12345', phone: '84 111 2222' });
    expect(reg.status).toBe(200);
    expect(reg.body.account).toMatchObject({ name: 'Rita', email: 'rita@teste.mz' });
    expect((await call('POST', '/account/register', { name: 'Outra', email: 'RITA@teste.mz', password: 'pw-rita-12345' })).status).toBe(409); // e-mail já usado (sem distinguir maiúsculas)
    // entrada
    expect((await call('POST', '/account/login', { email: 'rita@teste.mz', password: 'errada-errada' })).status).toBe(401);
    expect((await call('POST', '/account/login', { email: 'nao@existe.mz', password: 'pw-rita-12345' })).status).toBe(401);
    const tok = (await call('POST', '/account/login', { email: 'RITA@teste.mz', password: 'pw-rita-12345' })).body.token;
    expect((await call('GET', '/account/me', undefined, tok)).body.account.name).toBe('Rita');
    expect((await call('GET', '/account/me')).status).toBe(401);
    expect((await call('GET', '/account/me', undefined, S.adminA)).status).toBe(401); // uma sessão de equipa não é uma conta
    // compra com a conta: o nome e o contacto vêm da conta
    const o = await buyTicket('festival-de-maputo', order, tok);
    expect(o.status).toBe(200);
    const row = (await db.query<any>('SELECT buyer_name,buyer_contact,account_id FROM ticket_orders WHERE id=$1', [o.body.orderId])).rows[0];
    expect(row).toMatchObject({ buyer_name: 'Rita', buyer_contact: 'rita@teste.mz' });
    expect(row.account_id).toBeTruthy();
    // os meus bilhetes: só aparecem os bilhetes depois de pagos, e só os da própria conta
    let mine = (await call('GET', '/account/orders', undefined, tok)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: o.body.orderId, status: 'PENDING_PAYMENT', tickets: [] });
    await webhook({ id: 'evt-acc-' + o.body.orderId, type: 'payment.succeeded', kind: 'ORDER', ref: o.body.orderId });
    mine = (await call('GET', '/account/orders', undefined, tok)).body;
    // ao pagar, o e-mail com os bilhetes sai sozinho para o e-mail da conta
    const auto = (await db.query<any>(`SELECT subject,body FROM notifications WHERE to_email='rita@teste.mz' AND subject LIKE 'Os seus bilhetes%'`)).rows;
    expect(auto).toHaveLength(1);
    expect(auto[0].body).toMatch(/\/t\/[\w-]{22}/);
    const shown = (await call('GET', `/public/orders/${o.body.orderId}`)).body;
    expect(shown.emailedTo).toBe('r***@teste.mz'); // a página só mostra o e-mail mascarado
    expect(shown.buyer_contact).toBeUndefined();
    expect(mine[0].status).toBe('PAID');
    expect(mine[0].tickets[0].token).toHaveLength(22);
    const other = (await call('POST', '/account/register', { name: 'Outro', email: 'outro@teste.mz', password: 'pw-outro-12345' })).body.token;
    expect((await call('GET', '/account/orders', undefined, other)).body).toEqual([]);
    // dados e palavra-passe
    expect((await call('PATCH', '/account/me', { name: 'Rita Silva' }, tok)).body.account.name).toBe('Rita Silva');
    expect((await call('POST', '/account/password', { current: 'errada-errada', next: 'nova-senha-123' }, tok)).status).toBe(401);
    expect((await call('POST', '/account/password', { current: 'pw-rita-12345', next: 'curta' }, tok)).status).toBe(400);
    const second = (await call('POST', '/account/login', { email: 'rita@teste.mz', password: 'pw-rita-12345' })).body.token;
    expect((await call('POST', '/account/password', { current: 'pw-rita-12345', next: 'nova-senha-123' }, tok)).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, second)).status).toBe(401); // as outras sessões terminam
    expect((await call('GET', '/account/me', undefined, tok)).status).toBe(200);
    expect((await call('POST', '/account/login', { email: 'rita@teste.mz', password: 'pw-rita-12345' })).status).toBe(401);
    // sair e apagar a conta (anonimiza; o bilhete continua válido)
    await call('POST', '/account/logout', {}, second);
    expect((await call('DELETE', '/account/me', { password: 'errada-errada' }, tok)).status).toBe(401);
    expect((await call('DELETE', '/account/me', { password: 'nova-senha-123' }, tok)).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, tok)).status).toBe(401);
    expect((await call('POST', '/account/login', { email: 'rita@teste.mz', password: 'nova-senha-123' })).status).toBe(401);
    expect((await db.query<any>(`SELECT email,name FROM accounts WHERE id=$1`, [row.account_id])).rows[0].name).toBe('Conta apagada');
    expect((await call('GET', `/public/tickets/${mine[0].tickets[0].token}`)).status).toBe(200);
  });

  it('entrada com Google: PKCE e estado de uso único, ligado ao navegador; cria ou liga a conta sem deixar tomar contas por e-mail', async () => {
    expect((await call('GET', '/public/config')).body.google).toBe(true);
    const raw = (path: string, cookie?: string) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const start = async (next = '/e/festival-de-maputo') => {
      const r = await raw('/account/google/start?next=' + encodeURIComponent(next));
      const loc = new URL(r.headers.get('location')!);
      return { r, loc, state: loc.searchParams.get('state')!, cookie: 'bp_oauth=' + loc.searchParams.get('state') };
    };
    const s1 = await start();
    expect(s1.r.status).toBe(302);
    expect(s1.loc.origin + s1.loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(s1.loc.searchParams)).toMatchObject({ client_id: 'cid', response_type: 'code', code_challenge_method: 'S256', redirect_uri: 'https://bilhete.test/account/google/callback' });
    expect(s1.loc.searchParams.get('code_challenge')).toHaveLength(43);
    expect(s1.r.headers.get('set-cookie')).toMatch(/bp_oauth=.+HttpOnly.+SameSite=Lax.+Secure/);
    expect(s1.r.headers.get('set-cookie')).not.toContain('Secure;'); // atributo Secure no fim
    // sem o cookie do navegador, o retorno é recusado (protege contra "login CSRF")
    googleStub.c1 = { sub: 'g-1', email: 'Maria@Gmail.com', emailVerified: true, name: 'Maria G' };
    expect((await raw(`/account/google/callback?code=c1&state=${s1.state}`)).headers.get('location')).toBe('/account?error=google_state');
    // retorno correcto: cria a conta e entrega a sessão no fragmento (#)
    const ok = await raw(`/account/google/callback?code=c1&state=${s1.state}`, s1.cookie);
    const back = ok.headers.get('location')!;
    expect(back).toMatch(/^\/account#t=[\w-]+&next=%2Fe%2Ffestival-de-maputo$/);
    const tok1 = /t=([\w-]+)/.exec(back)![1];
    expect((await call('GET', '/account/me', undefined, tok1)).body.account).toMatchObject({ name: 'Maria G', email: 'maria@gmail.com' });
    // o estado só vale uma vez
    expect((await raw(`/account/google/callback?code=c1&state=${s1.state}`, s1.cookie)).headers.get('location')).toBe('/account?error=google_state');
    // a mesma conta Google volta a entrar na mesma conta
    const s2 = await start();
    const again = (await raw(`/account/google/callback?code=c1&state=${s2.state}`, s2.cookie)).headers.get('location')!;
    const tok2 = /t=([\w-]+)/.exec(again)![1];
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM accounts WHERE lower(email)='maria@gmail.com'`)).rows[0].c).toBe(1);
    expect((await call('GET', '/account/me', undefined, tok2)).status).toBe(200);
    // e-mail do Google por verificar, código recusado ou cancelado: não entra
    googleStub.c2 = { sub: 'g-2', email: 'falso@gmail.com', emailVerified: false, name: 'Falso' };
    const s3 = await start();
    expect((await raw(`/account/google/callback?code=c2&state=${s3.state}`, s3.cookie)).headers.get('location')).toBe('/account?error=google_unverified');
    const s4 = await start();
    expect((await raw(`/account/google/callback?code=lixo&state=${s4.state}`, s4.cookie)).headers.get('location')).toBe('/account?error=google_failed');
    expect((await raw('/account/google/callback?error=access_denied&state=x')).headers.get('location')).toBe('/account?error=google_cancelled');
    // destino inseguro é trocado por /account
    const s5 = await start('//evil.test');
    googleStub.c3 = { sub: 'g-3', email: 'tres@gmail.com', emailVerified: true, name: 'Tres' };
    expect((await raw(`/account/google/callback?code=c3&state=${s5.state}`, s5.cookie)).headers.get('location')).toMatch(/&next=%2Faccount$/);
    // a partir de um evento (subdomínio do domínio base) a sessão volta ao próprio subdomínio; de sítios de terceiros, nunca
    const sEv = await start('https://feira.bilhete.test/e/feira?x=1');
    googleStub.c5 = { sub: 'g-5', email: 'cinco@gmail.com', emailVerified: true, name: 'Cinco' };
    expect((await raw(`/account/google/callback?code=c5&state=${sEv.state}`, sEv.cookie)).headers.get('location')).toMatch(/^https:\/\/feira\.bilhete\.test\/account#t=[\w-]+&next=%2Fe%2Ffeira%3Fx%3D1$/);
    const sBad = await start('https://evil.test/e/x');
    expect((await raw(`/account/google/callback?code=c5&state=${sBad.state}`, sBad.cookie)).headers.get('location')).toMatch(/^\/account#t=[\w-]+&next=%2Faccount$/);
    const sBad2 = await start('https://bilhete.test.evil.test/');
    expect((await raw(`/account/google/callback?code=c5&state=${sBad2.state}`, sBad2.cookie)).headers.get('location')).toMatch(/^\/account#t=/);
    // app instalada: o Google abre noutro contexto, por isso a sessão passa à app por um pedido secreto (poll), de uso único
    const rid = 'r'.repeat(10) + '0123456789abcdefghijklmnopqrstuv';
    const poll = (r = rid) => call('GET', `/account/google/poll?rid=${r}`);
    expect((await poll('curto')).status).toBe(400);
    expect((await poll()).body).toEqual({ done: false });
    const hs = await raw('/account/google/start?next=/account&rid=' + rid);
    const hState = new URL(hs.headers.get('location')!).searchParams.get('state')!;
    googleStub.c6 = { sub: 'g-6', email: 'seis@gmail.com', emailVerified: true, name: 'Seis' };
    expect((await raw(`/account/google/callback?code=c6&state=${hState}`, 'bp_oauth=' + hState)).headers.get('location')).toBe('/account/done'); // nada de token no endereço
    expect((await poll('x'.repeat(40))).body).toEqual({ done: false }); // outro pedido não recebe a sessão
    const got = (await poll()).body;
    expect(got.done).toBe(true);
    expect((await call('GET', '/account/me', undefined, got.token)).body.account.email).toBe('seis@gmail.com');
    expect((await poll()).body).toEqual({ done: false }); // só se entrega uma vez
    // alguém registou o e-mail de outra pessoa com palavra-passe (sem o confirmar): quando o dono entra com Google, a palavra-passe do intruso deixa de valer
    await call('POST', '/account/register', { name: 'Intruso', email: 'vitima@gmail.com', password: 'pw-intruso-123' });
    const intruder = (await call('POST', '/account/login', { email: 'vitima@gmail.com', password: 'pw-intruso-123' })).body.token;
    googleStub.c4 = { sub: 'g-4', email: 'vitima@gmail.com', emailVerified: true, name: 'Vítima' };
    const s6 = await start();
    const owner = /t=([\w-]+)/.exec((await raw(`/account/google/callback?code=c4&state=${s6.state}`, s6.cookie)).headers.get('location')!)![1];
    expect((await call('GET', '/account/me', undefined, owner)).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, intruder)).status).toBe(401);
    expect((await call('POST', '/account/login', { email: 'vitima@gmail.com', password: 'pw-intruso-123' })).status).toBe(401);
    // contas só Google não podem entrar com palavra-passe (e não rebenta)
    expect((await call('POST', '/account/login', { email: 'maria@gmail.com', password: '-' })).status).toBe(401);
    // contas só Google: sem palavra-passe para mudar; apagar confirma-se com o e-mail
    expect((await call('GET', '/account/me', undefined, tok1)).body.account.hasPassword).toBe(false);
    expect((await call('POST', '/account/password', { current: 'x', next: 'nova-senha-123' }, tok1)).status).toBe(409);
    expect((await call('DELETE', '/account/me', { confirm: 'outro@gmail.com' }, tok1)).status).toBe(401);
    expect((await call('DELETE', '/account/me', { confirm: ' MARIA@gmail.com ' }, tok1)).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, tok1)).status).toBe(401);
  });

  it('controlo de bilhetes: pesquisar, bloquear e desbloquear (reversível), cancelar (definitivo), sempre com motivo e só na própria empresa', async () => {
    await db.query('UPDATE ticket_types SET quantity=quantity+5 WHERE id=$1', [S.type]);
    const mk = async (name: string) => {
      const o = (await buyTicket('festival-de-maputo', { buyerName: name, buyerContact: name.toLowerCase() + '@teste.mz', items: [{ ticketTypeId: S.type, qty: 1 }] })).body.orderId;
      await webhook({ id: 'evt-tc-' + o, type: 'payment.succeeded', kind: 'ORDER', ref: o });
      return (await call('GET', `/public/orders/${o}`)).body.tickets[0] as { id: string; token: string; shortCode: string };
    };
    const scan = (token: string) => call('POST', `/events/${S.event}/scan`, { token, gateId: S.gateId }, S.gate);
    const t1 = await mk('Controlada');
    // pesquisa: por nome, por código completo e por estado
    const byName = (await call('GET', `/events/${S.event}/tickets?q=controlada`, undefined, S.adminA)).body;
    expect(byName.map((x: any) => x.id)).toContain(t1.id);
    expect((await call('GET', `/events/${S.event}/tickets?q=${t1.token}`, undefined, S.adminA)).body.map((x: any) => x.id)).toEqual([t1.id]);
    expect((await call('GET', `/events/${S.event}/tickets?status=BLOCKED`, undefined, S.adminA)).body.map((x: any) => x.id)).not.toContain(t1.id);
    expect((await call('GET', `/events/${S.event}/tickets`, undefined, S.gate)).status).toBe(403); // a porta não gere bilhetes
    // bloquear exige motivo, respeita a empresa e impede a entrada
    expect((await call('POST', `/tickets/${t1.id}/block`, {}, S.adminA)).status).toBe(400);
    expect((await call('POST', `/tickets/${t1.id}/block`, { reason: 'ab' }, S.adminA)).status).toBe(400);
    expect((await call('POST', `/tickets/${t1.id}/block`, { reason: 'Pagamento contestado' }, S.adminB)).status).toBe(404);
    expect((await call('POST', `/tickets/${t1.id}/block`, { reason: 'Pagamento contestado' }, S.adminA)).status).toBe(200);
    expect((await call('POST', `/tickets/${t1.id}/block`, { reason: 'outra vez' }, S.adminA)).status).toBe(409);
    const blocked = (await scan(t1.token)).body;
    expect(blocked.result).toBe('BLOCKED');
    expect(blocked.ticket.reason).toBe('Pagamento contestado');
    expect((await db.query<any>(`SELECT w.status FROM tickets t JOIN wallets w ON w.id=t.wallet_id WHERE t.id=$1`, [t1.id])).rows[0].status).toBe('BLOCKED'); // sem pagamentos
    const row = (await call('GET', `/events/${S.event}/tickets?status=BLOCKED`, undefined, S.adminA)).body.find((x: any) => x.id === t1.id);
    expect(row).toMatchObject({ status: 'BLOCKED', reason: 'Pagamento contestado', holder: 'Controlada' });
    expect((await call('GET', `/events/${S.event}/gate-manifest`, undefined, S.gate)).body.tickets.find((x: any) => x.s === 'BLOCKED')).toBeTruthy(); // a porta offline também o sabe
    // desbloquear repõe o estado anterior
    expect((await call('POST', `/tickets/${t1.id}/unblock`, {}, S.adminB)).status).toBe(404);
    expect((await call('POST', `/tickets/${t1.id}/unblock`, {}, S.adminA)).body.status).toBe('ISSUED');
    expect((await call('POST', `/tickets/${t1.id}/unblock`, {}, S.adminA)).status).toBe(409);
    // a portaria também aceita o código curto (8 caracteres, com ou sem hífen, em maiúsculas ou minúsculas)
    expect(t1.shortCode).toMatch(/^[A-Z2-9]{8}$/);
    expect((await scan(t1.shortCode.slice(0, 4).toLowerCase() + '-' + t1.shortCode.slice(4))).body.result).toBe('VALID');
    expect((await scan(t1.shortCode)).body.result).toBe('ALREADY_USED');
    expect((await scan('ZZZZZZZZ')).body.result).toBe('UNAUTHORIZED');
    // um bilhete já usado, bloqueado e desbloqueado, volta a "usado"
    expect((await call('POST', `/tickets/${t1.id}/block`, { reason: 'Verificação' }, S.adminA)).status).toBe(200);
    expect((await call('POST', `/tickets/${t1.id}/unblock`, {}, S.adminA)).body.status).toBe('USED');
    expect((await scan(t1.token)).body.result).toBe('ALREADY_USED');
    // cancelar: definitivo, com motivo
    expect((await call('POST', `/tickets/${t1.id}/cancel`, {}, S.adminA)).status).toBe(400);
    expect((await call('POST', `/tickets/${t1.id}/cancel`, { reason: 'Fraude confirmada' }, S.adminB)).status).toBe(404);
    expect((await call('POST', `/tickets/${t1.id}/cancel`, { reason: 'Fraude confirmada' }, S.adminA)).body.status).toBe('REVOKED');
    expect((await call('POST', `/tickets/${t1.id}/cancel`, { reason: 'de novo' }, S.adminA)).status).toBe(409);
    expect((await call('POST', `/tickets/${t1.id}/unblock`, {}, S.adminA)).status).toBe(409);
    const gone = (await scan(t1.token)).body;
    expect(gone.result).toBe('REVOKED');
    expect(gone.ticket.reason).toBe('Fraude confirmada');
    // tudo fica registado
    const acts = (await db.query<any>(`SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY id`, [t1.id])).rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['ticket.block', 'ticket.unblock', 'ticket.cancel']));
    // um cancelado pode ser visto pela conta de quem comprou como cancelado
    expect((await call('GET', `/public/tickets/${t1.token}`)).body.ticketStatus).toBe('REVOKED');
  });

  it('entrada por telemóvel: código por SMS, sem e-mail nem palavra-passe; nome só na primeira vez; limites e erros', async () => {
    expect((await call('GET', '/public/config')).body.phone).toBe(true);
    const codeFor = (phone: string) => /\b(\d{6})\b/.exec([...smsSent].reverse().find((m) => m.to === phone)!.text)![1];
    const start = (phone: string) => call('POST', '/account/phone/start', { phone });
    const verify = (phone: string, code: string, name?: string) => call('POST', '/account/phone/verify', { phone, code, name });
    // número inválido e formatos aceites
    expect((await start('abc')).status).toBe(400);
    expect((await start('82 123 45')).status).toBe(400);
    expect((await start('+258 91 234 5678')).status).toBe(400); // Moçambique: 82–87
    expect((await start('84 111 2233')).status).toBe(200);
    expect(smsSent.at(-1)!.to).toBe('+258841112233'); // normalizado
    expect(smsSent.at(-1)!.text).toMatch(/Bilhete\+.*\d{6}/);
    // código errado não entra; o certo, sem nome, pede o nome (e o código continua válido)
    const good = codeFor('+258841112233');
    const wrong = good === '000000' ? '111111' : '000000';
    expect((await verify('84 111 2233', wrong)).status).toBe(401);
    const noName = await verify('84 111 2233', good);
    expect(noName.status).toBe(400);
    expect(noName.body.error).toMatch(/nome/);
    const reg = await verify('+258841112233', good, 'Joana da Praça');
    expect(reg.status).toBe(200);
    expect(reg.body.account).toMatchObject({ name: 'Joana da Praça', email: null, phone: '+258841112233' });
    const tok = reg.body.token;
    expect((await call('GET', '/account/me', undefined, tok)).body.account).toMatchObject({ phone: '+258841112233', hasPassword: false, newsletter: false });
    // o código só vale uma vez
    expect((await verify('84 111 2233', good, 'Outro Nome')).status).toBe(401);
    // compra com a conta por telemóvel: o contacto é o número (não há e-mail para enviar)
    await db.query('UPDATE ticket_types SET quantity=quantity+3 WHERE id=$1', [S.type]);
    const o = await buyTicket('festival-de-maputo', { items: [{ ticketTypeId: S.type, qty: 1 }] }, tok);
    expect(o.status).toBe(200);
    expect((await db.query<any>('SELECT buyer_name,buyer_contact FROM ticket_orders WHERE id=$1', [o.body.orderId])).rows[0]).toMatchObject({ buyer_name: 'Joana da Praça', buyer_contact: '+258841112233' });
    await webhook({ id: 'evt-ph-' + o.body.orderId, type: 'payment.succeeded', kind: 'ORDER', ref: o.body.orderId });
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM notifications WHERE subject LIKE 'Os seus bilhetes%' AND to_email='+258841112233'`)).rows[0].c).toBe(0);
    expect((await call('GET', `/public/orders/${o.body.orderId}`)).body.emailedTo).toBeNull();
    // voltar a entrar com outro formato do mesmo número entra na mesma conta (sem pedir o nome)
    await start('0841112233');
    const back = await verify('0841112233', codeFor('+258841112233'));
    expect(back.status).toBe(200);
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM accounts WHERE phone_e164='+258841112233' AND status='ACTIVE'`)).rows[0].c).toBe(1);
    // no máximo 3 códigos por número em 15 minutos
    for (let i = 0; i < 3; i++) expect((await start('86 333 4455')).status).toBe(200);
    expect((await start('86 333 4455')).status).toBe(429);
    expect((await start('86 333 4456')).status).toBe(200); // outro número não é afectado
    // 5 tentativas erradas bloqueiam o código
    await start('85 222 3344');
    const c2 = codeFor('+258852223344');
    const bad = c2 === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect((await verify('85 222 3344', bad, 'Teste')).status).toBe(401);
    expect((await verify('85 222 3344', c2, 'Teste')).status).toBe(401); // já bloqueado, mesmo com o certo
    // apagar a conta confirma-se escrevendo o número
    expect((await call('DELETE', '/account/me', { confirm: '84 999 0000' }, tok)).status).toBe(401);
    expect((await call('DELETE', '/account/me', { confirm: '84 111 2233' }, tok)).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, tok)).status).toBe(401);
  });

  it('app instalável da equipa: manifesto por empresa e da plataforma, sem revelar empresas inexistentes', async () => {
    const slug = (await call('GET', '/me', undefined, S.adminA)).body.orgSlug;
    const m = await fetch(base + `/company/${slug}/manifest.webmanifest`);
    expect(m.headers.get('content-type')).toMatch(/manifest\+json/);
    const mj: any = await m.json();
    expect(mj).toMatchObject({ display: 'standalone', start_url: `/company/${slug}/`, scope: `/company/${slug}/` });
    expect(mj.name).toMatch(/^Bilhete\+ Equipa — /);
    const gen: any = await (await fetch(base + '/company/nao-existe-xyz/manifest.webmanifest')).json(); // neutro: não revela se existe
    expect(gen.name).toBe('Bilhete+ Equipa');
    expect(gen.start_url).toBe('/company/');
    const pm: any = await (await fetch(base + '/platform/manifest.webmanifest')).json();
    // no subdomínio platform.<domínio> a app da plataforma abre na raiz e nada dali é indexável
    const onHost = await fetch(base + '/platform/manifest.webmanifest', { headers: { 'x-forwarded-host': 'platform.bilhete.test' } });
    expect(((await onHost.json()) as any).start_url).toBe('/');
    expect((await fetch(base + '/anything', { headers: { 'x-forwarded-host': 'platform.bilhete.test' } })).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(pm).toMatchObject({ name: 'Bilhete+ Administração', start_url: '/platform/' });
  });

  it('notificações push: subscrever, aviso de novo evento (uma vez), bilhetes confirmados, lembrete 24 h antes, limpeza de subscrições mortas', async () => {
    const drain = () => appInst.drain();
    expect((await call('GET', '/public/config')).body.push).toBe(true);
    expect((await call('GET', '/public/push/config')).body.publicKey).toBe('BPUBLIC-TEST-KEY');
    const sub = (name: string, extra: object = {}, tok?: string) => call('POST', '/public/push/subscribe', { subscription: { endpoint: `https://push.example.test/${name}-endpoint-abcdef`, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) } }, ...extra }, tok);
    expect((await call('POST', '/public/push/subscribe', { subscription: { endpoint: 'http://inseguro/x', keys: {} } })).status).toBe(400);
    expect((await sub('anon')).status).toBe(200);
    expect((await sub('gone')).status).toBe(200);
    expect((await sub('soBilhetes', { topics: ['tickets'] })).status).toBe(200);
    const acc = (await call('POST', '/account/register', { name: 'Push', email: 'push@teste.mz', password: 'pw-push-12345' })).body.token;
    expect((await sub('conta', {}, acc)).status).toBe(200);
    expect((await db.query<any>(`SELECT account_id FROM push_subscriptions WHERE endpoint LIKE '%conta-endpoint%'`)).rows[0].account_id).toBeTruthy(); // ligada à conta
    // primeira publicação: avisa quem quer «novos eventos»; a subscrição morta é apagada; quem só quer bilhetes não recebe
    const ev = (await call('POST', '/events', { name: 'Festival Novidade', location: 'Maputo', startsAt: '2031-07-01T10:00:00Z', endsAt: '2031-07-01T22:00:00Z' }, S.adminA)).body;
    pushSent.length = 0;
    await call('POST', `/events/${ev.id}/publish`, {}, S.adminA); await drain();
    const got = pushSent.map((x) => x.endpoint);
    expect(got.some((e) => e.includes('anon-endpoint'))).toBe(true);
    expect(got.some((e) => e.includes('conta-endpoint'))).toBe(true);
    expect(got.some((e) => e.includes('soBilhetes'))).toBe(false);
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM push_subscriptions WHERE endpoint LIKE '%gone-endpoint%'`)).rows[0].c).toBe(0);
    expect(pushSent[0].msg).toMatchObject({ title: 'Novo evento no Bilhete+', url: expect.stringContaining(ev.subdomain) });
    expect(pushSent[0].msg.body).toContain('Festival Novidade');
    pushSent.length = 0;
    await call('POST', `/events/${ev.id}/publish`, {}, S.adminA); await drain();
    expect(pushSent).toHaveLength(0); // publicar outra vez não volta a avisar
    // compra paga: a conta recebe «bilhetes confirmados»
    const tt = (await call('POST', `/events/${ev.id}/ticket-types`, { name: 'Geral', priceMinor: MT(50), quantity: 5 }, S.adminA)).body.id;
    const o = await buyTicket(ev.subdomain, { items: [{ ticketTypeId: tt, qty: 1 }] }, acc);
    expect(o.status).toBe(200);
    await webhook({ id: 'evt-push-' + o.body.orderId, type: 'payment.succeeded', kind: 'ORDER', ref: o.body.orderId }); await drain();
    const paid = pushSent.filter((x) => x.msg.title === 'Bilhetes confirmados');
    expect(paid.map((x) => x.endpoint)).toEqual(expect.arrayContaining([expect.stringContaining('conta-endpoint'), expect.stringContaining('soBilhetes')].slice(0, 1)));
    expect(paid.every((x) => !x.endpoint.includes('anon-endpoint'))).toBe(true); // só o aparelho da conta
    // lembrete 24 h antes: uma só vez
    await db.query(`UPDATE events SET starts_at=now()+interval '20 hours', ends_at=now()+interval '30 hours' WHERE id=$1`, [ev.id]);
    pushSent.length = 0;
    expect(await appInst.runPushReminders()).toBeGreaterThan(0);
    expect(pushSent.some((x) => x.msg.title === 'O seu evento é amanhã')).toBe(true);
    pushSent.length = 0;
    expect(await appInst.runPushReminders()).toBe(0);
    // sair
    await call('POST', '/public/push/unsubscribe', { endpoint: 'https://push.example.test/anon-endpoint-abcdef' });
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM push_subscriptions WHERE endpoint LIKE '%anon-endpoint%'`)).rows[0].c).toBe(0);
  });

  it('endereço curto do evento: sugerido pelo nome, verificado, nunca duplicado nem reservado', async () => {
    const mk = (sub?: string, name = 'Festival Curto') => call('POST', '/events', { name, startsAt: '2031-05-01T10:00:00Z', endsAt: '2031-05-01T22:00:00Z', ...(sub ? { subdomain: sub } : {}) }, S.adminA);
    const check = async (q: string) => (await call('GET', `/events/subdomain-check?q=${encodeURIComponent(q)}`, undefined, S.adminA)).body;
    expect((await call('GET', '/events/subdomain-check?q=x', undefined, S.gate)).status).toBe(403);
    expect(await check('Meu Evento Único!')).toMatchObject({ slug: 'meu-evento-unico', available: true });
    expect(await check('ab')).toMatchObject({ available: false, reason: 'curto' });
    expect(await check('admin')).toMatchObject({ available: false, reason: 'reservado', suggestion: expect.stringMatching(/^admin-evento(-\d+)?$/) });
    expect(await check('platform')).toMatchObject({ available: false, reason: 'reservado' });
    // escolher um endereço livre funciona e passa a estar em uso
    const first = await mk('meu-evento-unico');
    expect(first.status).toBe(200);
    expect(first.body.subdomain).toBe('meu-evento-unico');
    const again = await check('meu-evento-unico');
    expect(again).toMatchObject({ available: false, reason: 'em uso', suggestion: 'meu-evento-unico-2' });
    // um endereço escolhido nunca é alterado em silêncio: ocupado, reservado ou curto demais são recusados
    expect((await mk('meu-evento-unico')).status).toBe(409);
    expect((await call('POST', '/events', { name: 'Outro', startsAt: '2031-05-01T10:00:00Z', endsAt: '2031-05-01T22:00:00Z', subdomain: 'meu-evento-unico' }, S.adminB)).status).toBe(409); // nem de outra empresa
    expect((await mk('admin')).status).toBe(409);
    expect((await mk('ab')).status).toBe(409);
    // sem endereço escolhido, o sistema gera um a partir do nome e evita duplicados
    const auto1 = await mk(undefined, 'Noite do Fado');
    const auto2 = await mk(undefined, 'Noite do Fado');
    expect(auto1.body.subdomain).toBe('noite-do-fado');
    expect(auto2.body.subdomain).toBe('noite-do-fado-2');
    expect(await check('noite-do-fado')).toMatchObject({ available: false, suggestion: 'noite-do-fado-3' });
  });

  it('evento terminado: já não vende bilhetes nem aceita pagar encomendas pendentes', async () => {
    const ev = (await call('POST', '/events', { name: 'Evento Que Acaba', startsAt: '2031-06-01T10:00:00Z', endsAt: '2031-06-01T22:00:00Z' }, S.adminA)).body;
    await call('POST', `/events/${ev.id}/publish`, {}, S.adminA);
    const tt = (await call('POST', `/events/${ev.id}/ticket-types`, { name: 'Geral', priceMinor: MT(100), quantity: 10 }, S.adminA)).body.id;
    const order = { items: [{ ticketTypeId: tt, qty: 1 }] };
    const pending = await buyTicket(ev.subdomain, order);
    expect(pending.status).toBe(200); // antes do fim, compra-se
    await db.query(`UPDATE events SET starts_at=now()-interval '2 days', ends_at=now()-interval '1 day' WHERE id=$1`, [ev.id]);
    const late = await buyTicket(ev.subdomain, order);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/já terminou/);
    expect((await call('POST', `/public/orders/${pending.body.orderId}/pay`, { phone: '84 123 4567' })).status).toBe(409); // nem pagar a encomenda que ficou por pagar
    expect((await db.query<any>('SELECT count(*)::int AS c FROM ticket_orders WHERE event_id=$1', [ev.id])).rows[0].c).toBe(1); // a recusada não deixou nada
  });

  it('backoffices separados: a área /platform é só da Bilhete+ e cada empresa entra pela sua', async () => {
    const asPlatform = (email: string) => call('POST', '/auth/login', { email, password: 'pw123456', area: 'platform' });
    expect((await asPlatform('root@bilhete.test')).status).toBe(200);
    expect((await asPlatform('adminA@org.test')).status).toBe(401); // um administrador de empresa não entra na plataforma
    expect((await call('POST', '/auth/login', { email: 'root@bilhete.test', password: 'pw123456', org: 'org-a' })).status).toBe(401); // nem a plataforma na área de uma empresa
  });

  it('endereços das áreas privadas: sem enumeração, sem indexação e com travão de tentativas por e-mail', async () => {
    // um endereço de empresa que não existe responde igual a um que existe (sem revelar quais existem)
    const nope = await call('GET', '/public/org/nao-existe-xyz');
    expect(nope.status).toBe(200);
    expect(nope.body.name).toBeNull();
    // tentativas falhadas seguidas bloqueiam a conta durante um tempo, mesmo vindas de IPs diferentes
    const bad = () => call('POST', '/auth/login', { email: 'travao@teste.mz', password: 'errada-errada' }, undefined, { 'x-forwarded-for': '10.1.1.' + Math.floor(Math.random() * 200) });
    for (let i = 0; i < 8; i++) expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(429);
    expect((await call('POST', '/auth/login', { email: 'root@bilhete.test', password: 'pw123456' })).status).toBe(200); // outras contas não são afectadas
    // as páginas de entrada não são indexáveis
    const r = await fetch(base + '/platform');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('newsletter: subscrito por omissão, desligável no perfil e por ligação do e-mail; só a plataforma envia', async () => {
    const root = await login('root@bilhete.test');
    const mkAcc = async (email: string, extra: object = {}) => (await call('POST', '/account/register', { name: 'Leitor ' + email.split('@')[0], email, password: 'pw-leitor-1234', ...extra })).body.token as string;
    const subA = await mkAcc('nl-a@teste.mz');
    const subB = await mkAcc('nl-b@teste.mz', { newsletter: false }); // quem desmarca no registo não fica subscrito
    expect((await call('GET', '/account/me', undefined, subA)).body.account.newsletter).toBe(true);
    expect((await call('GET', '/account/me', undefined, subB)).body.account.newsletter).toBe(false);
    // o perfil liga e desliga
    expect((await call('PATCH', '/account/me', { newsletter: false }, subA)).body.account.newsletter).toBe(false);
    expect((await call('PATCH', '/account/me', { newsletter: true }, subA)).body.account.newsletter).toBe(true);
    // só a administração da plataforma envia
    expect((await call('POST', '/platform/newsletter', { subject: 'Olá', body: 'Mensagem de teste' }, S.adminA)).status).toBe(403);
    expect((await call('POST', '/platform/newsletter', { subject: 'x', body: 'curta' }, root)).status).toBe(400);
    const before = (await call('GET', '/platform/newsletter', undefined, root)).body.subscribers as number;
    expect(before).toBe((await db.query<any>(`SELECT count(*)::int AS c FROM accounts WHERE status='ACTIVE' AND newsletter`)).rows[0].c);
    // envio de teste: só para um e-mail
    const t = await call('POST', '/platform/newsletter', { subject: 'Novidades de Novembro', body: 'Há novos eventos no Bilhete+!', testTo: 'eu@teste.mz' }, root);
    expect(t.body).toMatchObject({ test: true, recipients: 1 });
    // envio real: chega a quem está subscrito, não a quem saiu, e cada mensagem traz a sua ligação para sair
    const sent = await call('POST', '/platform/newsletter', { subject: 'Novidades de Novembro', body: 'Há novos eventos no Bilhete+!' }, root);
    expect(sent.body.recipients).toBe(before);
    const mails = (await db.query<any>(`SELECT to_email,body FROM notifications WHERE subject='Novidades de Novembro'`)).rows;
    expect(mails).toHaveLength(before);
    expect(mails.map((m: any) => m.to_email)).toContain('nl-a@teste.mz');
    expect(mails.map((m: any) => m.to_email)).not.toContain('nl-b@teste.mz');
    const link = /newsletter\/unsubscribe\?a=([0-9a-f-]{36})&t=([\w-]{22})/.exec(mails.find((m: any) => m.to_email === 'nl-a@teste.mz').body)!;
    // sair pela ligação do e-mail (sem sessão); uma ligação adulterada não funciona
    expect((await call('POST', '/public/newsletter/unsubscribe', { a: link[1], t: 'X'.repeat(22) })).status).toBe(400);
    expect((await call('POST', '/public/newsletter/unsubscribe', { a: link[1], t: 'curto' })).status).toBe(400);
    expect((await call('POST', '/public/newsletter/unsubscribe', { a: link[1], t: link[2] })).status).toBe(200);
    expect((await call('GET', '/account/me', undefined, subA)).body.account.newsletter).toBe(false);
    expect((await call('GET', '/platform/newsletter', undefined, root)).body.subscribers).toBe(before - 1);
    const again = await call('POST', '/platform/newsletter', { subject: 'Segunda edição', body: 'Mais uma novidade para si.' }, root);
    expect(again.body.recipients).toBe(before - 1);
    expect((await call('GET', '/platform/newsletter', undefined, root)).body.campaigns).toHaveLength(2);
  });

  it('M-Pesa automático: recargas e bilhetes só pelo M-Pesa; recusa, resposta perdida, expiração e duplo clique', async () => {
    await db.query('UPDATE ticket_types SET quantity=quantity+5 WHERE id=$1', [S.type]); // os testes anteriores já gastaram stock
    const drain = () => appInst.drain();
    const reconcile = () => appInst.reconcileMpesa();
    const bal = async () => BigInt((await call('GET', `/public/tickets/${S.onlineToken}`)).body.balanceMinor);
    expect((await call('GET', '/public/config')).body.mpesa).toBe(true);
    const topup = (amount: number, phone = '84 123 4567') => call('POST', `/public/tickets/${S.onlineToken}/topup`, { provider: 'mpesa', amountMinor: amount, phone });
    const b0 = await bal();
    expect((await topup(MT(100), '82 123 4567')).status).toBe(400); // não é Vodacom
    expect((await topup(0)).status).toBe(400);
    // sucesso: o saldo só sobe depois de o M-Pesa confirmar
    const ok = await topup(MT(100));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('PENDING');
    await drain();
    expect((await call('GET', `/public/charges/${ok.body.chargeId}`)).body).toMatchObject({ status: 'CONFIRMED', kind: 'TOPUP' });
    expect(await bal()).toBe(b0 + BigInt(MT(100)));
    expect(mpesaStub.calls[0]).toMatchObject({ msisdn: '258841234567', amountMinor: BigInt(MT(100)) });
    expect(mpesaStub.calls[0].reference).toMatch(/^BP[0-9a-f]{16}$/);
    // recusa: nada é creditado e o pedido fica FAILED
    mpesaStub.next.push({ outcome: 'FAILED', code: 'INS-2006', message: 'Saldo M-Pesa insuficiente.' });
    const no = await topup(MT(50)); await drain();
    expect((await call('GET', `/public/charges/${no.body.chargeId}`)).body).toMatchObject({ status: 'FAILED', reason: 'Saldo M-Pesa insuficiente.' });
    expect(await bal()).toBe(b0 + BigInt(MT(100)));
    expect((await db.query<any>('SELECT status FROM topup_requests WHERE id=$1', [no.body.topupId])).rows[0].status).toBe('FAILED');
    // resposta perdida: fica por confirmar; a verificação confirma UMA só vez
    mpesaStub.next.push({ outcome: 'UNKNOWN', code: 'INS-9', message: 'sem resposta' });
    const lost = await topup(MT(20)); await drain();
    expect((await call('GET', `/public/charges/${lost.body.chargeId}`)).body.status).toBe('PENDING');
    expect(await bal()).toBe(b0 + BigInt(MT(100)));
    await db.query(`UPDATE mpesa_charges SET updated_at = now() - interval '5 minutes' WHERE id=$1`, [lost.body.chargeId]);
    mpesaStub.query = { outcome: 'SUCCESS', code: 'INS-0', message: 'ok' };
    await reconcile(); await reconcile();
    expect(await bal()).toBe(b0 + BigInt(MT(120)));
    expect((await db.query<any>(`SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE idempotency_key=$1`, ['topup:' + lost.body.topupId])).rows[0].c).toBe(1);
    // sem confirmação durante muito tempo: expira e liberta
    mpesaStub.next.push({ outcome: 'UNKNOWN', code: 'NETWORK', message: 'x' });
    const dead = await topup(MT(10)); await drain();
    await db.query(`UPDATE mpesa_charges SET created_at = now() - interval '40 minutes', updated_at = now() - interval '5 minutes' WHERE id=$1`, [dead.body.chargeId]);
    mpesaStub.query = { outcome: 'PENDING', code: 'INS-0', message: '' };
    await reconcile();
    expect((await call('GET', `/public/charges/${dead.body.chargeId}`)).body.status).toBe('FAILED');
    expect(await bal()).toBe(b0 + BigInt(MT(120)));
    expect((await topup(MT(5000))).status).toBe(400); // os limites do evento aplicam-se também ao M-Pesa
    // bilhetes: só são emitidos quando o M-Pesa confirma
    const o = await buyTicket('festival-de-maputo', { buyerName: 'M-Pesa', items: [{ ticketTypeId: S.type, qty: 1 }] });
    const oid = o.body.orderId;
    expect((await call('POST', `/public/orders/${oid}/pay`, { phone: 'abc' })).status).toBe(400);
    mpesaStub.next.push({ outcome: 'FAILED', code: 'INS-5', message: 'cancelado' });
    expect((await call('POST', `/public/orders/${oid}/pay`, { phone: '85 765 4321' })).status).toBe(200); await drain();
    const still = (await call('GET', `/public/orders/${oid}`)).body;
    expect(still.status).toBe('PENDING_PAYMENT');
    expect(still.tickets[0].token).toBeNull(); // sem pagamento, sem bilhete
    // duplo clique: com um pagamento em curso, o segundo pedido é recusado
    let release: (v: any) => void = () => {};
    mpesaStub.next.push(() => new Promise((r) => { release = r; }));
    expect((await call('POST', `/public/orders/${oid}/pay`, { phone: '85 765 4321' })).status).toBe(200);
    await vi.waitFor(() => expect(mpesaStub.calls.length).toBeGreaterThanOrEqual(6));
    expect((await call('POST', `/public/orders/${oid}/pay`, { phone: '85 765 4321' })).status).toBe(409);
    release({ outcome: 'SUCCESS', code: 'INS-0', message: 'ok', transactionId: 'TX-ORD' });
    await drain();
    const paid = (await call('GET', `/public/orders/${oid}`)).body;
    expect(paid.status).toBe('PAID');
    expect(paid.tickets[0].token).toHaveLength(22);
    expect((await call('POST', `/public/orders/${oid}/pay`, { phone: '85 765 4321' })).status).toBe(409); // já paga
    await webhook({ id: 'evt-dup-order', type: 'payment.succeeded', kind: 'ORDER', ref: oid }); // um evento repetido não emite outra vez
    expect((await db.query<any>('SELECT count(*)::int AS c FROM tickets WHERE order_id=$1', [oid])).rows[0].c).toBe(1);
    // administração: lista de eventos com receita e resumo de rendimento (só a plataforma)
    const root = await login('root@bilhete.test');
    const all = (await call('GET', '/platform/events', undefined, root)).body;
    const row = all.find((e: any) => e.id === S.event);
    expect(row).toMatchObject({ organization: expect.any(String) });
    expect(BigInt(row.revenue_minor)).toBeGreaterThan(0n);
    const sum = (await call('GET', `/platform/events/${S.event}/summary`, undefined, root)).body;
    expect(BigInt(sum.tickets.revenueMinor)).toBe(BigInt(row.revenue_minor));
    expect(BigInt(sum.totalMinor)).toBeGreaterThanOrEqual(BigInt(sum.tickets.revenueMinor));
    expect((await call('GET', `/platform/events/${S.event}/summary`, undefined, S.adminA)).status).toBe(403);
    // envio dos bilhetes por e-mail: só encomendas pagas, e-mail válido, com limite
    expect((await call('POST', `/public/orders/${oid}/email`, { email: 'sem-arroba' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await call('POST', `/public/orders/${oid}/email`, { email: 'cliente@exemplo.mz' })).status).toBe(200);
    expect((await call('POST', `/public/orders/${oid}/email`, { email: 'cliente@exemplo.mz' })).status).toBe(429);
    const mail = (await db.query<any>(`SELECT body FROM notifications WHERE to_email='cliente@exemplo.mz' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(mail.body).toContain('/t/' + paid.tickets[0].token);
  });

  it('auditoria: operações sensíveis ficam registadas', async () => {
    const r = await db.query<any>(`SELECT DISTINCT action FROM audit_logs`);
    const actions = r.rows.map((x: any) => x.action);
    for (const a of ['org.create', 'org.status', 'event.create', 'credential.replace', 'credential.block', 'ticket.revoke', 'refund.decide', 'pos.refund', 'cash.close'])
      expect(actions).toContain(a);
  });
});
