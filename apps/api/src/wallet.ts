import { createHash, randomBytes } from 'node:crypto';

export interface Tx {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Tx {
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
}

export type CredentialKind = 'PHYSICAL_TICKET' | 'NFC' | 'APP_QR';

export class WalletError extends Error {
  constructor(public code: 'INSUFFICIENT_FUNDS' | 'CREDENTIAL_INVALID' | 'WALLET_BLOCKED' | 'INVALID_AMOUNT' | 'NOT_FOUND', msg?: string) {
    super(msg ?? code);
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Saldo derivado do ledger, nunca de um campo editável. */
export async function balance(tx: Tx, walletId: string): Promise<bigint> {
  const r = await tx.query<{ b: string }>('SELECT COALESCE(SUM(amount_minor),0)::text AS b FROM wallet_ledger_entries WHERE wallet_id=$1', [walletId]);
  return BigInt(r.rows[0].b);
}

function assertAmount(a: bigint) {
  if (a <= 0n) throw new WalletError('INVALID_AMOUNT');
}

export class WalletService {
  constructor(private db: Db) {}

  /** Usa a transacção do chamador, se existir; senão abre uma. */
  private run<R>(outer: Tx | undefined, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return outer ? fn(outer) : this.db.transaction(fn);
  }

  async createWallet(eventId: string, tx: Tx = this.db): Promise<string> {
    const r = await tx.query<{ id: string }>('INSERT INTO wallets(event_id) VALUES($1) RETURNING id', [eventId]);
    return r.rows[0].id;
  }

  /** Emite credencial; devolve o token em claro uma única vez (para imprimir/codificar). */
  async issueCredential(walletId: string, kind: CredentialKind, tx: Tx = this.db, token = randomBytes(24).toString('base64url')): Promise<{ id: string; token: string }> {
    const r = await tx.query<{ id: string }>(
      'INSERT INTO wallet_credentials(wallet_id,kind,token_hash) VALUES($1,$2,$3) RETURNING id', [walletId, kind, hashToken(token)]);
    return { id: r.rows[0].id, token };
  }

  async balanceOf(walletId: string): Promise<bigint> {
    return balance(this.db, walletId);
  }

  /** Consulta assistida de saldo a partir de uma credencial. */
  async balanceByToken(token: string): Promise<bigint> {
    const c = await this.resolve(this.db, token);
    return balance(this.db, c.wallet_id);
  }

  private async resolve(tx: Tx, token: string, lock = false) {
    const r = await tx.query<{ id: string; wallet_id: string; cstatus: string; wstatus: string }>(
      `SELECT c.id, c.wallet_id, c.status AS cstatus, w.status AS wstatus
         FROM wallet_credentials c JOIN wallets w ON w.id=c.wallet_id
        WHERE c.token_hash=$1 ${lock ? 'FOR UPDATE OF w' : ''}`, [hashToken(token)]);
    const row = r.rows[0];
    if (!row || row.cstatus !== 'ACTIVE') throw new WalletError('CREDENTIAL_INVALID');
    if (row.wstatus !== 'ACTIVE') throw new WalletError('WALLET_BLOCKED');
    return row;
  }

  private async lockWallet(tx: Tx, walletId: string) {
    const r = await tx.query<{ status: string }>('SELECT status FROM wallets WHERE id=$1 FOR UPDATE', [walletId]);
    if (!r.rows[0]) throw new WalletError('NOT_FOUND');
    if (r.rows[0].status !== 'ACTIVE') throw new WalletError('WALLET_BLOCKED');
  }

  /** Credita após confirmação (webhook validado ou caixa). Idempotente. */
  async topUp(p: { walletId: string; amount: bigint; operator: string; idempotencyKey: string; externalRef?: string }, outer?: Tx) {
    assertAmount(p.amount);
    return this.run(outer, async (tx) => {
      await this.lockWallet(tx, p.walletId);
      const dup = await this.existing(tx, p.walletId, p.idempotencyKey);
      if (dup) return dup;
      const r = await tx.query<{ id: string }>(
        `INSERT INTO wallet_ledger_entries(wallet_id,type,amount_minor,operator,idempotency_key,external_ref)
         VALUES($1,'TOPUP',$2,$3,$4,$5) RETURNING id`, [p.walletId, p.amount.toString(), p.operator, p.idempotencyKey, p.externalRef ?? null]);
      return { entryId: r.rows[0].id, balance: await balance(tx, p.walletId), replayed: false };
    });
  }

  /** Débito atómico. O lock na carteira serializa pagamentos concorrentes. */
  async pay(p: { token: string; merchantId: string; amount: bigint; operator: string; idempotencyKey: string }, outer?: Tx) {
    assertAmount(p.amount);
    return this.run(outer, async (tx) => {
      const c = await this.resolve(tx, p.token, true);
      const dup = await this.existing(tx, c.wallet_id, p.idempotencyKey);
      if (dup) return dup;
      const bal = await balance(tx, c.wallet_id);
      if (bal < p.amount) throw new WalletError('INSUFFICIENT_FUNDS');
      const r = await tx.query<{ id: string }>(
        `INSERT INTO wallet_ledger_entries(wallet_id,type,amount_minor,operator,idempotency_key,merchant_id,credential_id)
         VALUES($1,'PAYMENT',$2,$3,$4,$5,$6) RETURNING id`,
        [c.wallet_id, (-p.amount).toString(), p.operator, p.idempotencyKey, p.merchantId, c.id]);
      return { entryId: r.rows[0].id, balance: bal - p.amount, replayed: false };
    });
  }

  /** Devolve um pagamento (crédito ligado ao lançamento original; só uma vez). */
  async refundPayment(p: { entryId: string; operator: string }) {
    return this.db.transaction(async (tx) => {
      const o = await tx.query<{ wallet_id: string; amount_minor: string; merchant_id: string; type: string }>(
        'SELECT wallet_id,amount_minor,merchant_id,type FROM wallet_ledger_entries WHERE id=$1', [p.entryId]);
      const orig = o.rows[0];
      if (!orig || orig.type !== 'PAYMENT') throw new WalletError('NOT_FOUND');
      await tx.query('SELECT 1 FROM wallets WHERE id=$1 FOR UPDATE', [orig.wallet_id]);
      const dup = await this.existing(tx, orig.wallet_id, 'refund:' + p.entryId);
      if (dup) return dup;
      const r = await tx.query<{ id: string }>(
        `INSERT INTO wallet_ledger_entries(wallet_id,type,amount_minor,operator,idempotency_key,merchant_id,original_entry_id)
         VALUES($1,'REFUND',$2,$3,$4,$5,$6) RETURNING id`,
        [orig.wallet_id, (-BigInt(orig.amount_minor)).toString(), p.operator, 'refund:' + p.entryId, orig.merchant_id, p.entryId]);
      return { entryId: r.rows[0].id, balance: await balance(tx, orig.wallet_id), replayed: false };
    });
  }

  /** Levantamento de saldo aprovado (débito). Mantém saldo >= 0. */
  async cashOut(p: { walletId: string; amount: bigint; operator: string; idempotencyKey: string }) {
    assertAmount(p.amount);
    return this.db.transaction(async (tx) => {
      await this.lockWallet(tx, p.walletId);
      const dup = await this.existing(tx, p.walletId, p.idempotencyKey);
      if (dup) return dup;
      const bal = await balance(tx, p.walletId);
      if (bal < p.amount) throw new WalletError('INSUFFICIENT_FUNDS');
      const r = await tx.query<{ id: string }>(
        `INSERT INTO wallet_ledger_entries(wallet_id,type,amount_minor,operator,idempotency_key) VALUES($1,'CASHOUT',$2,$3,$4) RETURNING id`,
        [p.walletId, (-p.amount).toString(), p.operator, p.idempotencyKey]);
      return { entryId: r.rows[0].id, balance: bal - p.amount, replayed: false };
    });
  }

  /** Bloqueia a credencial perdida, emite nova na mesma carteira. Ledger intacto. */
  async replaceCredential(oldCredentialId: string, kind: CredentialKind) {
    return this.db.transaction(async (tx) => {
      const old = await tx.query<{ wallet_id: string }>(
        `UPDATE wallet_credentials SET status='REVOKED' WHERE id=$1 AND status<>'REVOKED' RETURNING wallet_id`, [oldCredentialId]);
      if (!old.rows[0]) throw new WalletError('NOT_FOUND');
      const next = await this.issueCredential(old.rows[0].wallet_id, kind, tx);
      await tx.query('UPDATE wallet_credentials SET replaced_by=$1 WHERE id=$2', [next.id, oldCredentialId]);
      return next;
    });
  }

  async blockWallet(walletId: string) {
    await this.db.query(`UPDATE wallets SET status='BLOCKED' WHERE id=$1`, [walletId]);
  }

  private async existing(tx: Tx, walletId: string, key: string) {
    const r = await tx.query<{ id: string }>('SELECT id FROM wallet_ledger_entries WHERE wallet_id=$1 AND idempotency_key=$2', [walletId, key]);
    return r.rows[0] ? { entryId: r.rows[0].id, balance: await balance(tx, walletId), replayed: true } : null;
  }
}
