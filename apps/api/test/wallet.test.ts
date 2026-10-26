import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WalletService, WalletError } from '../src/wallet';
import { createDb } from '../src/db';
import { migrate } from '../scripts/migrate';

const MT = (n: number) => BigInt(n) * 100n;
const TEST_DB = process.env.PG_TEST_DATABASE ?? 'bilheteplus_test';

let pg: ReturnType<typeof createDb>, schema: string, svc: WalletService, eventId: string, merchantId: string;

beforeEach(async () => {
  schema = 't_' + randomUUID().replace(/-/g, '');
  await migrate(TEST_DB, schema);
  pg = createDb(TEST_DB, schema);
  const org = await pg.query<{ id: string }>(`INSERT INTO organizations(legal_name,trade_name,nuit,status) VALUES('A','A','1','ACTIVE') RETURNING id`);
  const ev = await pg.query<{ id: string }>(`INSERT INTO events(organization_id,name,starts_at,ends_at) VALUES($1,'E',now(),now()+interval '1 day') RETURNING id`, [org.rows[0].id]);
  eventId = ev.rows[0].id;
  merchantId = (await pg.query<{ id: string }>(`INSERT INTO merchants(event_id,name) VALUES($1,'Bar') RETURNING id`, [eventId])).rows[0].id;
  svc = new WalletService(pg);
});

afterEach(async () => {
  await pg.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pg.end();
});

async function funded(amountMt = 1000, kind: 'PHYSICAL_TICKET' | 'NFC' = 'PHYSICAL_TICKET') {
  const walletId = await svc.createWallet(eventId);
  const cred = await svc.issueCredential(walletId, kind);
  await svc.topUp({ walletId, amount: MT(amountMt), operator: 'caixa1', idempotencyKey: 'top-1' });
  return { walletId, ...cred };
}

describe('carteira cashless', () => {
  it('cenários 7-10: carrega 1000 MT e paga 250 MT com bilhete físico → 750 MT', async () => {
    const w = await funded();
    expect(await svc.balanceOf(w.walletId)).toBe(MT(1000));
    const r = await svc.pay({ token: w.token, merchantId, amount: MT(250), operator: 'pos1', idempotencyKey: 'p1' });
    expect(r.balance).toBe(MT(750));
    expect(await svc.balanceByToken(w.token)).toBe(MT(750));
  });

  it('cenários 11-12: pagamento com NFC', async () => {
    const w = await funded(500, 'NFC');
    await svc.pay({ token: w.token, merchantId, amount: MT(120), operator: 'pos2', idempotencyKey: 'n1' });
    expect(await svc.balanceOf(w.walletId)).toBe(MT(380));
  });

  it('cenário 17/20: repetição com a mesma chave não debita duas vezes', async () => {
    const w = await funded();
    const a = await svc.pay({ token: w.token, merchantId, amount: MT(250), operator: 'pos1', idempotencyKey: 'dup' });
    const b = await svc.pay({ token: w.token, merchantId, amount: MT(250), operator: 'pos1', idempotencyKey: 'dup' });
    expect(b.replayed).toBe(true);
    expect(b.entryId).toBe(a.entryId);
    expect(await svc.balanceOf(w.walletId)).toBe(MT(750));
  });

  it('cenário 17: pedidos concorrentes com a mesma chave geram um só débito', async () => {
    const w = await funded();
    await Promise.all([1, 2, 3].map(() => svc.pay({ token: w.token, merchantId, amount: MT(250), operator: 'pos1', idempotencyKey: 'race' })));
    expect(await svc.balanceOf(w.walletId)).toBe(MT(750));
  });

  it('cenário 18: saldo insuficiente recusa e não altera o saldo', async () => {
    const w = await funded(100);
    await expect(svc.pay({ token: w.token, merchantId, amount: MT(101), operator: 'pos1', idempotencyKey: 'x' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await svc.balanceOf(w.walletId)).toBe(MT(100));
  });

  it('pagamentos concorrentes diferentes nunca levam o saldo abaixo de zero', async () => {
    const w = await funded(100);
    const res = await Promise.allSettled([1, 2, 3].map((i) => svc.pay({ token: w.token, merchantId, amount: MT(60), operator: 'p', idempotencyKey: 'k' + i })).flat());
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await svc.balanceOf(w.walletId)).toBe(MT(40));
  });

  it('cenários 14-16: credencial perdida é substituída; antiga rejeitada; histórico e saldo mantidos', async () => {
    const w = await funded();
    await svc.pay({ token: w.token, merchantId, amount: MT(250), operator: 'pos1', idempotencyKey: 'p1' });
    const next = await svc.replaceCredential(w.id, 'NFC');
    await expect(svc.pay({ token: w.token, merchantId, amount: MT(1), operator: 'p', idempotencyKey: 'old' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_INVALID' });
    expect(await svc.balanceByToken(next.token)).toBe(MT(750));
    const n = await pg.query<{ c: number }>('SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id=$1', [w.walletId]);
    expect(n.rows[0].c).toBe(2);
  });

  it('carteira bloqueada recusa pagamentos', async () => {
    const w = await funded();
    await svc.blockWallet(w.walletId);
    await expect(svc.pay({ token: w.token, merchantId, amount: MT(1), operator: 'p', idempotencyKey: 'b' }))
      .rejects.toBeInstanceOf(WalletError);
  });

  it('token desconhecido e valores inválidos são recusados', async () => {
    const w = await funded();
    await expect(svc.pay({ token: 'nope', merchantId, amount: MT(1), operator: 'p', idempotencyKey: 'z' })).rejects.toMatchObject({ code: 'CREDENTIAL_INVALID' });
    await expect(svc.pay({ token: w.token, merchantId, amount: 0n, operator: 'p', idempotencyKey: 'z' })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('o ledger é append-only e os tokens não ficam em claro', async () => {
    const w = await funded();
    await expect(pg.query(`UPDATE wallet_ledger_entries SET amount_minor=1`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`DELETE FROM wallet_ledger_entries`)).rejects.toThrow(/append-only/);
    const c = await pg.query<{ token_hash: string }>('SELECT token_hash FROM wallet_credentials');
    expect(c.rows[0].token_hash).not.toContain(w.token);
  });
});
