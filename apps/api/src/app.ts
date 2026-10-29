import { createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WalletError, WalletService, hashToken, type Db, type Tx } from './wallet';
import { queueMail, type Mailer } from './mailer';
import { normalizeMsisdn, type Mpesa } from './mpesa';
import { authorizeUrl, exchangeCode, type GoogleConfig } from './google';
import { normalizePhone, type Sms } from './sms';
import type { Push } from './push';
import { hashRecovery, newRecoveryCodes, newSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from './totp';

export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
type Role = 'PLATFORM_ADMIN' | 'ORG_ADMIN' | 'CASHIER' | 'MERCHANT_OPERATOR' | 'GATE_OPERATOR';
interface User { orgStatus: string | null; id: string; organization_id: string | null; merchant_id: string | null; role: Role; name: string }
type Req = Request<Record<string, string>> & { user?: User; rawBody?: Buffer };

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'mail', 'ftp', 'static', 'cdn', 'pos', 'staging', 'platform', 'company', 'account', 'events', 'register', 'login', 'staff', 'webhooks', 'public', 'auth', 'smtp', 'imap', 'ns1', 'ns2', 'status', 'help', 'support', 'blog', 'docs', 'dev', 'test', 'demo', 'bilhete', 'bilhetemais']);
const SESSION_HOURS = 12;

export interface AppConfig {
  tokenSecret: string;
  webhookSecret: string;
  baseDomain?: string;
  /** Sandbox: permite confirmar pagamentos sem prestador real. Nunca em produção. */
  simulator?: boolean;
  /** Pasta com o build da interface web (servida pela própria API). */
  webDir?: string;
  /** Pedidos por minuto e IP para login (0/undefined = sem limite, usado nos testes). */
  loginRateLimit?: number;
  /** Registos de empresas por minuto e IP (0/undefined = sem limite). */
  registerRateLimit?: number;
  /** Pedidos POST públicos por minuto e IP (0/undefined = sem limite). */
  publicRateLimit?: number;
  /** Envio de e-mails (opcional; sem ele as mensagens ficam só na fila). */
  mailer?: Mailer | null;
  /** URL público da plataforma, usado nas ligações dos e-mails. */
  publicUrl?: string;
  /** Registo de empresas pelo público (desligado por omissão: as empresas são criadas pela administração em /staff). */
  selfRegistration?: boolean;
  /** Cliente M-Pesa (recargas e pagamento de bilhetes). Sem ele, o M-Pesa fica indisponível. */
  mpesa?: Mpesa | null;
  /** Entrada com Google (opcional). */
  google?: GoogleConfig | null;
  /** Notificações push (opcional; precisa de chaves VAPID). */
  push?: Push | null;
  /** Intervalo (ms) da verificação dos lembretes de eventos. */
  pushReminderMs?: number;
  /** Envio de SMS (códigos de confirmação do telemóvel). Sem ele, a entrada por telemóvel fica indisponível. */
  sms?: Sms | null;
  /** Intervalo (ms) da verificação das cobranças M-Pesa por confirmar. */
  mpesaReconcileMs?: number;
  /** SÓ desenvolvimento: permite mostrar o site numa moldura (teste de larguras de telemóvel). Nunca em produção. */
  devAllowFraming?: boolean;
  /** Pesquisa de moradas (por omissão, OpenStreetMap/Nominatim). Injectável para testes. */
  geocoder?: (q: string) => Promise<{ name: string; lat: number; lng: number; type?: string }[]>;
}

export const hashPassword = (pw: string) => { const salt = randomBytes(16); return salt.toString('hex') + ':' + scryptSync(pw, salt, 32).toString('hex'); };
const checkPassword = (pw: string, stored: string) => {
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false; // conta sem palavra-passe (só Google)
  const want = Buffer.from(h, 'hex'), got = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return want.length === got.length && timingSafeEqual(got, want);
};
const money = (v: unknown, allowZero = false): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, 'valor inválido');
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, 'valor inválido (centavos inteiros)');
  const n = BigInt(v);
  if (!allowZero && n === 0n) throw new HttpError(400, 'valor inválido');
  return n;
};
const str = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name} obrigatório`);
  return v.trim();
};
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
const out = (o: any): any => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

export function createApp(db: Db, cfg: AppConfig) {
  const wallet = new WalletService(db);
  const tokenFor = (id: string) => createHmac('sha256', cfg.tokenSecret).update('ticket:' + id).digest('base64url').slice(0, 22);
  const audit = (tx: Tx, user: User | undefined, action: string, entity?: string, id?: string, detail?: unknown) =>
    tx.query('INSERT INTO audit_logs(user_id,action,entity,entity_id,detail) VALUES($1,$2,$3,$4,$5)',
      [user?.id ?? null, action, entity ?? null, id ?? null, JSON.stringify(out(detail ?? {}))]);

  const app = express();
  app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', ...(cfg.devAllowFraming ? {} : { 'X-Frame-Options': 'DENY' }), 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob: https://tiles.openfreemap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; frame-ancestors ${cfg.devAllowFraming ? "'self'" : "'none'"}`,
    });
    next();
  });
  // as áreas de entrada (plataforma, empresas, contas) não devem aparecer em motores de busca
  app.use((req, res, next) => { if (/^\/(platform|company|account|newsletter)(\/|$)/.test(req.path) || req.hostname.startsWith('platform.')) res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  // manifestos da app instalável da equipa (um por empresa e um da plataforma); um endereço desconhecido recebe o genérico
  const staffManifest = (name: string, start: string, theme = '#0B0820') => ({
    id: start, name, short_name: 'Bilhete+ Equipa', description: 'Balcão, portaria e gestão de eventos.', lang: 'pt-MZ', start_url: start, scope: start, display: 'standalone', orientation: 'portrait',
    background_color: '#0B0820', theme_color: theme,
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  });
  // no subdomínio platform.<domínio> a app abre na raiz; no endereço principal, em /platform/
  app.get('/platform/manifest.webmanifest', (req, res) => { const root = req.hostname.startsWith('platform.') ? '/' : '/platform/'; res.type('application/manifest+json').set('Cache-Control', 'no-cache').json(staffManifest('Bilhete+ Administração', root)); });
  app.get('/company/:slug/manifest.webmanifest', async (req, res, next) => {
    try {
      const o = (await db.query<any>(`SELECT trade_name FROM organizations WHERE slug=$1 AND status<>'DISABLED'`, [req.params.slug])).rows[0];
      const slug = /^[a-z0-9-]{1,60}$/.test(req.params.slug) ? req.params.slug : '';
      res.type('application/manifest+json').set('Cache-Control', 'no-cache').json(o && slug ? staffManifest(`Bilhete+ Equipa — ${o.trade_name}`, `/company/${slug}/`) : staffManifest('Bilhete+ Equipa', '/company/'));
    } catch (e) { next(e); }
  });
  const hits = new Map<string, { n: number; reset: number }>();
  const limit = (max: number | undefined) => (req: Request, _res: Response, next: NextFunction) => {
    if (!max) return next();
    const k = req.ip + req.baseUrl + req.path.split('/').slice(0, 3).join('/'), now = Date.now(), e = hits.get(k);
    if (!e || e.reset < now) hits.set(k, { n: 1, reset: now + 60_000 });
    else if (++e.n > max) return next(new HttpError(429, 'demasiados pedidos, tente mais tarde'));
    if (hits.size > 10_000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    next();
  };

  // /events é, ao mesmo tempo, a lista de eventos da equipa (API, com sessão) e a página pública de descoberta:
  // quem abre o endereço no navegador (Accept: text/html) recebe a página; a aplicação pede o JSON com fetch
  if (cfg.webDir && existsSync(join(cfg.webDir, 'index.html'))) {
    app.get('/events', (req, res, next) => (/text\/html/.test(req.headers.accept ?? '') ? (res.setHeader('Cache-Control', 'no-cache'), res.sendFile(join(cfg.webDir!, 'index.html'))) : next()));
  }
  app.use('/public', (req, res, next) => (req.method === 'POST' ? limit(cfg.publicRateLimit)(req, res, next) : next()));
  const h = (fn: (req: Req, res: Response) => Promise<unknown>) => (req: Request<any>, res: Response, next: NextFunction) =>
    fn(req as Req, res).then((r) => { if (r !== undefined && !res.headersSent) res.json(out(r)); }).catch(next);

  const authenticate = async (req: Req, _res: Response, next: NextFunction) => {
    try {
      const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!t) throw new HttpError(401, 'não autenticado');
      const r = await db.query<User & { org_status: string | null }>(
        `SELECT u.id,u.organization_id,u.merchant_id,u.role,u.name,o.status AS org_status
           FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN organizations o ON o.id=u.organization_id
          WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE'`, [hashToken(t)]);
      const u = r.rows[0];
      if (!u) throw new HttpError(401, 'sessão inválida');
      req.user = { ...u, orgStatus: u.org_status };
      next();
    } catch (e) { next(e); }
  };
  const need = (...roles: Role[]) => (req: Req, _res: Response, next: NextFunction) =>
    roles.includes(req.user!.role) ? next() : next(new HttpError(403, 'sem permissão'));
  /** Empresas só operam depois de aprovadas (a plataforma não tem empresa). */
  const requireActive = (req: Req, _res: Response, next: NextFunction) =>
    req.user!.role === 'PLATFORM_ADMIN' || req.user!.orgStatus === 'ACTIVE' ? next()
      : next(new HttpError(403, req.user!.orgStatus === 'PENDING' ? 'empresa a aguardar aprovação' : 'empresa não activa'));
  /** Para o que uma empresa ainda pendente pode fazer: perfil, documentos e marca. */
  const staffAny = (...roles: Role[]) => [authenticate, need(...roles)] as any[];
  const staff = (...roles: Role[]) => [authenticate, need(...roles), requireActive] as any[];

  /** Carrega o evento garantindo isolamento por empresa. */
  const eventFor = async (user: User, eventId: string, tx: Tx = db) => {
    const r = await tx.query<any>('SELECT * FROM events WHERE id=$1', [eventId]);
    const ev = r.rows[0];
    if (!ev || (user.role !== 'PLATFORM_ADMIN' && ev.organization_id !== user.organization_id)) throw new HttpError(404, 'evento não encontrado');
    return ev;
  };

  // ---------- autenticação ----------
  /** `org` (opcional): área de entrada da empresa. `code`: código TOTP ou de recuperação, se a conta tiver MFA. */
  // tentativas falhadas por e-mail: depois de 8 em 15 minutos, a conta fica em pausa (trava ataques por adivinhação, mesmo vindos de IPs diferentes)
  const failedLogins = new Map<string, { n: number; reset: number }>();
  app.post('/auth/login', limit(cfg.loginRateLimit), h(async (req) => {
    const loginKey = String(req.body?.email ?? '').trim().toLowerCase();
    const fl = failedLogins.get(loginKey);
    if (fl && fl.reset > Date.now() && fl.n >= 8) throw new HttpError(429, 'demasiadas tentativas, tente mais tarde');
    try { return await loginHandler(req); } catch (e) {
      if (e instanceof HttpError && e.status === 401 && e.message !== 'MFA_REQUIRED' && loginKey) { // pedir o código do segundo fator não é uma tentativa falhada
        const cur = failedLogins.get(loginKey);
        failedLogins.set(loginKey, !cur || cur.reset < Date.now() ? { n: 1, reset: Date.now() + 15 * 60_000 } : { n: cur.n + 1, reset: cur.reset });
        if (failedLogins.size > 10_000) for (const [k, v] of failedLogins) if (v.reset < Date.now()) failedLogins.delete(k);
      }
      throw e;
    }
  }));
  const loginHandler = async (req: Req) => {
    const org = typeof req.body.org === 'string' && req.body.org ? req.body.org : null;
    const r = await db.query<any>(`SELECT u.id,u.password_hash,u.role,o.slug,u.mfa_enabled,u.mfa_secret,u.mfa_last_step,u.mfa_recovery FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.email=$1 AND u.status='ACTIVE'`, [str(req.body.email, 'email').toLowerCase()]);
    const u = r.rows[0];
    // área da plataforma (/platform) só para a equipa Bilhete+; área de uma empresa só para essa empresa
    const fromOtherArea = !!u && ((!!org && (u.role === 'PLATFORM_ADMIN' || u.slug !== org)) || (req.body.area === 'platform' && u.role !== 'PLATFORM_ADMIN'));
    if (!u || fromOtherArea || !checkPassword(String(req.body.password ?? ''), u.password_hash)) throw new HttpError(401, 'credenciais inválidas');
    if (u.mfa_enabled) {
      const code = String(req.body.code ?? '').trim();
      if (!code) throw new HttpError(401, 'MFA_REQUIRED');
      const step = verifyTotp(openSecret(u.mfa_secret, cfg.tokenSecret), code, u.mfa_last_step == null ? null : Number(u.mfa_last_step));
      if (step !== null) await db.query('UPDATE users SET mfa_last_step=$2 WHERE id=$1', [u.id, step]);
      else {
        const h = hashRecovery(code);
        const left = (u.mfa_recovery as string[]).filter((x) => x !== h);
        if (left.length === u.mfa_recovery.length) throw new HttpError(401, 'código de verificação inválido');
        await db.query('UPDATE users SET mfa_recovery=$2 WHERE id=$1', [u.id, JSON.stringify(left)]); // cada código de recuperação só vale uma vez
      }
    }
    const token = randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO sessions VALUES($1,$2,now()+($3||' hours')::interval)`, [hashToken(token), u.id, String(SESSION_HOURS)]);
    return { token };
  };

  // ---------- MFA (TOTP) ----------
  app.post('/me/mfa/setup', authenticate, h(async (req) => {
    const cur = await db.query<any>('SELECT mfa_enabled,email FROM users WHERE id=$1', [req.user!.id]);
    if (cur.rows[0].mfa_enabled) throw new HttpError(409, 'a verificação em dois passos já está activa');
    const secret = newSecret();
    await db.query('UPDATE users SET mfa_secret=$2 WHERE id=$1', [req.user!.id, sealSecret(secret, cfg.tokenSecret)]);
    return { secret, otpauthUrl: otpauthUrl(secret, cur.rows[0].email) };
  }));
  app.post('/me/mfa/enable', authenticate, h(async (req) => {
    const r = await db.query<any>('SELECT mfa_secret,mfa_enabled FROM users WHERE id=$1', [req.user!.id]);
    if (!r.rows[0].mfa_secret || r.rows[0].mfa_enabled) throw new HttpError(409, 'inicie a configuração primeiro');
    const step = verifyTotp(openSecret(r.rows[0].mfa_secret, cfg.tokenSecret), String(req.body.code ?? ''));
    if (step === null) throw new HttpError(400, 'código inválido');
    const codes = newRecoveryCodes();
    await db.query('UPDATE users SET mfa_enabled=true,mfa_last_step=$2,mfa_recovery=$3 WHERE id=$1', [req.user!.id, step, JSON.stringify(codes.map(hashRecovery))]);
    await audit(db, req.user, 'mfa.enable', 'user', req.user!.id);
    return { recoveryCodes: codes }; // mostrados uma única vez
  }));
  app.post('/me/mfa/disable', authenticate, h(async (req) => {
    const r = await db.query<any>('SELECT password_hash,mfa_secret,mfa_enabled,mfa_last_step FROM users WHERE id=$1', [req.user!.id]);
    const u = r.rows[0];
    if (!u.mfa_enabled) throw new HttpError(409, 'a verificação em dois passos não está activa');
    if (!checkPassword(String(req.body.password ?? ''), u.password_hash) || verifyTotp(openSecret(u.mfa_secret, cfg.tokenSecret), String(req.body.code ?? ''), u.mfa_last_step == null ? null : Number(u.mfa_last_step)) === null)
      throw new HttpError(401, 'palavra-passe ou código incorrectos');
    await db.query(`UPDATE users SET mfa_enabled=false,mfa_secret=NULL,mfa_recovery='[]' WHERE id=$1`, [req.user!.id]);
    await audit(db, req.user, 'mfa.disable', 'user', req.user!.id);
    return { ok: true };
  }));

  // ---------- empresas ----------
  app.post('/orgs', ...staff('PLATFORM_ADMIN'), h(async (req) => {
    const b = req.body;
    return db.transaction(async (tx) => {
      const o = await tx.query<any>('INSERT INTO organizations(legal_name,trade_name,nuit,slug) VALUES($1,$2,$3,$4) RETURNING id',
        [str(b.legalName, 'legalName'), str(b.tradeName, 'tradeName'), str(b.nuit, 'nuit'), await uniqueOrgSlug(tx, String(b.tradeName ?? ''))]);
      const adminPw = str(b.adminPassword, 'adminPassword');
      if (adminPw.length < 8) throw new HttpError(400, 'a palavra-passe deve ter pelo menos 8 caracteres');
      await tx.query(`INSERT INTO users(organization_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'ORG_ADMIN')`,
        [o.rows[0].id, str(b.adminEmail, 'adminEmail').toLowerCase(), str(b.adminName, 'adminName'), hashPassword(adminPw)]);
      const active = b.activate !== false; // criada pela administração: fica activa, salvo pedido em contrário
      if (active) await tx.query(`UPDATE organizations SET status='ACTIVE',reviewed_by=$2,reviewed_at=now() WHERE id=$1`, [o.rows[0].id, req.user!.id]);
      await audit(tx, req.user, 'org.create', 'organization', o.rows[0].id, { active });
      return { id: o.rows[0].id, status: active ? 'ACTIVE' : 'PENDING' };
    });
  }));
  app.post('/orgs/:id/status', ...staff('PLATFORM_ADMIN'), h(async (req) => {
    const status = str(req.body.status, 'status');
    if (!['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DISABLED'].includes(status)) throw new HttpError(400, 'estado inválido');
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : null;
    if ((status === 'REJECTED' || status === 'SUSPENDED') && !reason) throw new HttpError(400, 'indique o motivo');
    const r = await db.query('UPDATE organizations SET status=$2,status_reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 RETURNING id', [req.params.id, status, reason, req.user!.id]);
    if (!r.rows[0]) throw new HttpError(404, 'empresa não encontrada');
    await audit(db, req.user, 'org.status', 'organization', req.params.id, { status, reason });
    const o = (await db.query<any>(`SELECT o.slug,o.trade_name,COALESCE(o.billing_email,(SELECT email FROM users WHERE organization_id=o.id AND role='ORG_ADMIN' ORDER BY created_at LIMIT 1)) AS to_email FROM organizations o WHERE o.id=$1`, [req.params.id])).rows[0];
    const link = `${cfg.publicUrl ?? ''}/company/${o.slug}`;
    const msg: Record<string, [string, string] | undefined> = {
      ACTIVE: ['A sua empresa foi aprovada — Bilhete+', `Boas notícias: ${o.trade_name} foi aprovada. Já pode criar eventos.\n\nÁrea de entrada da sua equipa: ${link}`],
      REJECTED: ['O registo da sua empresa não foi aprovado — Bilhete+', `O registo de ${o.trade_name} não foi aprovado.\nMotivo: ${reason}\n\nPode corrigir os dados, anexar os documentos em falta e voltar a submeter em ${link}`],
      SUSPENDED: ['A sua empresa foi suspensa — Bilhete+', `${o.trade_name} foi suspensa.\nMotivo: ${reason}\n\nContacte o suporte Bilhete+ para mais informações.`],
    };
    if (o.to_email && msg[status]) await queueMail(db, cfg.mailer ?? null, db, { to: o.to_email, organizationId: req.params.id, subject: msg[status]![0], text: msg[status]![1] });
    return { id: req.params.id, status };
  }));

  app.post('/users', ...staff('ORG_ADMIN'), h(async (req) => {
    const b = req.body;
    const role = str(b.role, 'role') as Role;
    if (!['CASHIER', 'MERCHANT_OPERATOR', 'GATE_OPERATOR', 'ORG_ADMIN'].includes(role)) throw new HttpError(400, 'função inválida');
    let merchantId: string | null = null;
    if (role === 'MERCHANT_OPERATOR') {
      const m = await db.query<any>(`SELECT m.id FROM merchants m JOIN events e ON e.id=m.event_id WHERE m.id=$1 AND e.organization_id=$2`, [b.merchantId, req.user!.organization_id]);
      if (!m.rows[0]) throw new HttpError(404, 'comerciante não encontrado');
      merchantId = m.rows[0].id;
    }
    const r = await db.query<any>(`INSERT INTO users(organization_id,merchant_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user!.organization_id, merchantId, str(b.email, 'email').toLowerCase(), str(b.name, 'name'), hashPassword(str(b.password, 'password')), role]);
    await audit(db, req.user, 'user.create', 'user', r.rows[0].id, { role });
    return { id: r.rows[0].id };
  }));

  // ---------- eventos ----------
  /** Latitude/longitude opcionais (ambas ou nenhuma). */
  const geoPair = (b: any): [number | null, number | null] => {
    const has = (v: unknown) => v !== undefined && v !== null && v !== '';
    if (!has(b?.latitude) && !has(b?.longitude)) return [null, null];
    const lat = Number(b.latitude), lng = Number(b.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'coordenadas inválidas');
    return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
  };
  const eventCategory = (v: unknown) => {
    if (v === undefined || v === null || v === '') return null;
    const c = String(v).toUpperCase();
    if (!['MUSICA', 'FESTIVAL', 'CONFERENCIA', 'FEIRA', 'DESPORTO', 'TEATRO', 'GASTRONOMIA', 'EMPRESARIAL', 'OUTRO'].includes(c)) throw new HttpError(400, 'categoria inválida');
    return c;
  };
  /** Endereço curto do evento (o subdomínio): normaliza, diz se está livre e sugere uma alternativa se não estiver. */
  const subdomainStatus = async (tx: Tx, input: string) => {
    let slug = slugify(input);
    if (slug.length < 3) return { slug, available: false, reason: slug ? 'curto' : 'vazio', suggestion: null as string | null };
    const taken = async (s: string) => RESERVED.has(s) || !!(await tx.query('SELECT 1 FROM event_domains WHERE subdomain=$1', [s])).rows[0];
    if (!(await taken(slug))) return { slug, available: true, reason: null, suggestion: null };
    const reserved = RESERVED.has(slug);
    // sugestão: nome reservado → «nome-evento»; em uso → «nome-2», «nome-3»… (o primeiro que estiver livre)
    const stem = (reserved ? slug + '-evento' : slug).slice(0, 34);
    let suggestion = reserved ? stem : `${stem}-2`;
    for (let i = reserved ? 2 : 3; await taken(suggestion); i++) suggestion = `${stem}-${i}`;
    return { slug, available: false, reason: reserved ? 'reservado' : 'em uso', suggestion };
  };
  app.get('/events/subdomain-check', ...staff('ORG_ADMIN'), h(async (req) => subdomainStatus(db, String(req.query.q ?? '').slice(0, 80))));
  app.post('/events', ...staff('ORG_ADMIN'), h(async (req) => {
    const b = req.body;
    return db.transaction(async (tx) => {
      // um endereço escolhido pela pessoa nunca é alterado em silêncio: se não estiver livre, recusa-se
      if (b.subdomain) {
        const st = await subdomainStatus(tx, String(b.subdomain));
        if (!st.available) throw new HttpError(409, st.reason === 'curto' || st.reason === 'vazio' ? 'o endereço do evento deve ter pelo menos 3 letras ou números' : st.reason === 'reservado' ? 'este endereço é reservado, escolha outro' : 'este endereço já está em uso, escolha outro');
      }
      const e = await tx.query<any>(
        `INSERT INTO events(organization_id,name,description,starts_at,ends_at,capacity,balance_refund_allowed,location,settings,category,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [req.user!.organization_id, str(b.name, 'name'), b.description ?? null, b.startsAt, b.endsAt, b.capacity ?? null, !!b.balanceRefundAllowed, opt(b.location, 200), JSON.stringify(cleanSettings(b.settings)), eventCategory(b.category), ...geoPair(b)]);
      if (b.inheritFrom) {
        await eventFor(req.user!, b.inheritFrom, tx); // tem de ser da mesma empresa
        if (b.inherit !== false) await tx.query('UPDATE events SET parent_event_id=$2 WHERE id=$1', [e.rows[0].id, b.inheritFrom]);
        await copyStructure(tx, b.inheritFrom, e.rows[0].id, Array.isArray(b.copy) ? b.copy : []);
      }
      let base = slugify(b.subdomain ? String(b.subdomain) : b.name);
      if (base.length < 3) base = ('ev-' + base).replace(/-+$/, '').padEnd(3, 'x');
      if (RESERVED.has(base)) base += '-evento';
      let sub = base;
      for (let i = 2; ; i++) {
        const ins = await tx.query('INSERT INTO event_domains(subdomain,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING subdomain', [sub, e.rows[0].id]);
        if (ins.rows.length) break;
        sub = `${base.slice(0, 36)}-${i}`;
      }
      await audit(tx, req.user, 'event.create', 'event', e.rows[0].id, { subdomain: sub });
      return { id: e.rows[0].id, subdomain: sub };
    });
  }));
  // ---------- notificações push ----------
  const pushUrl = (path: string) => `${(cfg.publicUrl ?? 'https://bilhetemais.live').replace(/\/$/, '')}${path}`;
  const eventAddress = (sub: string | null | undefined) => (sub ? (cfg.baseDomain ? `https://${sub}.${cfg.baseDomain}` : pushUrl('/e/' + sub)) : pushUrl('/events'));
  /** Envia a todas as subscrições dadas; as que já não existem (404/410) são apagadas. Nunca rebenta o pedido que a originou. */
  const sendPush = async (subs: { endpoint: string; p256dh: string; auth: string }[], msg: { title: string; body: string; url: string; tag?: string }) => {
    if (!cfg.push) return 0;
    let ok = 0;
    for (const s of subs) {
      try { await cfg.push.send(s, msg); ok++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [s.endpoint]).catch(() => {}); else console.error('push', e?.statusCode ?? e?.message); }
    }
    return ok;
  };
  const pushAsync = (fn: () => Promise<unknown>) => { if (!cfg.push) return; const p = fn().catch((e) => console.error('push', e)).finally(() => inflight.delete(p)); inflight.add(p); };
  app.get('/public/push/config', h(async () => ({ publicKey: cfg.push?.publicKey ?? null })));
  /** Regista (ou actualiza) a subscrição deste aparelho; se houver sessão de conta, fica ligada a ela. */
  app.post('/public/push/subscribe', h(async (req) => {
    if (!cfg.push) throw new HttpError(409, 'as notificações não estão disponíveis');
    const sub = req.body?.subscription, k = sub?.keys;
    if (typeof sub?.endpoint !== 'string' || !/^https:\/\/.{10,900}$/.test(sub.endpoint) || typeof k?.p256dh !== 'string' || typeof k?.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) throw new HttpError(400, 'subscrição inválida');
    const topics = (Array.isArray(req.body?.topics) ? req.body.topics : ['events', 'tickets']).filter((t: unknown) => t === 'events' || t === 'tickets');
    let accountId: string | null = null;
    const bearerTok = bearer(req as Request);
    if (bearerTok) { try { accountId = (await needAccount(req as Request)).id; } catch { /* sem sessão: fica anónima */ } }
    await db.query(`INSERT INTO push_subscriptions(account_id,endpoint,p256dh,auth,topics) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (endpoint) DO UPDATE SET account_id=COALESCE(EXCLUDED.account_id, push_subscriptions.account_id), p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, topics=EXCLUDED.topics`, [accountId, sub.endpoint, k.p256dh, k.auth, topics]);
    return { ok: true, topics };
  }));
  app.post('/public/push/unsubscribe', h(async (req) => {
    const endpoint = String(req.body?.endpoint ?? '');
    if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
    return { ok: true };
  }));
  /** Lembrete 24 h antes: quem tem bilhete para um evento que começa dentro de ~24 h recebe um aviso (uma só vez). */
  const runPushReminders = async () => {
    if (!cfg.push) return 0;
    const rows = (await db.query<any>(`SELECT DISTINCT o.account_id, e.id AS event_id, e.name, e.starts_at, e.location, d.subdomain
        FROM ticket_orders o JOIN tickets t ON t.order_id=o.id AND t.status IN ('ISSUED','USED') JOIN events e ON e.id=o.event_id LEFT JOIN event_domains d ON d.event_id=e.id
       WHERE o.account_id IS NOT NULL AND e.status='PUBLISHED' AND e.starts_at > now() AND e.starts_at <= now() + interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM push_sent s WHERE s.account_id=o.account_id AND s.event_id=e.id AND s.kind='reminder24h')`)).rows;
    let n = 0;
    for (const r of rows) {
      await db.query(`INSERT INTO push_sent(account_id,event_id,kind) VALUES($1,$2,'reminder24h') ON CONFLICT DO NOTHING`, [r.account_id, r.event_id]);
      const subs = (await db.query<any>(`SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE account_id=$1 AND 'tickets' = ANY(topics)`, [r.account_id])).rows;
      n += await sendPush(subs, { title: 'O seu evento é amanhã', body: `${r.name}${r.location ? ' · ' + r.location : ''}. Tenha o bilhete à mão.`, url: pushUrl('/account'), tag: 'reminder-' + r.event_id });
    }
    return n;
  };
  (app as any).runPushReminders = runPushReminders;
  if (cfg.push && cfg.pushReminderMs) setInterval(() => runPushReminders().catch((e) => console.error('lembretes', e)), cfg.pushReminderMs).unref();

  app.post('/events/:id/publish', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const was = (await db.query<any>('SELECT status FROM events WHERE id=$1', [req.params.id])).rows[0]?.status;
    await db.query(`UPDATE events SET status='PUBLISHED' WHERE id=$1`, [req.params.id]);
    // só na primeira publicação: «há um novo evento» para quem activou as notificações
    if (was !== 'PUBLISHED') pushAsync(async () => {
      const ev = (await db.query<any>(`SELECT e.name,e.starts_at,e.location,d.subdomain FROM events e LEFT JOIN event_domains d ON d.event_id=e.id WHERE e.id=$1`, [req.params.id])).rows[0];
      const subs = (await db.query<any>(`SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE 'events' = ANY(topics)`)).rows;
      await sendPush(subs, { title: 'Novo evento no Bilhete+', body: `${ev.name}${ev.location ? ' · ' + ev.location : ''} · ${new Date(ev.starts_at).toLocaleDateString('pt-MZ', { day: 'numeric', month: 'long' })}`, url: eventAddress(ev.subdomain), tag: 'event-' + req.params.id });
    });
    return { status: 'PUBLISHED' };
  }));
  app.post('/events/:id/ticket-types', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const b = req.body;
    const r = await db.query<any>('INSERT INTO ticket_types(event_id,name,kind,price_minor,quantity) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [req.params.id, str(b.name, 'name'), b.kind ?? 'GENERAL', money(b.priceMinor, true).toString(), Number(b.quantity)]);
    return { id: r.rows[0].id };
  }));
  app.post('/events/:id/gates', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const r = await db.query<any>('INSERT INTO access_gates(event_id,name) VALUES($1,$2) RETURNING id', [req.params.id, str(req.body.name, 'name')]);
    return { id: r.rows[0].id };
  }));
  app.post('/events/:id/merchants', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const r = await db.query<any>('INSERT INTO merchants(event_id,name) VALUES($1,$2) RETURNING id', [req.params.id, str(req.body.name, 'name')]);
    return { id: r.rows[0].id };
  }));
  app.post('/merchants/:id/products', ...staff('ORG_ADMIN'), h(async (req) => {
    const m = await db.query<any>('SELECT m.id,m.event_id FROM merchants m WHERE m.id=$1', [req.params.id]);
    if (!m.rows[0]) throw new HttpError(404, 'comerciante não encontrado');
    await eventFor(req.user!, m.rows[0].event_id);
    const r = await db.query<any>('INSERT INTO products(merchant_id,name,price_minor) VALUES($1,$2,$3) RETURNING id', [req.params.id, str(req.body.name, 'name'), money(req.body.priceMinor).toString()]);
    return { id: r.rows[0].id };
  }));

  // ---------- bilhética (núcleo partilhado) ----------
  /** Reserva stock e cria bilhetes PENDING; emite logo se a encomenda estiver paga. */
  const createOrder = async (tx: Tx, ev: any, channel: 'ONLINE' | 'COUNTER', b: any, format: 'DIGITAL' | 'PHYSICAL') => {
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw new HttpError(400, 'sem itens');
    if (new Date(ev.ends_at) < new Date()) throw new HttpError(409, 'o evento já terminou: já não é possível comprar bilhetes');
    const st = (await settingsOf(tx, ev)).effective;
    if (channel === 'ONLINE' && !st.onlineSalesEnabled) throw new HttpError(409, 'a venda online está desactivada neste evento');
    if (channel === 'COUNTER' && !st.counterSalesEnabled) throw new HttpError(409, 'a venda no balcão está desactivada neste evento');
    if (items.reduce((n: number, it: any) => n + Number(it.qty || 0), 0) > st.maxTicketsPerOrder) throw new HttpError(400, `máximo de ${st.maxTicketsPerOrder} bilhetes por encomenda`);
    let total = 0n;
    const lines: { typeId: string; qty: number }[] = [];
    for (const it of items) {
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, 'quantidade inválida');
      const t = await tx.query<any>('SELECT id,price_minor,quantity FROM ticket_types WHERE id=$1 AND event_id=$2 FOR UPDATE', [it.ticketTypeId, ev.id]);
      if (!t.rows[0]) throw new HttpError(404, 'tipo de bilhete não encontrado');
      const sold = await tx.query<any>(`SELECT count(*)::int AS c FROM tickets WHERE ticket_type_id=$1 AND status<>'REVOKED'`, [t.rows[0].id]);
      if (sold.rows[0].c + qty > t.rows[0].quantity) throw new HttpError(409, 'bilhetes esgotados');
      total += BigInt(t.rows[0].price_minor) * BigInt(qty);
      lines.push({ typeId: t.rows[0].id, qty });
    }
    const status = channel === 'COUNTER' || total === 0n ? 'PAID' : 'PENDING_PAYMENT';
    const o = await tx.query<any>('INSERT INTO ticket_orders(event_id,channel,buyer_name,buyer_contact,total_minor,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [ev.id, channel, str(b.buyerName, 'buyerName'), b.buyerContact ?? null, total.toString(), status]);
    for (const l of lines) for (let i = 0; i < l.qty; i++) {
      const id = randomUUID();
      await tx.query(`INSERT INTO tickets(id,event_id,order_id,ticket_type_id,token_hash,format,status,short_code) VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7)`,
        [id, ev.id, o.rows[0].id, l.typeId, hashToken(tokenFor(id)), format, await freshShortCode(tx, ev.id)]);
    }
    if (status === 'PAID') await issueOrder(tx, o.rows[0].id);
    return { orderId: o.rows[0].id as string, total, status };
  };
  /** Emite bilhetes de uma encomenda paga: cria carteira e credencial por bilhete. */
  const issueOrder = async (tx: Tx, orderId: string) => {
    const ts = await tx.query<any>(`SELECT id,event_id,format FROM tickets WHERE order_id=$1 AND status='PENDING'`, [orderId]);
    for (const t of ts.rows) {
      const w = await wallet.createWallet(t.event_id, tx);
      await wallet.issueCredential(w, t.format === 'PHYSICAL' ? 'PHYSICAL_TICKET' : 'APP_QR', tx, tokenFor(t.id));
      await tx.query(`UPDATE tickets SET status='ISSUED', wallet_id=$2 WHERE id=$1`, [t.id, w]);
    }
    // e-mail automático com os bilhetes (para compras com conta; compras de balcão têm telefone, não e-mail)
    const o = (await tx.query<any>('SELECT o.buyer_name,o.buyer_contact,o.channel,o.account_id,e.name AS event FROM ticket_orders o JOIN events e ON e.id=o.event_id WHERE o.id=$1', [orderId])).rows[0];
    if (ts.rows.length && o?.account_id) pushAsync(async () => { await new Promise((r) => setTimeout(r, 300)); const subs = (await db.query<any>(`SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE account_id=$1 AND 'tickets' = ANY(topics)`, [o.account_id])).rows; await sendPush(subs, { title: 'Bilhetes confirmados', body: `${o.event}: os seus bilhetes já estão na app.`, url: pushUrl('/account'), tag: 'order-' + orderId }); });
    if (ts.rows.length && o?.channel === 'ONLINE' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.buyer_contact ?? '')) {
      const base = cfg.publicUrl ?? 'https://bilhetemais.live';
      const text = [`Olá ${o.buyer_name},`, '', `Os seus bilhetes para ${o.event} estão prontos.`, '', 'Abra o link à entrada (serve também de carteira):', '',
        ...ts.rows.map((t: any, i: number) => `Bilhete ${i + 1}: ${base}/t/${tokenFor(t.id)}`), '', `Também os encontra em ${base}/account, em «Os meus bilhetes».`, 'Guarde este e-mail: quem tiver o link tem acesso ao bilhete e ao saldo.'].join('\n');
      await queueMail(db, cfg.mailer ?? null, tx, { to: o.buyer_contact.toLowerCase(), subject: `Os seus bilhetes — ${o.event}`, text });
    }
  };
  /** Código curto único por evento (sem I, L, O, 0, 1 para não se confundirem ao ler e digitar). */
  const SHORT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const freshShortCode = async (tx: Tx, eventId: string) => {
    for (;;) {
      const code = Array.from(randomBytes(8), (b) => SHORT_ALPHABET[b % SHORT_ALPHABET.length]).join('');
      if (!(await tx.query('SELECT 1 FROM tickets WHERE event_id=$1 AND short_code=$2', [eventId, code])).rows[0]) return code;
    }
  };
  /** Aceita o código curto («ABCD-EFGH», com ou sem espaços) ou o código completo do bilhete. */
  const shortCodeOf = (input: string) => { const c = input.toUpperCase().replace(/[\s-]/g, ''); return /^[A-Z2-9]{8}$/.test(c) ? c : null; };
  const findTicket = async (tx: Tx, eventId: string, input: string) => {
    const sc = shortCodeOf(input);
    const r = sc
      ? await tx.query<any>('SELECT id,status FROM tickets WHERE event_id=$1 AND short_code=$2', [eventId, sc])
      : await tx.query<any>('SELECT id,status FROM tickets WHERE token_hash=$1 AND event_id=$2', [hashToken(input), eventId]);
    return r.rows[0] as { id: string; status: string } | undefined;
  };
  const orderTickets = async (tx: Tx, orderId: string) => {
    const r = await tx.query<any>(`SELECT id,format,status,ticket_type_id,short_code AS "shortCode" FROM tickets WHERE order_id=$1 ORDER BY created_at,id`, [orderId]);
    return r.rows.map((t: any) => ({ ...t, token: t.status === 'PENDING' ? null : tokenFor(t.id), shortCode: t.status === 'PENDING' ? null : t.shortCode }));
  };

  // ---------- público (participante) ----------
  const publicEvent = async (sub: string) => {
    const r = await db.query<any>(`SELECT e.* FROM event_domains d JOIN events e ON e.id=d.event_id WHERE d.subdomain=$1 AND e.status='PUBLISHED'`, [sub]);
    if (!r.rows[0]) throw new HttpError(404, 'evento não encontrado');
    return r.rows[0];
  };
  app.get('/public/events/:sub', h(async (req) => {
    const ev = await publicEvent(req.params.sub);
    const types = await db.query<any>(
      `SELECT t.id,t.name,t.kind,t.price_minor,t.quantity-(SELECT count(*) FROM tickets k WHERE k.ticket_type_id=t.id AND k.status<>'REVOKED')::int AS available
         FROM ticket_types t WHERE t.event_id=$1`, [ev.id]);
    return { name: ev.name, description: ev.description, startsAt: ev.starts_at, endsAt: ev.ends_at, ticketTypes: types.rows, location: ev.location, mapUrl: ev.map_url, lat: ev.latitude === null ? null : Number(ev.latitude), lng: ev.longitude === null ? null : Number(ev.longitude), ...(await eventBrand(ev)), settings: publicSettings((await settingsOf(db, ev)).effective),
      gallery: (await db.query<any>('SELECT id,caption FROM event_images WHERE event_id=$1 ORDER BY position,created_at', [ev.id])).rows,
      programme: (await db.query<any>('SELECT id,title,starts_at,ends_at,stage,description FROM event_sessions WHERE event_id=$1 ORDER BY starts_at', [ev.id])).rows };
  }));
  // ---------- contas de participantes ----------
  const ACCOUNT_DAYS = 30;
  const accountSession = async (accountId: string) => {
    const token = randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO account_sessions VALUES($1,$2,now()+($3||' days')::interval)`, [hashToken(token), accountId, String(ACCOUNT_DAYS)]);
    return token;
  };
  const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
  const needAccount = async (req: Request) => {
    const t = bearer(req);
    const r = t ? await db.query<any>(`SELECT a.id,a.name,a.email,COALESCE(a.phone_e164,a.phone) AS phone,a.newsletter,(a.password_hash<>'-') AS "hasPassword" FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.status='ACTIVE'`, [hashToken(t)]) : null;
    if (!r?.rows[0]) throw new HttpError(401, 'LOGIN_REQUIRED');
    return r.rows[0] as { id: string; name: string; email: string | null; phone: string | null; hasPassword: boolean; newsletter: boolean };
  };
  const validEmail = (v: unknown) => {
    const e = String(v ?? '').trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) || e.length > 254) throw new HttpError(400, 'e-mail inválido');
    return e;
  };
  const goodPassword = (v: unknown) => {
    const p = String(v ?? '');
    if (p.length < 8 || p.length > 200) throw new HttpError(400, 'a palavra-passe deve ter pelo menos 8 caracteres');
    return p;
  };
  // ---------- entrada com Google ----------
  const googleRedirect = () => `${(cfg.publicUrl ?? '').replace(/\/$/, '')}/account/google/callback`;
  const safeNext = (v: unknown) => {
    if (typeof v !== 'string' || v.length > 300) return '/account';
    if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(v)) return v;
    // endereço completo só se for do nosso domínio base (um evento): nunca para sítios de terceiros
    if (cfg.baseDomain) {
      try {
        const u = new URL(v);
        if (u.protocol === 'https:' && (u.hostname === cfg.baseDomain || u.hostname.endsWith('.' + cfg.baseDomain)) && !u.username && !u.password) return u.origin + u.pathname + u.search;
      } catch { /* endereço inválido */ }
    }
    return '/account';
  };
  const cookieOf = (req: Request, name: string) => new RegExp(`(?:^|; )${name}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1] ?? null;
  const secureCookie = (cfg.publicUrl ?? '').startsWith('https://');
  app.get('/account/google/start', limit(cfg.loginRateLimit), h(async (req, res) => {
    if (!cfg.google) throw new HttpError(409, 'a entrada com Google não está disponível');
    const state = randomBytes(24).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // «rid»: segredo da app instalada, que fica à espera (poll) enquanto o Google abre noutro contexto; só se guarda o hash
    const rid = typeof req.query.rid === 'string' && /^[\w-]{32,64}$/.test(req.query.rid) ? hashToken(req.query.rid) : null;
    await db.query(`INSERT INTO oauth_states(state_hash,verifier,next,expires_at,handoff_hash) VALUES($1,$2,$3,now()+interval '10 minutes',$4)`, [hashToken(state), verifier, safeNext(req.query.next), rid]);
    await db.query(`DELETE FROM oauth_states WHERE expires_at<now()`);
    // o cookie liga o pedido a este navegador: impede que alguém envie a outra pessoa o seu próprio retorno do Google
    res.setHeader('Set-Cookie', `bp_oauth=${state}; Path=/account/google; HttpOnly; SameSite=Lax; Max-Age=600${secureCookie ? '; Secure' : ''}`);
    res.redirect(302, authorizeUrl(cfg.google, { redirectUri: googleRedirect(), state, challenge }));
    return undefined;
  }));
  /** A app instalada pergunta se a entrada com Google já terminou (uso único: a sessão é entregue uma só vez). */
  app.get('/account/google/poll', limit(cfg.loginRateLimit ? cfg.loginRateLimit * 12 : undefined), h(async (req) => {
    const rid = typeof req.query.rid === 'string' && /^[\w-]{32,64}$/.test(req.query.rid) ? req.query.rid : '';
    if (!rid) throw new HttpError(400, 'pedido inválido');
    const r = (await db.query<any>(`DELETE FROM login_handoffs WHERE rid_hash=$1 AND expires_at>now() RETURNING sealed`, [hashToken(rid)])).rows[0];
    await db.query(`DELETE FROM login_handoffs WHERE expires_at<now()`);
    return r ? { done: true, token: openSecret(r.sealed, cfg.tokenSecret) } : { done: false };
  }));
  app.get('/account/google/callback', limit(cfg.loginRateLimit), h(async (req, res) => {
    const fail = (why: string) => { res.redirect(302, '/account?error=' + encodeURIComponent(why)); return undefined; };
    if (!cfg.google) return fail('google_off');
    const state = String(req.query.state ?? ''), code = String(req.query.code ?? '');
    if (req.query.error || !state || !code) return fail('google_cancelled');
    if (cookieOf(req as Request, 'bp_oauth') !== state) return fail('google_state');
    const st = (await db.query<any>(`DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,next,handoff_hash`, [hashToken(state)])).rows[0]; // uso único
    if (!st) return fail('google_state');
    let p;
    try { p = await exchangeCode(cfg.google, code, st.verifier, googleRedirect()); } catch { return fail('google_failed'); }
    if (!p.emailVerified) return fail('google_unverified');
    p = { ...p, email: p.email.trim().toLowerCase() };
    const accountId = await db.transaction(async (tx) => {
      const ident = (await tx.query<any>(`SELECT i.account_id FROM account_identities i JOIN accounts a ON a.id=i.account_id WHERE i.provider='google' AND i.subject=$1 AND a.status='ACTIVE'`, [p.sub])).rows[0];
      if (ident) return ident.account_id as string;
      const ex = (await tx.query<any>(`SELECT id,email_verified FROM accounts WHERE lower(email)=$1 AND status='ACTIVE' FOR UPDATE`, [p.email])).rows[0];
      let id: string;
      if (ex) {
        id = ex.id;
        if (!ex.email_verified) {
          // a conta foi criada com palavra-passe sem confirmar o e-mail: quem a criou pode não ser o dono. Anula-se a palavra-passe e as sessões.
          await tx.query(`UPDATE accounts SET password_hash='-' WHERE id=$1`, [id]);
          await tx.query('DELETE FROM account_sessions WHERE account_id=$1', [id]);
        }
        await tx.query('UPDATE accounts SET email_verified=true WHERE id=$1', [id]);
      } else {
        id = (await tx.query<any>(`INSERT INTO accounts(email,name,password_hash,email_verified) VALUES($1,$2,'-',true) RETURNING id`, [p.email, p.name.slice(0, 120)])).rows[0].id;
      }
      await tx.query(`INSERT INTO account_identities(provider,subject,account_id) VALUES('google',$1,$2)`, [p.sub, id]);
      return id;
    });
    const token = await accountSession(accountId);
    res.setHeader('Set-Cookie', 'bp_oauth=; Path=/account/google; Max-Age=0');
    if (st.handoff_hash) {
      // entrada iniciada na app instalada: a sessão fica guardada (cifrada) à espera de a app a ir buscar; aqui só se mostra «feito»
      await db.query(`INSERT INTO login_handoffs(rid_hash,sealed,expires_at) VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT (rid_hash) DO UPDATE SET sealed=EXCLUDED.sealed, expires_at=EXCLUDED.expires_at`, [st.handoff_hash, sealSecret(token, cfg.tokenSecret)]);
      res.redirect(302, '/account/done');
      return undefined;
    }
    // o token vai no fragmento (#): não chega a servidores nem a registos
    // a sessão volta ao endereço de onde a pessoa veio (o de um evento, com o seu subdomínio, ou o principal)
    if (/^https:\/\//.test(st.next)) { const u = new URL(st.next); res.redirect(302, `${u.origin}/account#t=${token}&next=${encodeURIComponent(u.pathname + u.search)}`); }
    else res.redirect(302, `/account#t=${token}&next=${encodeURIComponent(st.next)}`);
    return undefined;
  }));

  // ---------- newsletter (contas de participantes) ----------
  const unsubToken = (accountId: string) => createHmac('sha256', cfg.tokenSecret).update('unsub:' + accountId).digest('base64url').slice(0, 22);
  const unsubLink = (accountId: string) => `${cfg.publicUrl ?? 'https://bilhetemais.live'}/newsletter/unsubscribe?a=${accountId}&t=${unsubToken(accountId)}`;
  /** Sair da newsletter com o link do e-mail (não exige sessão). */
  app.post('/public/newsletter/unsubscribe', h(async (req) => {
    const a = String(req.body?.a ?? ''), t = String(req.body?.t ?? '');
    if (!/^[0-9a-f-]{36}$/.test(a) || t.length !== 22 || !timingSafeEqual(Buffer.from(unsubToken(a)), Buffer.from(t))) throw new HttpError(400, 'ligação inválida');
    await db.query('UPDATE accounts SET newsletter=false WHERE id=$1', [a]);
    return { ok: true };
  }));
  app.get('/platform/newsletter', ...staff('PLATFORM_ADMIN'), h(async () => ({
    subscribers: (await db.query<any>(`SELECT count(*)::int AS c FROM accounts WHERE status='ACTIVE' AND newsletter AND email IS NOT NULL`)).rows[0].c,
    campaigns: (await db.query(`SELECT id,subject,recipients,created_at FROM newsletter_campaigns ORDER BY created_at DESC LIMIT 20`)).rows,
  })));
  /** Envia uma newsletter a todas as contas subscritas (ou só um teste para um e-mail). Cada mensagem leva a ligação para sair. */
  app.post('/platform/newsletter', ...staff('PLATFORM_ADMIN'), h(async (req) => {
    const subject = str(req.body?.subject, 'subject').trim().slice(0, 150);
    const body = str(req.body?.body, 'body').trim().slice(0, 5000);
    if (subject.length < 3 || body.length < 10) throw new HttpError(400, 'escreva o assunto e a mensagem');
    const footer = (id: string) => `\n\n—\nRecebe este e-mail porque tem conta no Bilhete+.\nPara deixar de receber novidades: ${unsubLink(id)}`;
    if (req.body?.testTo) {
      const to = validEmail(req.body.testTo);
      await queueMail(db, cfg.mailer ?? null, db, { to, subject: '[TESTE] ' + subject, text: body + footer('00000000-0000-0000-0000-000000000000') });
      return { test: true, recipients: 1 };
    }
    const subs = (await db.query<any>(`SELECT id,email FROM accounts WHERE status='ACTIVE' AND newsletter AND email IS NOT NULL ORDER BY created_at LIMIT 5000`)).rows;
    await db.transaction(async (tx) => {
      for (const s of subs) await queueMail(db, cfg.mailer ?? null, tx, { to: s.email, subject, text: body + footer(s.id) });
      await tx.query('INSERT INTO newsletter_campaigns(subject,body,sent_by,recipients) VALUES($1,$2,$3,$4)', [subject, body, req.user!.id, subs.length]);
      await audit(tx, req.user, 'newsletter.send', 'newsletter', undefined, { subject, recipients: subs.length });
    });
    return { test: false, recipients: subs.length };
  }));

  // ---------- entrada por telemóvel (código por SMS) ----------
  const codeHash = (phone: string, code: string) => createHmac('sha256', cfg.tokenSecret).update(`phone:${phone}:${code}`).digest('hex');
  /** Pede o código. A resposta é sempre a mesma (não revela se o número já tem conta). */
  app.post('/account/phone/start', limit(cfg.loginRateLimit), h(async (req) => {
    if (!cfg.sms) throw new HttpError(409, 'a entrada por telemóvel não está disponível');
    const phone = normalizePhone(String(req.body?.phone ?? ''));
    if (!phone) throw new HttpError(400, 'número de telemóvel inválido (por exemplo 84 123 4567)');
    // no máximo 3 códigos por número em 15 minutos (evita gastar SMS e incomodar quem não os pediu)
    const recent = (await db.query<any>(`SELECT count(*)::int AS c FROM phone_codes WHERE phone=$1 AND created_at > now() - interval '15 minutes'`, [phone])).rows[0].c;
    if (recent >= 3) throw new HttpError(429, 'já enviámos vários códigos para este número, aguarde alguns minutos');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.query(`INSERT INTO phone_codes(phone,code_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes')`, [phone, codeHash(phone, code)]);
    await db.query(`DELETE FROM phone_codes WHERE created_at < now() - interval '1 day'`);
    try { await cfg.sms.send(phone, `Bilhete+: o seu código é ${code}. Vale 10 minutos. Não o partilhe com ninguém.`); }
    catch (e) { console.error('sms', e); throw new HttpError(502, 'não foi possível enviar o SMS agora, tente novamente'); }
    return { sent: true };
  }));
  /** Confirma o código: entra na conta do número ou cria uma (o nome é pedido só na primeira vez). */
  app.post('/account/phone/verify', limit(cfg.loginRateLimit), h(async (req) => {
    if (!cfg.sms) throw new HttpError(409, 'a entrada por telemóvel não está disponível');
    const phone = normalizePhone(String(req.body?.phone ?? ''));
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    if (!phone || code.length !== 6) throw new HttpError(400, 'código inválido');
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    // cada tentativa conta (certa ou errada) e fica registada mesmo que o pedido falhe: no máximo 5 por código
    const pc = (await db.query<any>(`UPDATE phone_codes SET attempts=attempts+1 WHERE id=(SELECT id FROM phone_codes WHERE phone=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 1) RETURNING id,code_hash,attempts`, [phone])).rows[0];
    if (!pc || pc.attempts > 5) throw new HttpError(401, 'código inválido ou expirado');
    const want = codeHash(phone, code);
    if (pc.code_hash.length !== want.length || !timingSafeEqual(Buffer.from(pc.code_hash), Buffer.from(want))) throw new HttpError(401, 'código inválido ou expirado');
    const accountId = await db.transaction(async (tx) => {
      const ex = (await tx.query<any>(`SELECT id FROM accounts WHERE phone_e164=$1 AND status='ACTIVE'`, [phone])).rows[0];
      if (ex) { await tx.query('DELETE FROM phone_codes WHERE phone=$1', [phone]); return ex.id as string; }
      if (name.length < 2) throw new HttpError(400, 'indique o seu nome'); // o código continua válido para a nova tentativa
      const id = (await tx.query<any>(`INSERT INTO accounts(email,name,phone,phone_e164,password_hash,email_verified,newsletter) VALUES(NULL,$1,$2,$2,'-',false,false) RETURNING id`, [name, phone])).rows[0].id as string;
      await tx.query('DELETE FROM phone_codes WHERE phone=$1', [phone]);
      return id;
    });
    const a = (await db.query<any>('SELECT name,phone_e164 AS phone FROM accounts WHERE id=$1', [accountId])).rows[0];
    return { token: await accountSession(accountId), account: { name: a.name, email: null, phone: a.phone } };
  }));

  app.post('/account/register', limit(cfg.loginRateLimit), h(async (req) => {
    const email = validEmail(req.body?.email);
    const name = str(req.body?.name, 'name').trim().slice(0, 120);
    const password = goodPassword(req.body?.password);
    const phone = req.body?.phone ? String(req.body.phone).trim().slice(0, 30) : null;
    try {
      const r = await db.query<any>('INSERT INTO accounts(email,name,phone,password_hash,newsletter) VALUES($1,$2,$3,$4,$5) RETURNING id', [email, name, phone, hashPassword(password), req.body?.newsletter !== false]);
      return { token: await accountSession(r.rows[0].id), account: { name, email, phone } };
    } catch (e: any) {
      if (e?.code === '23505') throw new HttpError(409, 'já existe uma conta com este e-mail');
      throw e;
    }
  }));
  app.post('/account/login', limit(cfg.loginRateLimit), h(async (req) => {
    const r = await db.query<any>(`SELECT id,name,email,phone,password_hash FROM accounts WHERE lower(email)=$1 AND status='ACTIVE'`, [String(req.body?.email ?? '').trim().toLowerCase()]);
    const a = r.rows[0];
    if (!a || !checkPassword(String(req.body?.password ?? ''), a.password_hash)) throw new HttpError(401, 'credenciais inválidas');
    return { token: await accountSession(a.id), account: { name: a.name, email: a.email, phone: a.phone } };
  }));
  app.post('/account/logout', h(async (req) => {
    const t = bearer(req as Request);
    if (t) await db.query('DELETE FROM account_sessions WHERE token_hash=$1', [hashToken(t)]);
    return { ok: true };
  }));
  app.get('/account/me', h(async (req) => ({ account: await needAccount(req as Request) })));
  app.patch('/account/me', h(async (req) => {
    const a = await needAccount(req as Request);
    const name = req.body?.name === undefined ? a.name : str(req.body.name, 'name').trim().slice(0, 120);
    const phone = req.body?.phone === undefined ? a.phone : (req.body.phone ? String(req.body.phone).trim().slice(0, 30) : null);
    const newsletter = typeof req.body?.newsletter === 'boolean' ? req.body.newsletter : a.newsletter;
    await db.query('UPDATE accounts SET name=$2,phone=$3,newsletter=$4 WHERE id=$1', [a.id, name, phone, newsletter]);
    return { account: { name, email: a.email, phone, hasPassword: a.hasPassword, newsletter } };
  }));
  app.post('/account/password', limit(cfg.loginRateLimit), h(async (req) => {
    const a = await needAccount(req as Request);
    if (!a.hasPassword) throw new HttpError(409, 'esta conta entra com Google e não tem palavra-passe');
    const cur = (await db.query<any>('SELECT password_hash FROM accounts WHERE id=$1', [a.id])).rows[0];
    if (!checkPassword(String(req.body?.current ?? ''), cur.password_hash)) throw new HttpError(401, 'palavra-passe actual incorrecta');
    const next = goodPassword(req.body?.next);
    const keep = hashToken(bearer(req as Request)!);
    await db.transaction(async (tx) => {
      await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [a.id, hashPassword(next)]);
      await tx.query('DELETE FROM account_sessions WHERE account_id=$1 AND token_hash<>$2', [a.id, keep]); // termina as outras sessões
    });
    return { ok: true };
  }));
  /** Apaga a conta: anonimiza os dados pessoais; os bilhetes já emitidos continuam válidos. */
  app.delete('/account/me', h(async (req) => {
    const a = await needAccount(req as Request);
    const cur = (await db.query<any>('SELECT password_hash FROM accounts WHERE id=$1', [a.id])).rows[0];
    // contas só Google não têm palavra-passe: confirmam escrevendo o e-mail
    if (a.hasPassword ? !checkPassword(String(req.body?.password ?? ''), cur.password_hash) : (a.email ? String(req.body?.confirm ?? '').trim().toLowerCase() !== a.email : normalizePhone(String(req.body?.confirm ?? '')) !== a.phone)) throw new HttpError(401, a.hasPassword ? 'palavra-passe incorrecta' : a.email ? 'escreva o seu e-mail para confirmar' : 'escreva o seu número de telemóvel para confirmar');
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE accounts SET status='DELETED',email='apagada-'||id||'@removido.invalid',name='Conta apagada',phone=NULL,phone_e164=NULL,password_hash='-' WHERE id=$1`, [a.id]);
      await tx.query('DELETE FROM account_sessions WHERE account_id=$1', [a.id]);
    });
    return { ok: true };
  }));
  /** "Os meus bilhetes": encomendas da conta, com os links dos bilhetes já emitidos. */
  app.get('/account/orders', h(async (req) => {
    const a = await needAccount(req as Request);
    const os = (await db.query<any>(`SELECT o.id,o.status,o.total_minor,o.created_at,e.name AS event,e.starts_at,e.location,d.subdomain
        FROM ticket_orders o JOIN events e ON e.id=o.event_id LEFT JOIN event_domains d ON d.event_id=e.id WHERE o.account_id=$1 ORDER BY o.created_at DESC LIMIT 100`, [a.id])).rows;
    for (const o of os) o.tickets = (await orderTickets(db, o.id)).filter((t: any) => t.token).map((t: any) => ({ id: t.id, token: t.token, status: t.status }));
    return os;
  }));

  app.post('/public/events/:sub/orders', h(async (req) => {
    const account = await needAccount(req as Request); // comprar exige sessão iniciada
    const ev = await publicEvent(req.params.sub);
    const body = { ...req.body, buyerName: req.body?.buyerName || account.name, buyerContact: req.body?.buyerContact || account.email || account.phone };
    const r = await db.transaction(async (tx) => {
      const c = await createOrder(tx, ev, 'ONLINE', body, 'DIGITAL');
      await tx.query('UPDATE ticket_orders SET account_id=$2 WHERE id=$1', [c.orderId, account.id]);
      return c;
    });
    return { orderId: r.orderId, status: r.status, totalMinor: r.total };
  }));
  app.get('/public/orders/:id', h(async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'encomenda não encontrada');
    const o = await db.query<any>('SELECT id,status,total_minor,buyer_contact FROM ticket_orders WHERE id=$1', [req.params.id]);
    if (!o.rows[0]) throw new HttpError(404, 'encomenda não encontrada');
    // e-mail para onde os bilhetes seguem sozinhos (a conta de quem comprou), mascarado: a/b/c ficam a***@dominio
    const em = /^([^@\s])[^@\s]*(@[^@\s]+)$/.exec(o.rows[0].buyer_contact ?? '');
    o.rows[0].emailedTo = o.rows[0].status === 'PAID' && em ? em[1] + '***' + em[2] : null;
    delete o.rows[0].buyer_contact;
    const open = (await db.query<any>(`SELECT id FROM mpesa_charges WHERE kind='ORDER' AND ref_id=$1 AND status='PENDING'`, [req.params.id])).rows[0];
    return { ...o.rows[0], tickets: await orderTickets(db, req.params.id), chargeId: open?.id ?? null }; // chargeId: pagamento M-Pesa em curso
  }));
  /** Envia por e-mail os links dos bilhetes de uma encomenda paga. Limitado para não servir de spam. */
  app.post('/public/orders/:id/email', h(async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'encomenda não encontrada');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new HttpError(400, 'e-mail inválido');
    const o = (await db.query<any>('SELECT id,status FROM ticket_orders WHERE id=$1', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'encomenda não encontrada');
    if (o.status !== 'PAID') throw new HttpError(409, 'a encomenda ainda não foi paga');
    const sent = (await db.query<any>('SELECT count(*)::int AS c FROM notifications WHERE subject LIKE $1', ['%[' + o.id.slice(0, 8) + ']'])).rows[0].c;
    if (sent >= 3) throw new HttpError(429, 'já enviámos este bilhete por e-mail várias vezes');
    const ts = (await orderTickets(db, o.id)).filter((t: any) => t.token);
    const base = cfg.publicUrl ?? 'https://bilhetemais.live';
    const text = ['Obrigado pela sua compra no Bilhete+.', '', 'Os seus bilhetes (abra o link à entrada; serve também de carteira):', '',
      ...ts.map((t: any, i: number) => `Bilhete ${i + 1}: ${base}/t/${t.token}`), '', 'Guarde este e-mail: quem tiver o link tem acesso ao bilhete e ao saldo.'].join('\n');
    await queueMail(db, cfg.mailer ?? null, db, { to: email, subject: `Os seus bilhetes — Bilhete+ [${o.id.slice(0, 8)}]`, text });
    return { ok: true, delivered: !!cfg.mailer };
  }));
  const byTicketToken = async (token: string) => {
    const r = await db.query<any>(`SELECT t.id,t.status,t.wallet_id,t.event_id,e.name AS event_name FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.token_hash=$1`, [hashToken(token)]);
    if (!r.rows[0] || !r.rows[0].wallet_id) throw new HttpError(404, 'bilhete não encontrado');
    return r.rows[0];
  };
  app.get('/public/tickets/:token', h(async (req) => {
    const t = await byTicketToken(req.params.token);
    const mv = await db.query<any>('SELECT id,type,amount_minor,created_at FROM wallet_ledger_entries WHERE wallet_id=$1 ORDER BY created_at DESC,id LIMIT 50', [t.wallet_id]);
    const evRow = (await db.query<any>('SELECT * FROM events WHERE id=$1', [t.event_id])).rows[0];
    const sc = (await db.query<any>('SELECT short_code FROM tickets WHERE id=$1', [t.id])).rows[0]?.short_code ?? null;
    return { event: t.event_name, ticketStatus: t.status, shortCode: sc, balanceMinor: await wallet.balanceOf(t.wallet_id), movements: mv.rows, ...(await eventBrand(evRow)), settings: publicSettings((await settingsOf(db, evRow)).effective) };
  }));
  app.post('/public/tickets/:token/topup', h(async (req) => {
    const t = await byTicketToken(req.params.token);
    const provider = str(req.body.provider, 'provider');
    const amount = money(req.body.amountMinor);
    await checkTopup(db, await settingsById(db, t.event_id), t.wallet_id, amount);
    if (provider === 'mpesa') {
      const out = await db.transaction(async (tx) => {
        const r = await tx.query<any>('INSERT INTO topup_requests(wallet_id,provider,amount_minor) VALUES($1,$2,$3) RETURNING id', [t.wallet_id, 'mpesa', amount.toString()]);
        return { topupId: r.rows[0].id as string, chargeId: await startCharge(tx, 'TOPUP', r.rows[0].id, amount, req.body.phone) };
      });
      fire(out.chargeId);
      return { ...out, status: 'PENDING' };
    }
    const r = await db.query<any>('INSERT INTO topup_requests(wallet_id,provider,amount_minor) VALUES($1,$2,$3) RETURNING id', [t.wallet_id, provider, amount.toString()]);
    return { topupId: r.rows[0].id, status: 'PENDING' };
  }));
  app.post('/public/tickets/:token/refund-request', h(async (req) => {
    const t = await byTicketToken(req.params.token);
    if (!(await settingsById(db, t.event_id)).balanceRefundAllowed) throw new HttpError(403, 'este evento não permite reembolso de saldo');
    const amount = money(req.body.amountMinor);
    if ((await wallet.balanceOf(t.wallet_id)) < amount) throw new HttpError(409, 'saldo insuficiente');
    const r = await db.query<any>('INSERT INTO refund_requests(wallet_id,amount_minor) VALUES($1,$2) RETURNING id', [t.wallet_id, amount.toString()]);
    return { refundRequestId: r.rows[0].id, status: 'PENDING' };
  }));

  // ---------- webhooks de pagamento (confirmação do prestador) ----------
  /** Processa um evento de prestador (idempotente por provider_event_id). */
  const processProviderEvent = async (provider: string, b: any) => {
    return db.transaction(async (tx) => {
      const ins = await tx.query('INSERT INTO webhook_events(provider,provider_event_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1',
        [provider, str(b.id, 'id'), JSON.stringify(b)]);
      if (!ins.rows.length) return { replayed: true };
      if (b.type !== 'payment.succeeded') return { ignored: true };
      if (b.kind === 'ORDER') {
        const u = await tx.query(`UPDATE ticket_orders SET status='PAID' WHERE id=$1 AND status='PENDING_PAYMENT' RETURNING id`, [b.ref]);
        if (u.rows.length) await issueOrder(tx, b.ref);
      } else if (b.kind === 'TOPUP') {
        const u = await tx.query<any>(`UPDATE topup_requests SET status='CONFIRMED' WHERE id=$1 AND status='PENDING' RETURNING wallet_id,amount_minor`, [b.ref]);
        if (u.rows[0]) await wallet.topUp({ walletId: u.rows[0].wallet_id, amount: BigInt(u.rows[0].amount_minor), operator: 'provider:' + provider, idempotencyKey: 'topup:' + b.ref, externalRef: b.id }, tx);
      }
      return { ok: true };
    });
  };

  app.post('/webhooks/:provider', h(async (req) => {
    const sig = String(req.headers['x-signature'] ?? '');
    const expected = createHmac('sha256', cfg.webhookSecret).update(req.rawBody ?? Buffer.alloc(0)).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new HttpError(401, 'assinatura inválida');
    return processProviderEvent(req.params.provider, req.body);
  }));

  // ---------- balcão / caixa ----------
  const openSession = async (user: User, eventId: string, tx: Tx = db) => {
    const r = await tx.query<any>(`SELECT id FROM cashier_sessions WHERE user_id=$1 AND event_id=$2 AND status='OPEN'`, [user.id, eventId]);
    if (!r.rows[0]) throw new HttpError(409, 'caixa fechada: abra uma sessão de caixa');
    return r.rows[0].id as string;
  };
  app.post('/events/:id/cashier-sessions/open', ...staff('CASHIER'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const r = await db.query<any>('INSERT INTO cashier_sessions(event_id,user_id) VALUES($1,$2) RETURNING id', [req.params.id, req.user!.id]);
    return { sessionId: r.rows[0].id };
  }));
  app.post('/events/:id/cashier-sessions/close', ...staff('CASHIER'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const counted = money(req.body.countedMinor, true);
    return db.transaction(async (tx) => {
      const sid = await openSession(req.user!, req.params.id, tx);
      const e = await tx.query<any>('SELECT COALESCE(SUM(amount_minor),0)::text AS s FROM cash_movements WHERE session_id=$1', [sid]);
      const expected = BigInt(e.rows[0].s);
      await tx.query(`UPDATE cashier_sessions SET status='CLOSED',counted_minor=$2,expected_minor=$3,closed_at=now() WHERE id=$1`, [sid, counted.toString(), expected.toString()]);
      await audit(tx, req.user, 'cash.close', 'cashier_session', sid, { counted, expected });
      return { sessionId: sid, expectedMinor: expected, countedMinor: counted, differenceMinor: counted - expected };
    });
  }));
  app.post('/events/:id/counter/sales', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const format = req.body.format === 'DIGITAL' ? 'DIGITAL' : 'PHYSICAL';
    return db.transaction(async (tx) => {
      const sid = await openSession(req.user!, ev.id, tx);
      const o = await createOrder(tx, ev, 'COUNTER', req.body, format);
      if (o.total > 0n) await tx.query(`INSERT INTO cash_movements(session_id,kind,amount_minor,order_id) VALUES($1,'TICKET_SALE',$2,$3)`, [sid, o.total.toString(), o.orderId]);
      return { orderId: o.orderId, totalMinor: o.total, tickets: await orderTickets(tx, o.orderId) };
    });
  }));
  const walletByToken = async (tx: Tx, eventId: string, token: string) => {
    const r = await tx.query<any>(
      `SELECT c.id AS credential_id,c.wallet_id,c.status FROM wallet_credentials c JOIN wallets w ON w.id=c.wallet_id WHERE c.token_hash=$1 AND w.event_id=$2`, [hashToken(token), eventId]);
    if (!r.rows[0] || r.rows[0].status !== 'ACTIVE') throw new HttpError(404, 'credencial inválida');
    return r.rows[0] as { credential_id: string; wallet_id: string };
  };
  app.post('/events/:id/counter/topup-cash', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const amount = money(req.body.amountMinor);
    const key = str(req.body.idempotencyKey, 'idempotencyKey');
    return db.transaction(async (tx) => {
      const sid = await openSession(req.user!, ev.id, tx);
      const w = await walletByToken(tx, ev.id, str(req.body.token, 'token'));
      await checkTopup(tx, (await settingsOf(tx, ev)).effective, w.wallet_id, amount);
      const r = await wallet.topUp({ walletId: w.wallet_id, amount, operator: req.user!.id, idempotencyKey: key }, tx);
      if (!r.replayed) await tx.query(`INSERT INTO cash_movements(session_id,kind,amount_minor,ledger_entry_id) VALUES($1,'TOPUP',$2,$3)`, [sid, amount.toString(), r.entryId]);
      return { balanceMinor: r.balance, replayed: r.replayed };
    });
  }));
  app.post('/events/:id/counter/balance', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const w = await walletByToken(db, ev.id, str(req.body.token, 'token'));
    return { balanceMinor: await wallet.balanceOf(w.wallet_id) };
  }));
  /** Associa NFC (token lido do cartão) ou substitui credencial perdida, mantendo carteira e histórico. */
  app.post('/events/:id/counter/credentials', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const kind = req.body.kind === 'PHYSICAL_TICKET' ? 'PHYSICAL_TICKET' : 'NFC';
    const newToken = req.body.newToken ? str(req.body.newToken, 'newToken') : undefined;
    return db.transaction(async (tx) => {
      const w = await walletByToken(tx, ev.id, str(req.body.token, 'token'));
      let cred;
      if (req.body.replace) {
        await tx.query(`UPDATE wallet_credentials SET status='REVOKED' WHERE id=$1`, [w.credential_id]);
        cred = await wallet.issueCredential(w.wallet_id, kind, tx, newToken);
        await tx.query('UPDATE wallet_credentials SET replaced_by=$1 WHERE id=$2', [cred.id, w.credential_id]);
      } else cred = await wallet.issueCredential(w.wallet_id, kind, tx, newToken);
      await audit(tx, req.user, req.body.replace ? 'credential.replace' : 'credential.add', 'wallet', w.wallet_id);
      return { credentialId: cred.id, token: cred.token };
    });
  }));
  app.post('/events/:id/counter/block', ...staff('CASHIER', 'ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const w = await walletByToken(db, ev.id, str(req.body.token, 'token'));
    await db.query(`UPDATE wallet_credentials SET status='BLOCKED' WHERE id=$1`, [w.credential_id]);
    await audit(db, req.user, 'credential.block', 'credential', w.credential_id);
    return { blocked: true };
  }));

  // ---------- POS comerciantes ----------
  app.post('/pos/pay', ...staff('MERCHANT_OPERATOR'), h(async (req) => {
    const key = str(req.body.idempotencyKey, 'idempotencyKey');
    const token = str(req.body.token, 'token');
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw new HttpError(400, 'sem itens');
    return db.transaction(async (tx) => {
      const m = await tx.query<any>('SELECT event_id FROM merchants WHERE id=$1', [req.user!.merchant_id]);
      if (!(await settingsById(tx, m.rows[0].event_id)).walletEnabled) throw new HttpError(409, 'a carteira cashless está desactivada neste evento');
      let total = 0n;
      const lines: any[] = [];
      for (const it of items) {
        const qty = Number(it.qty);
        const p = await tx.query<any>('SELECT id,name,price_minor FROM products WHERE id=$1 AND merchant_id=$2 AND active', [it.productId, req.user!.merchant_id]);
        if (!p.rows[0] || !Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'produto inválido');
        total += BigInt(p.rows[0].price_minor) * BigInt(qty);
        lines.push({ productId: p.rows[0].id, name: p.rows[0].name, qty, priceMinor: p.rows[0].price_minor });
      }
      // a credencial tem de pertencer ao mesmo evento do comerciante
      const w = await tx.query<any>(`SELECT w.event_id FROM wallet_credentials c JOIN wallets w ON w.id=c.wallet_id WHERE c.token_hash=$1`, [hashToken(token)]);
      if (!w.rows[0] || w.rows[0].event_id !== m.rows[0].event_id) throw new WalletError('CREDENTIAL_INVALID');
      const r = await wallet.pay({ token, merchantId: req.user!.merchant_id!, amount: total, operator: req.user!.id, idempotencyKey: key }, tx);
      if (!r.replayed) await tx.query('INSERT INTO merchant_sales(merchant_id,ledger_entry_id,operator_id,items,total_minor) VALUES($1,$2,$3,$4,$5)',
        [req.user!.merchant_id, r.entryId, req.user!.id, JSON.stringify(lines), total.toString()]);
      return { entryId: r.entryId, totalMinor: total, balanceMinor: r.balance, replayed: r.replayed };
    });
  }));
  app.post('/pos/refund', ...staff('MERCHANT_OPERATOR', 'ORG_ADMIN'), h(async (req) => {
    const s = await db.query<any>(`SELECT s.ledger_entry_id,s.merchant_id,m.event_id FROM merchant_sales s JOIN merchants m ON m.id=s.merchant_id WHERE s.id=$1`, [req.body.saleId]);
    const sale = s.rows[0];
    if (!sale) throw new HttpError(404, 'venda não encontrada');
    if (req.user!.role === 'MERCHANT_OPERATOR' && sale.merchant_id !== req.user!.merchant_id) throw new HttpError(404, 'venda não encontrada');
    if (req.user!.role === 'ORG_ADMIN') await eventFor(req.user!, sale.event_id);
    const r = await wallet.refundPayment({ entryId: sale.ledger_entry_id, operator: req.user!.id });
    await audit(db, req.user, 'pos.refund', 'ledger', sale.ledger_entry_id);
    return { balanceMinor: r.balance, replayed: r.replayed };
  }));
  app.get('/pos/products', ...staff('MERCHANT_OPERATOR'), h(async (req) =>
    (await db.query('SELECT id,name,price_minor FROM products WHERE merchant_id=$1 AND active ORDER BY name', [req.user!.merchant_id])).rows));

  // ---------- controlo de entradas ----------
  app.post('/events/:id/scan', ...staff('GATE_OPERATOR'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const input = str(req.body.token, 'token').trim();
    return db.transaction(async (tx) => {
      const st = (await settingsOf(tx, ev)).effective;
      let result: string, ticketId: string | null = null;
      const tk = await findTicket(tx, ev.id, input);
      const t = { rows: tk ? [tk] : [] as { id: string; status: string }[] };
      if (t.rows[0]) ticketId = t.rows[0].id;
      if (!t.rows[0] || t.rows[0].status === 'PENDING') result = 'UNAUTHORIZED';
      else if (t.rows[0].status === 'REVOKED') result = 'REVOKED';
      else if (t.rows[0].status === 'BLOCKED') result = 'BLOCKED';
      else if (new Date(ev.ends_at) < new Date()) result = 'EXPIRED';
      else {
        const u = await tx.query(`UPDATE tickets SET status='USED',used_at=now() WHERE id=$1 AND status='ISSUED' RETURNING id`, [ticketId]);
        result = u.rows.length || st.reentryAllowed ? 'VALID' : 'ALREADY_USED';
      }
      await tx.query('INSERT INTO entry_scans(event_id,gate_id,ticket_id,operator_id,result) VALUES($1,$2,$3,$4,$5)', [ev.id, req.body.gateId ?? null, ticketId, req.user!.id, result]);
      // dados para a pessoa da portaria confirmar quem entra (o QR só leva um código opaco)
      let ticket: { type: string; holder: string; usedAt: string | null; firstGate: string | null; reason: string | null } | null = null;
      if (ticketId) {
        const d = (await tx.query<any>(`SELECT tt.name AS type, o.buyer_name AS holder, t.used_at, t.status_reason,
            (SELECT g.name FROM entry_scans s JOIN access_gates g ON g.id=s.gate_id WHERE s.ticket_id=t.id AND s.result='VALID' ORDER BY s.created_at LIMIT 1) AS first_gate
          FROM tickets t JOIN ticket_types tt ON tt.id=t.ticket_type_id JOIN ticket_orders o ON o.id=t.order_id WHERE t.id=$1`, [ticketId])).rows[0];
        if (d) ticket = { type: d.type, holder: d.holder, usedAt: d.used_at, firstGate: d.first_gate, reason: result === 'BLOCKED' || result === 'REVOKED' ? d.status_reason : null };
      }
      return { result, ticket };
    });
  }));
  // ---------- controlo de bilhetes: bloquear (reversível) e cancelar (definitivo), sempre com justificação ----------
  const ticketReason = (v: unknown) => {
    const r = String(v ?? '').trim();
    if (r.length < 3) throw new HttpError(400, 'indique o motivo');
    if (r.length > 300) throw new HttpError(400, 'motivo demasiado longo (máx. 300)');
    return r;
  };
  /** Carrega o bilhete garantindo que pertence a um evento da empresa de quem pede. */
  const ticketOf = async (user: User, id: string, tx: Tx = db) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'bilhete não encontrado');
    const t = (await tx.query<any>('SELECT id,event_id,status,status_before,wallet_id FROM tickets WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!t) throw new HttpError(404, 'bilhete não encontrado');
    await eventFor(user, t.event_id, tx);
    return t;
  };
  const setTicketStatus = async (tx: Tx, user: User, t: any, status: string, before: string | null, reason: string | null) => {
    await tx.query('UPDATE tickets SET status=$2,status_before=$3,status_reason=$4,status_changed_by=$5,status_changed_at=now() WHERE id=$1', [t.id, status, before, reason, user.id]);
  };
  app.get('/events/:id/tickets', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const q = String(req.query.q ?? '').trim().slice(0, 80);
    const status = String(req.query.status ?? '');
    const where = ['t.event_id=$1', `t.status<>'PENDING'`], args: unknown[] = [ev.id];
    if (['ISSUED', 'USED', 'BLOCKED', 'REVOKED'].includes(status)) { args.push(status); where.push(`t.status=$${args.length}`); }
    if (q) {
      const hash = q.length === 22 ? hashToken(q) : null; // o código completo do bilhete também serve de pesquisa
      args.push('%' + q.replace(/[%_\\]/g, '') + '%'); const like = args.length;
      args.push(hash); const h2 = args.length;
      where.push(`(o.buyer_name ILIKE $${like} OR o.buyer_contact ILIKE $${like} OR t.id::text ILIKE $${like} OR t.token_hash=$${h2})`);
    }
    return (await db.query(`SELECT t.id,t.status,t.status_reason AS reason,t.status_changed_at AS changed_at,tt.name AS type,o.buyer_name AS holder,o.buyer_contact AS contact,t.created_at,
        (SELECT u.name FROM users u WHERE u.id=t.status_changed_by) AS changed_by
      FROM tickets t JOIN ticket_types tt ON tt.id=t.ticket_type_id JOIN ticket_orders o ON o.id=t.order_id
      WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT 100`, args)).rows;
  }));
  app.post('/tickets/:id/block', ...staff('ORG_ADMIN'), h(async (req) => {
    const reason = ticketReason(req.body?.reason);
    return db.transaction(async (tx) => {
      const t = await ticketOf(req.user!, req.params.id, tx);
      if (t.status !== 'ISSUED' && t.status !== 'USED') throw new HttpError(409, t.status === 'BLOCKED' ? 'o bilhete já está bloqueado' : 'este bilhete já não pode ser bloqueado');
      await setTicketStatus(tx, req.user!, t, 'BLOCKED', t.status, reason);
      if (t.wallet_id) await tx.query(`UPDATE wallets SET status='BLOCKED' WHERE id=$1 AND status='ACTIVE'`, [t.wallet_id]); // sem entrada e sem pagamentos
      await audit(tx, req.user, 'ticket.block', 'ticket', t.id, { reason });
      return { status: 'BLOCKED' };
    });
  }));
  app.post('/tickets/:id/unblock', ...staff('ORG_ADMIN'), h(async (req) => {
    return db.transaction(async (tx) => {
      const t = await ticketOf(req.user!, req.params.id, tx);
      if (t.status !== 'BLOCKED') throw new HttpError(409, 'o bilhete não está bloqueado');
      await setTicketStatus(tx, req.user!, t, t.status_before === 'USED' ? 'USED' : 'ISSUED', null, null);
      if (t.wallet_id) await tx.query(`UPDATE wallets SET status='ACTIVE' WHERE id=$1 AND status='BLOCKED'`, [t.wallet_id]);
      await audit(tx, req.user, 'ticket.unblock', 'ticket', t.id);
      return { status: t.status_before === 'USED' ? 'USED' : 'ISSUED' };
    });
  }));
  /** Cancelar é definitivo: o bilhete deixa de entrar e a carteira fica bloqueada (o saldo devolve-se pelo circuito de reembolsos). */
  app.post('/tickets/:id/cancel', ...staff('ORG_ADMIN'), h(async (req) => {
    const reason = ticketReason(req.body?.reason);
    return db.transaction(async (tx) => {
      const t = await ticketOf(req.user!, req.params.id, tx);
      if (t.status === 'REVOKED') throw new HttpError(409, 'o bilhete já está cancelado');
      if (t.status === 'PENDING') throw new HttpError(409, 'o bilhete ainda não foi emitido');
      await setTicketStatus(tx, req.user!, t, 'REVOKED', null, reason);
      if (t.wallet_id) await tx.query(`UPDATE wallets SET status='BLOCKED' WHERE id=$1 AND status='ACTIVE'`, [t.wallet_id]);
      await audit(tx, req.user, 'ticket.cancel', 'ticket', t.id, { reason });
      return { status: 'REVOKED' };
    });
  }));
  app.post('/tickets/:id/revoke', ...staff('ORG_ADMIN'), h(async (req) => {
    const t = await db.query<any>('SELECT event_id FROM tickets WHERE id=$1', [req.params.id]);
    if (!t.rows[0]) throw new HttpError(404, 'bilhete não encontrado');
    await eventFor(req.user!, t.rows[0].event_id);
    await db.query(`UPDATE tickets SET status='REVOKED',status_reason=COALESCE($2,status_reason),status_changed_by=$3,status_changed_at=now() WHERE id=$1`, [req.params.id, req.body?.reason ? String(req.body.reason).slice(0, 300) : null, req.user!.id]);
    await audit(db, req.user, 'ticket.revoke', 'ticket', req.params.id);
    return { status: 'REVOKED' };
  }));

  // ---------- reembolsos de saldo ----------
  app.post('/refund-requests/:id/decide', ...staff('ORG_ADMIN'), h(async (req) => {
    const rr = await db.query<any>(`SELECT r.*,w.event_id FROM refund_requests r JOIN wallets w ON w.id=r.wallet_id WHERE r.id=$1`, [req.params.id]);
    const r = rr.rows[0];
    if (!r) throw new HttpError(404, 'pedido não encontrado');
    const ev = await eventFor(req.user!, r.event_id);
    if (r.status !== 'PENDING') throw new HttpError(409, 'pedido já decidido');
    if (req.body.approve && !(await settingsOf(db, ev)).effective.balanceRefundAllowed) throw new HttpError(403, 'o evento não permite reembolso de saldo');
    let balanceMinor: bigint | undefined;
    if (req.body.approve) balanceMinor = (await wallet.cashOut({ walletId: r.wallet_id, amount: BigInt(r.amount_minor), operator: req.user!.id, idempotencyKey: 'cashout:' + r.id })).balance;
    await db.query('UPDATE refund_requests SET status=$2,decided_by=$3 WHERE id=$1', [r.id, req.body.approve ? 'APPROVED' : 'REJECTED', req.user!.id]);
    await audit(db, req.user, 'refund.decide', 'refund_request', r.id, { approve: !!req.body.approve });
    return { status: req.body.approve ? 'APPROVED' : 'REJECTED', balanceMinor };
  }));

  // ---------- relatórios e reconciliação ----------
  app.get('/events/:id/report', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const q = async (sql: string) => (await db.query<any>(sql, [ev.id])).rows;
    const [t] = await q(`SELECT count(*) FILTER (WHERE status IN ('ISSUED','USED'))::int AS issued, count(*) FILTER (WHERE status='USED')::int AS entered FROM tickets WHERE event_id=$1`);
    const [rev] = await q(`SELECT COALESCE(SUM(total_minor),0)::text AS v FROM ticket_orders WHERE event_id=$1 AND status='PAID'`);
    const led = await q(`SELECT l.type,COALESCE(SUM(l.amount_minor),0)::text AS v FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id WHERE w.event_id=$1 GROUP BY l.type`);
    const L = (ty: string) => BigInt(led.find((x: any) => x.type === ty)?.v ?? 0);
    const sales = await q(`SELECT m.name,COALESCE(SUM(s.total_minor),0)::text AS total FROM merchants m LEFT JOIN merchant_sales s ON s.merchant_id=m.id WHERE m.event_id=$1 GROUP BY m.id,m.name ORDER BY m.name`);
    // Reconciliação: carregamentos no ledger = pedidos digitais confirmados + numerário em caixa
    const [dig] = await q(`SELECT COALESCE(SUM(r.amount_minor),0)::text AS v FROM topup_requests r JOIN wallets w ON w.id=r.wallet_id WHERE w.event_id=$1 AND r.status='CONFIRMED'`);
    const [cash] = await q(`SELECT COALESCE(SUM(c.amount_minor),0)::text AS v FROM cash_movements c JOIN cashier_sessions s ON s.id=c.session_id WHERE s.event_id=$1 AND c.kind='TOPUP'`);
    const topups = L('TOPUP');
    const inCirculation = L('TOPUP') + L('PAYMENT') + L('REFUND') + L('CASHOUT') + L('ADJUSTMENT');
    return {
      tickets: { issued: t.issued, entered: t.entered, revenueMinor: BigInt(rev.v) },
      wallets: { topupsMinor: topups, paymentsMinor: -L('PAYMENT'), refundsMinor: L('REFUND'), cashoutsMinor: -L('CASHOUT'), balanceInCirculationMinor: inCirculation },
      merchants: sales.map((s: any) => ({ name: s.name, salesMinor: BigInt(s.total) })),
      reconciliation: { ledgerTopupsMinor: topups, digitalConfirmedMinor: BigInt(dig.v), cashMinor: BigInt(cash.v), differenceMinor: topups - BigInt(dig.v) - BigInt(cash.v) },
    };
  }));

  // ---------- leitura para a interface ----------
  app.get('/public/config', h(async () => ({ baseDomain: cfg.baseDomain ?? null, publicUrl: cfg.publicUrl ?? null, simulator: !!cfg.simulator, selfRegistration: !!cfg.selfRegistration, mpesa: !!cfg.mpesa, google: !!cfg.google, phone: !!cfg.sms, push: !!cfg.push })));
  /** Só sandbox: equivale a um webhook de sucesso do prestador. */
  app.post('/public/simulate-payment', h(async (req) => {
    if (!cfg.simulator) throw new HttpError(404, 'indisponível');
    const kind = req.body.kind === 'TOPUP' ? 'TOPUP' : 'ORDER';
    return processProviderEvent('simulator', { id: 'sim-' + randomUUID(), type: 'payment.succeeded', kind, ref: str(req.body.ref, 'ref') });
  }));
  app.get('/me', authenticate, h(async (req) => {
    const r = await db.query<any>(`SELECT u.mfa_enabled, o.trade_name AS org_name, o.slug AS org_slug, m.name AS merchant_name, m.event_id AS merchant_event_id
        FROM users u LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN merchants m ON m.id=u.merchant_id WHERE u.id=$1`, [req.user!.id]);
    return { id: req.user!.id, name: req.user!.name, role: req.user!.role, orgStatus: req.user!.orgStatus, mfaEnabled: r.rows[0].mfa_enabled, orgName: r.rows[0].org_name, orgSlug: r.rows[0].org_slug, merchantName: r.rows[0].merchant_name, eventId: r.rows[0].merchant_event_id };
  }));
  app.get('/orgs', ...staff('PLATFORM_ADMIN'), h(async () =>
    (await db.query(`SELECT o.id,o.slug,o.legal_name,o.trade_name,o.nuit,o.status,o.contact_name,o.phone,o.created_at,(SELECT count(*)::int FROM org_documents d WHERE d.organization_id=o.id) AS documents FROM organizations o ORDER BY (o.status='PENDING') DESC, o.created_at DESC`)).rows));
  /** Todos os eventos de todas as empresas (visão da administração da plataforma). */
  app.get('/platform/events', ...staff('PLATFORM_ADMIN'), h(async () =>
    (await db.query(`SELECT e.id,e.name,e.status,e.starts_at,e.location,d.subdomain,o.trade_name AS organization,o.id AS organization_id,e.theme,e.category,
        (SELECT max(a.updated_at) FROM brand_assets a WHERE a.event_id=e.id AND a.kind='cover') AS cover_at,
        (SELECT COALESCE(sum(po.total_minor),0)::text FROM ticket_orders po WHERE po.event_id=e.id AND po.status='PAID') AS revenue_minor,
        (SELECT count(*)::int FROM tickets t WHERE t.event_id=e.id AND t.status IN ('ISSUED','USED')) AS sold,
        (SELECT COALESCE(sum(quantity),0)::int FROM ticket_types q WHERE q.event_id=e.id) AS capacity
        FROM events e JOIN organizations o ON o.id=e.organization_id LEFT JOIN event_domains d ON d.event_id=e.id ORDER BY e.starts_at DESC LIMIT 500`)).rows));
  /** Quanto o evento já rendeu: bilhetes pagos, consumos com a carteira e carregamentos. */
  app.get('/platform/events/:id/summary', ...staff('PLATFORM_ADMIN'), h(async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'evento não encontrado');
    const ev = (await db.query<any>('SELECT e.id,e.name,e.status,e.starts_at,e.ends_at,e.location,o.trade_name AS organization FROM events e JOIN organizations o ON o.id=e.organization_id WHERE e.id=$1', [req.params.id])).rows[0];
    if (!ev) throw new HttpError(404, 'evento não encontrado');
    const q = async (sql: string) => (await db.query<any>(sql, [ev.id])).rows;
    const [tk] = await q(`SELECT count(*) FILTER (WHERE status IN ('ISSUED','USED'))::int AS sold, count(*) FILTER (WHERE status='USED')::int AS entered FROM tickets WHERE event_id=$1`);
    const [cap] = await q(`SELECT COALESCE(sum(quantity),0)::int AS v FROM ticket_types WHERE event_id=$1`);
    const [rev] = await q(`SELECT COALESCE(sum(total_minor),0)::text AS v, count(*)::int AS n FROM ticket_orders WHERE event_id=$1 AND status='PAID'`);
    const byType = await q(`SELECT tt.name, count(t.id)::int AS sold, COALESCE(sum(tt.price_minor),0)::text AS revenue FROM ticket_types tt LEFT JOIN tickets t ON t.ticket_type_id=tt.id AND t.status IN ('ISSUED','USED') WHERE tt.event_id=$1 GROUP BY tt.id,tt.name ORDER BY tt.name`);
    const led = await q(`SELECT l.type,COALESCE(SUM(l.amount_minor),0)::text AS v FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id WHERE w.event_id=$1 GROUP BY l.type`);
    const L = (ty: string) => BigInt(led.find((x: any) => x.type === ty)?.v ?? 0);
    const ticketsMinor = BigInt(rev.v), spentMinor = -L('PAYMENT') - L('REFUND');
    return {
      event: ev, tickets: { sold: tk.sold, entered: tk.entered, capacity: cap.v, paidOrders: rev.n, revenueMinor: ticketsMinor },
      byType: byType.map((r: any) => ({ name: r.name, sold: r.sold, revenueMinor: BigInt(r.revenue) })),
      wallets: { topupsMinor: L('TOPUP'), spentMinor, balanceMinor: L('TOPUP') + L('PAYMENT') + L('REFUND') + L('CASHOUT') + L('ADJUSTMENT') },
      totalMinor: ticketsMinor + spentMinor,
    };
  }));
  app.get('/events', authenticate, h(async (req) =>
    (await db.query(`SELECT e.id,e.name,e.status,e.starts_at,e.ends_at,e.location,e.theme,d.subdomain,
        (SELECT count(*)::int FROM tickets t WHERE t.event_id=e.id AND t.status IN ('ISSUED','USED')) AS sold,
        (SELECT COALESCE(sum(quantity),0)::int FROM ticket_types q WHERE q.event_id=e.id) AS capacity
        FROM events e LEFT JOIN event_domains d ON d.event_id=e.id
        WHERE e.organization_id=$1 ORDER BY e.starts_at DESC`, [req.user!.organization_id])).rows));
  app.get('/events/:id/overview', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const q = async (sql: string) => (await db.query<any>(sql, [ev.id])).rows;
    return {
      event: { ...ev, subdomain: (await q('SELECT subdomain FROM event_domains WHERE event_id=$1'))[0]?.subdomain },
      brand: await eventBrand(ev),
      ownAssets: (await q('SELECT kind FROM brand_assets WHERE event_id=$1')).map((x: any) => x.kind),
      inheritedTheme: (await (async () => {
        const o = await db.query<any>('SELECT theme FROM organizations WHERE id=$1', [ev.organization_id]);
        return (await chainOf(db, ev.id)).slice(0, -1).reduce((t, c) => ({ ...t, ...c.theme }), { ...o.rows[0].theme });
      })()),
      settings: await (async () => { const r = await settingsOf(db, ev); return { own: ev.settings, effective: r.effective, sources: r.sources, defaults: DEFAULTS }; })(),
      parent: ev.parent_event_id ? ((await db.query<any>('SELECT id,name FROM events WHERE id=$1', [ev.parent_event_id])).rows[0] ?? null) : null,
      ticketTypes: await q(`SELECT t.id,t.name,t.kind,t.price_minor,t.quantity,(SELECT count(*) FROM tickets k WHERE k.ticket_type_id=t.id AND k.status<>'REVOKED')::int AS sold FROM ticket_types t WHERE t.event_id=$1 ORDER BY t.name`),
      merchants: await q(`SELECT m.id,m.name,COALESCE((SELECT json_agg(json_build_object('id',p.id,'name',p.name,'price_minor',p.price_minor) ORDER BY p.name) FROM products p WHERE p.merchant_id=m.id AND p.active),'[]') AS products FROM merchants m WHERE m.event_id=$1 ORDER BY m.name`),
      gates: await q('SELECT id,name FROM access_gates WHERE event_id=$1 ORDER BY name'),
      refundRequests: await q(`SELECT r.id,r.amount_minor,r.status,r.created_at FROM refund_requests r JOIN wallets w ON w.id=r.wallet_id WHERE w.event_id=$1 ORDER BY r.created_at DESC LIMIT 50`),
    };
  }));
  app.get('/events/:id/ticket-types', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    return (await db.query(`SELECT t.id,t.name,t.price_minor,t.quantity-(SELECT count(*) FROM tickets k WHERE k.ticket_type_id=t.id AND k.status<>'REVOKED')::int AS available FROM ticket_types t WHERE t.event_id=$1 ORDER BY t.name`, [ev.id])).rows;
  }));
  app.get('/events/:id/gates', ...staff('GATE_OPERATOR'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    return (await db.query('SELECT id,name FROM access_gates WHERE event_id=$1 ORDER BY name', [ev.id])).rows;
  }));
  app.get('/events/:id/cashier-sessions/current', ...staff('CASHIER'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const r = await db.query<any>(`SELECT s.id,COALESCE((SELECT SUM(amount_minor) FROM cash_movements c WHERE c.session_id=s.id),0)::text AS expected FROM cashier_sessions s WHERE s.user_id=$1 AND s.event_id=$2 AND s.status='OPEN'`, [req.user!.id, ev.id]);
    return r.rows[0] ? { open: true, sessionId: r.rows[0].id, expectedMinor: r.rows[0].expected } : { open: false };
  }));
  app.get('/events/:id/gate-stats', ...staff('GATE_OPERATOR', 'ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const t = await db.query<any>(`SELECT count(*) FILTER (WHERE status IN ('ISSUED','USED'))::int AS issued, count(*) FILTER (WHERE status='USED')::int AS entered FROM tickets WHERE event_id=$1`, [ev.id]);
    const recent = await db.query<any>(`SELECT result,created_at FROM entry_scans WHERE event_id=$1 ORDER BY created_at DESC LIMIT 10`, [ev.id]);
    return { ...t.rows[0], recent: recent.rows };
  }));
  app.get('/pos/sales', ...staff('MERCHANT_OPERATOR'), h(async (req) =>
    (await db.query(`SELECT id,total_minor,created_at,items FROM merchant_sales WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user!.merchant_id])).rows));

  // ---------- identidade visual (tema por empresa e por evento) ----------
  const COLOR = /^#[0-9a-f]{6}$/i;
  const cleanTheme = (b: any) => {
    const t: Record<string, string> = {};
    for (const k of ['primary', 'accent']) {
      if (b?.[k] === undefined || b[k] === '' || b[k] === null) continue;
      if (typeof b[k] !== 'string' || !COLOR.test(b[k])) throw new HttpError(400, `cor inválida (${k}), use #RRGGBB`);
      t[k] = b[k].toLowerCase();
    }
    if (b?.heroStyle) { if (!['gradient', 'solid', 'image'].includes(b.heroStyle)) throw new HttpError(400, 'estilo inválido'); t.heroStyle = b.heroStyle; }
    if (b?.font) { if (!['system', 'serif', 'rounded', 'mono'].includes(b.font)) throw new HttpError(400, 'tipo de letra inválido'); t.font = b.font; }
    if (b?.tagline) { if (typeof b.tagline !== 'string' || b.tagline.length > 120) throw new HttpError(400, 'frase demasiado longa (máx. 120)'); t.tagline = b.tagline.trim(); }
    if (b?.ctaLabel) { if (typeof b.ctaLabel !== 'string' || b.ctaLabel.length > 24) throw new HttpError(400, 'texto do botão demasiado longo (máx. 24)'); t.ctaLabel = b.ctaLabel.trim(); }
    return t;
  };
  const imageType = (buf: Buffer) =>
    buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
      : buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'image/jpeg'
        : buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  const rawImage = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '1mb' });
  const assetKind = (k: string) => { if (k !== 'logo' && k !== 'cover') throw new HttpError(404, 'recurso não encontrado'); return k; };

  app.get('/org/brand', ...staffAny('ORG_ADMIN'), h(async (req) => {
    const o = await db.query<any>('SELECT theme FROM organizations WHERE id=$1', [req.user!.organization_id]);
    const a = await db.query<any>('SELECT kind FROM brand_assets WHERE organization_id=$1', [req.user!.organization_id]);
    return { theme: o.rows[0].theme, assets: a.rows.map((x: any) => x.kind) };
  }));
  app.put('/org/theme', ...staffAny('ORG_ADMIN'), h(async (req) => {
    const t = cleanTheme(req.body);
    await db.query('UPDATE organizations SET theme=$2 WHERE id=$1', [req.user!.organization_id, JSON.stringify(t)]);
    await audit(db, req.user, 'org.theme', 'organization', req.user!.organization_id!, t);
    return { theme: t };
  }));
  app.put('/org/assets/:kind', ...staffAny('ORG_ADMIN'), rawImage, h(async (req) => {
    const kind = assetKind(req.params.kind);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const type = buf && imageType(buf);
    if (!buf || !type) throw new HttpError(400, 'envie uma imagem PNG, JPEG ou WebP (máx. 1 MB)');
    await db.query(`INSERT INTO brand_assets(organization_id,kind,content_type,data) VALUES($1,$2,$3,$4)
      ON CONFLICT (organization_id,kind) WHERE organization_id IS NOT NULL DO UPDATE SET content_type=$3,data=$4,updated_at=now()`, [req.user!.organization_id, kind, type, buf]);
    return { ok: true };
  }));
  app.delete('/org/assets/:kind', ...staffAny('ORG_ADMIN'), h(async (req) => {
    await db.query('DELETE FROM brand_assets WHERE organization_id=$1 AND kind=$2', [req.user!.organization_id, assetKind(req.params.kind)]);
    return { ok: true };
  }));
  app.put('/events/:id/theme', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const t = cleanTheme(req.body);
    await db.query('UPDATE events SET theme=$2 WHERE id=$1', [req.params.id, JSON.stringify(t)]);
    await audit(db, req.user, 'event.theme', 'event', req.params.id, t);
    return { theme: t };
  }));
  app.put('/events/:id/assets/:kind', ...staff('ORG_ADMIN'), rawImage, h(async (req) => {
    await eventFor(req.user!, req.params.id);
    const kind = assetKind(req.params.kind);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const type = buf && imageType(buf);
    if (!buf || !type) throw new HttpError(400, 'envie uma imagem PNG, JPEG ou WebP (máx. 1 MB)');
    await db.query(`INSERT INTO brand_assets(event_id,kind,content_type,data) VALUES($1,$2,$3,$4)
      ON CONFLICT (event_id,kind) WHERE event_id IS NOT NULL DO UPDATE SET content_type=$3,data=$4,updated_at=now()`, [req.params.id, kind, type, buf]);
    return { ok: true };
  }));
  app.delete('/events/:id/assets/:kind', ...staff('ORG_ADMIN'), h(async (req) => {
    await eventFor(req.user!, req.params.id);
    await db.query('DELETE FROM brand_assets WHERE event_id=$1 AND kind=$2', [req.params.id, assetKind(req.params.kind)]);
    return { ok: true };
  }));
  /** Imagens públicas do evento (o logótipo cai para o da empresa quando o evento não tem o seu). */
  app.get('/public/events/:sub/assets/:kind', async (req, res, next) => {
    try {
      const kind = assetKind(req.params.kind);
      const e = await db.query<any>(`SELECT e.id,e.organization_id FROM event_domains d JOIN events e ON e.id=d.event_id WHERE d.subdomain=$1 AND e.status='PUBLISHED'`, [req.params.sub]);
      if (!e.rows[0]) throw new HttpError(404, 'sem imagem');
      const ids = (await chainOf(db, e.rows[0].id)).map((c) => c.id).reverse(); // do próprio evento para a raiz
      const r = await db.query<any>(
        `SELECT content_type,data FROM brand_assets WHERE kind=$1 AND (event_id = ANY($2::uuid[]) OR ($1='logo' AND organization_id=$3))
          ORDER BY CASE WHEN event_id IS NULL THEN 999 ELSE array_position($2::uuid[], event_id) END LIMIT 1`, [kind, ids, e.rows[0].organization_id]);
      if (!r.rows[0]) throw new HttpError(404, 'sem imagem');
      res.set({ 'Content-Type': r.rows[0].content_type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(r.rows[0].data);
    } catch (e) { next(e); }
  });

  /** Tema efectivo (empresa → eventos-pai → evento) e versões das imagens, para páginas públicas. */
  const eventBrand = async (ev: any) => {
    const o = await db.query<any>('SELECT trade_name,theme FROM organizations WHERE id=$1', [ev.organization_id]);
    const chain = await chainOf(db, ev.id);
    const ids = chain.map((c) => c.id);
    const a = await db.query<any>(`SELECT kind,updated_at FROM brand_assets WHERE event_id = ANY($1::uuid[]) OR (organization_id=$2 AND kind='logo')`, [ids, ev.organization_id]);
    const v = (k: string) => { const rows = a.rows.filter((x: any) => x.kind === k); return rows.length ? Math.max(...rows.map((x: any) => +new Date(x.updated_at))) : null; };
    const sub = await db.query<any>('SELECT subdomain FROM event_domains WHERE event_id=$1', [ev.id]);
    const theme = chain.reduce((t, c) => ({ ...t, ...c.theme }), { ...o.rows[0].theme });
    return { organization: o.rows[0].trade_name, subdomain: sub.rows[0]?.subdomain, theme, assets: { logo: v('logo'), cover: v('cover') } };
  };

  // ---------- registo self-service de empresas ----------
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const opt = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  /** Qualquer pessoa pode registar a sua empresa; fica PENDING até aprovação da plataforma. */
  app.post('/public/register', limit(cfg.registerRateLimit), h(async (req) => {
    if (!cfg.selfRegistration) throw new HttpError(404, 'o registo de empresas está fechado; contacte a equipa Bilhete+');
    const b = req.body ?? {};
    const email = str(b.email, 'email').toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, 'e-mail inválido');
    const password = str(b.password, 'password');
    if (password.length < 8) throw new HttpError(400, 'a palavra-passe deve ter pelo menos 8 caracteres');
    const nuit = str(b.nuit, 'NUIT');
    if (!/^\d{9}$/.test(nuit)) throw new HttpError(400, 'NUIT inválido (9 dígitos)');
    if (b.acceptTerms !== true) throw new HttpError(400, 'é necessário aceitar os termos de utilização');
    return db.transaction(async (tx) => {
      const o = await tx.query<any>(
        `INSERT INTO organizations(legal_name,trade_name,nuit,address,phone,contact_name,billing_email,website,slug) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,slug`,
        [str(b.legalName, 'denominação legal'), str(b.tradeName, 'nome comercial'), nuit, opt(b.address), opt(b.phone, 40), str(b.contactName, 'responsável'), opt(b.billingEmail) ?? email, opt(b.website), await uniqueOrgSlug(tx, String(b.tradeName ?? ''))]);
      await tx.query(`INSERT INTO users(organization_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'ORG_ADMIN')`,
        [o.rows[0].id, email, str(b.contactName, 'responsável'), hashPassword(password)]);
      await audit(tx, undefined, 'org.register', 'organization', o.rows[0].id, { nuit });
      await queueMail(db, cfg.mailer ?? null, tx, { to: email, organizationId: o.rows[0].id, subject: 'Recebemos o registo da sua empresa — Bilhete+',
        text: `Olá ${str(b.contactName, 'responsável')},\n\nRecebemos o registo de ${str(b.tradeName, 'nome comercial')}. A nossa equipa vai validar os dados e avisamos quando a empresa for aprovada. Entretanto pode entrar, completar o perfil e anexar documentos.\n\nBilhete+` });
      return { id: o.rows[0].id, status: 'PENDING', slug: o.rows[0].slug };
    });
  }));

  const orgProfile = async (orgId: string) => {
    const r = await db.query<any>(`SELECT id,slug,legal_name,trade_name,nuit,address,phone,contact_name,billing_email,website,status,status_reason,created_at FROM organizations WHERE id=$1`, [orgId]);
    const d = await db.query<any>('SELECT id,label,filename,content_type,created_at FROM org_documents WHERE organization_id=$1 ORDER BY created_at', [orgId]);
    return { ...r.rows[0], documents: d.rows };
  };
  app.get('/org/profile', ...staffAny('ORG_ADMIN'), h(async (req) => orgProfile(req.user!.organization_id!)));
  app.put('/org/profile', ...staffAny('ORG_ADMIN'), h(async (req) => {
    const b = req.body ?? {};
    await db.query(`UPDATE organizations SET trade_name=COALESCE($2,trade_name),address=$3,phone=$4,contact_name=$5,billing_email=$6,website=$7 WHERE id=$1`,
      [req.user!.organization_id, opt(b.tradeName), opt(b.address), opt(b.phone, 40), opt(b.contactName), opt(b.billingEmail), opt(b.website)]);
    return orgProfile(req.user!.organization_id!);
  }));
  const rawDoc = express.raw({ type: ['application/pdf', 'image/png', 'image/jpeg'], limit: '3mb' });
  /** Empresa rejeitada corrige os dados e volta a pedir aprovação. */
  app.post('/org/resubmit', ...staffAny('ORG_ADMIN'), h(async (req) => {
    const r = await db.query(`UPDATE organizations SET status='PENDING',status_reason=NULL WHERE id=$1 AND status='REJECTED' RETURNING id`, [req.user!.organization_id]);
    if (!r.rows[0]) throw new HttpError(409, 'só empresas rejeitadas podem voltar a submeter');
    await audit(db, req.user, 'org.resubmit', 'organization', req.user!.organization_id!);
    return { status: 'PENDING' };
  }));
  app.post('/org/documents', ...staffAny('ORG_ADMIN'), rawDoc, h(async (req) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const ct = String(req.headers['content-type'] ?? '').split(';')[0];
    const isPdf = !!buf && buf.subarray(0, 4).toString() === '%PDF';
    const img = buf && imageType(buf);
    if (!buf || !((ct === 'application/pdf' && isPdf) || (img && img === ct && ct !== 'image/webp'))) throw new HttpError(400, 'envie um PDF, PNG ou JPEG (máx. 3 MB)');
    const n = await db.query<any>('SELECT count(*)::int AS c FROM org_documents WHERE organization_id=$1', [req.user!.organization_id]);
    if (n.rows[0].c >= 10) throw new HttpError(409, 'limite de documentos atingido');
    const r = await db.query<any>('INSERT INTO org_documents(organization_id,label,filename,content_type,data) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [req.user!.organization_id, opt(req.headers['x-doc-label'], 80) ?? 'Documento', (opt(req.headers['x-filename'], 120) ?? 'documento').replace(/[^\w.\- ]/g, '_'), ct, buf]);
    return { id: r.rows[0].id };
  }));
  app.delete('/org/documents/:id', ...staffAny('ORG_ADMIN'), h(async (req) => {
    await db.query('DELETE FROM org_documents WHERE id=$1 AND organization_id=$2', [req.params.id, req.user!.organization_id]);
    return { ok: true };
  }));
  /** A plataforma revê os documentos da empresa (descarregados como anexo, nunca renderizados). */
  app.get('/orgs/:id/documents/:doc', ...staff('PLATFORM_ADMIN'), async (req, res, next) => {
    try {
      const r = await db.query<any>('SELECT filename,content_type,data FROM org_documents WHERE id=$1 AND organization_id=$2', [req.params.doc, req.params.id]);
      if (!r.rows[0]) throw new HttpError(404, 'documento não encontrado');
      res.set({ 'Content-Type': r.rows[0].content_type, 'Content-Disposition': `attachment; filename="${r.rows[0].filename}"`, 'X-Content-Type-Options': 'nosniff' }).send(r.rows[0].data);
    } catch (e) { next(e); }
  });
  app.get('/orgs/:id', ...staff('PLATFORM_ADMIN'), h(async (req) => {
    const p = await orgProfile(req.params.id);
    if (!p.id) throw new HttpError(404, 'empresa não encontrada');
    const users = await db.query(`SELECT id,name,email,role,status FROM users WHERE organization_id=$1 ORDER BY created_at`, [req.params.id]);
    const events = await db.query(`SELECT e.id,e.name,e.status,e.starts_at,(SELECT count(*)::int FROM tickets t WHERE t.event_id=e.id AND t.status IN ('ISSUED','USED')) AS sold FROM events e WHERE e.organization_id=$1 ORDER BY e.starts_at DESC`, [req.params.id]);
    return { ...p, users: users.rows, events: events.rows };
  }));

  // ---------- parâmetros por evento (com herança) ----------
  const DEFAULTS = {
    walletEnabled: true, minTopupMinor: 0, maxTopupMinor: null as number | null, maxBalanceMinor: null as number | null,
    balanceRefundAllowed: false, maxTicketsPerOrder: 20, onlineSalesEnabled: true, counterSalesEnabled: true,
    reentryAllowed: false, ticketCategories: 'multiple' as 'single' | 'multiple', merchantCommissionBps: 0,
  };
  type Settings = typeof DEFAULTS;
  /** Cadeia de heranças do evento, da raiz até ao próprio evento. */
  const chainOf = async (tx: Tx, eventId: string) => (await tx.query<any>(
    `WITH RECURSIVE c AS (
       SELECT id,parent_event_id,name,settings,theme,0 AS d FROM events WHERE id=$1
       UNION ALL SELECT e.id,e.parent_event_id,e.name,e.settings,e.theme,c.d+1 FROM events e JOIN c ON e.id=c.parent_event_id WHERE c.d<10)
     SELECT id,name,settings,theme FROM c ORDER BY d DESC`, [eventId])).rows as { id: string; name: string; settings: Partial<Settings>; theme: any }[];
  /** Parâmetros efectivos + de onde vem cada um (nome do evento que o define). */
  const settingsOf = async (tx: Tx, ev: { id: string; balance_refund_allowed?: boolean }) => {
    const effective: Settings = { ...DEFAULTS, balanceRefundAllowed: !!ev.balance_refund_allowed };
    const sources: Record<string, string> = {};
    for (const r of await chainOf(tx, ev.id)) for (const [k, v] of Object.entries(r.settings ?? {})) { (effective as any)[k] = v; sources[k] = r.name; }
    return { effective, sources };
  };
  const settingsById = async (tx: Tx, eventId: string) => {
    const ev = (await tx.query<any>('SELECT id,balance_refund_allowed FROM events WHERE id=$1', [eventId])).rows[0];
    return (await settingsOf(tx, ev)).effective;
  };
  const cleanSettings = (b: any) => {
    const s: Record<string, unknown> = {};
    const bool = (k: string) => { if (b?.[k] === undefined || b[k] === null) return; if (typeof b[k] !== 'boolean') throw new HttpError(400, `${k} deve ser verdadeiro/falso`); s[k] = b[k]; };
    const int = (k: string, min: number, max: number) => {
      if (b?.[k] === undefined || b[k] === null || b[k] === '') return;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${k} fora dos limites (${min}–${max})`);
      s[k] = n;
    };
    for (const k of ['walletEnabled', 'balanceRefundAllowed', 'onlineSalesEnabled', 'counterSalesEnabled', 'reentryAllowed']) bool(k);
    int('merchantCommissionBps', 0, 10000); int('minTopupMinor', 0, 1e10); int('maxTopupMinor', 1, 1e10); int('maxBalanceMinor', 1, 1e11); int('maxTicketsPerOrder', 1, 50);
    if (b?.ticketCategories) { if (!['single', 'multiple'].includes(b.ticketCategories)) throw new HttpError(400, 'ticketCategories inválido'); s.ticketCategories = b.ticketCategories; }
    if (s.minTopupMinor !== undefined && s.maxTopupMinor !== undefined && (s.minTopupMinor as number) > (s.maxTopupMinor as number)) throw new HttpError(400, 'o mínimo não pode exceder o máximo');
    return s;
  };
  const publicSettings = (st: Settings) => ({ walletEnabled: st.walletEnabled, ticketCategories: st.ticketCategories, maxTicketsPerOrder: st.maxTicketsPerOrder, onlineSalesEnabled: st.onlineSalesEnabled, minTopupMinor: st.minTopupMinor, maxTopupMinor: st.maxTopupMinor });
  const checkTopup = async (tx: Tx, st: Settings, walletId: string, amount: bigint) => {
    if (!st.walletEnabled) throw new HttpError(409, 'a carteira cashless está desactivada neste evento');
    if (amount < BigInt(st.minTopupMinor)) throw new HttpError(400, 'valor abaixo do carregamento mínimo');
    if (st.maxTopupMinor !== null && amount > BigInt(st.maxTopupMinor)) throw new HttpError(400, 'valor acima do carregamento máximo');
    if (st.maxBalanceMinor !== null && (await wallet.balanceOf(walletId)) + amount > BigInt(st.maxBalanceMinor)) throw new HttpError(409, 'excede o saldo máximo da carteira');
  };

  app.put('/events/:id/settings', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const s = cleanSettings(req.body);
    await db.query('UPDATE events SET settings=$2 WHERE id=$1', [ev.id, JSON.stringify(s)]);
    await audit(db, req.user, 'event.settings', 'event', ev.id, s);
    return { settings: s };
  }));
  /** Define (ou remove) o evento de que este herda parâmetros e aparência. */
  app.put('/events/:id/parent', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const parentId = req.body.parentId ?? null;
    if (parentId) {
      if (parentId === ev.id) throw new HttpError(400, 'um evento não pode herdar de si próprio');
      await eventFor(req.user!, parentId); // mesma empresa
      if ((await chainOf(db, parentId)).some((r) => r.id === ev.id)) throw new HttpError(400, 'herança circular');
    }
    await db.query('UPDATE events SET parent_event_id=$2 WHERE id=$1', [ev.id, parentId]);
    await audit(db, req.user, 'event.parent', 'event', ev.id, { parentId });
    return { parentId };
  }));
  /** Copia a estrutura (tipos de bilhete, portas, comerciantes e produtos) de outro evento da mesma empresa. */
  const copyStructure = async (tx: Tx, fromId: string, toId: string, what: string[]) => {
    if (what.includes('ticketTypes')) await tx.query('INSERT INTO ticket_types(event_id,name,kind,price_minor,quantity) SELECT $2,name,kind,price_minor,quantity FROM ticket_types WHERE event_id=$1', [fromId, toId]);
    if (what.includes('gates')) await tx.query('INSERT INTO access_gates(event_id,name) SELECT $2,name FROM access_gates WHERE event_id=$1', [fromId, toId]);
    if (what.includes('merchants')) {
      const ms = await tx.query<any>('SELECT id,name FROM merchants WHERE event_id=$1', [fromId]);
      for (const m of ms.rows) {
        const n = await tx.query<any>('INSERT INTO merchants(event_id,name) VALUES($1,$2) RETURNING id', [toId, m.name]);
        await tx.query('INSERT INTO products(merchant_id,name,price_minor) SELECT $2,name,price_minor FROM products WHERE merchant_id=$1 AND active', [m.id, n.rows[0].id]);
      }
    }
  };

  // ---------- conteúdo do evento: detalhes, galeria, programação ----------
  app.put('/events/:id/details', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const b = req.body ?? {};
    const mapUrl = opt(b.mapUrl, 500);
    if (mapUrl && !/^https:\/\/\S+$/.test(mapUrl)) throw new HttpError(400, 'a ligação do mapa deve começar por https://');
    await db.query('UPDATE events SET name=COALESCE($2,name),description=$3,location=$4,map_url=$5,category=$6,latitude=$7,longitude=$8 WHERE id=$1', [ev.id, opt(b.name), opt(b.description, 4000), opt(b.location, 200), mapUrl, eventCategory(b.category), ...geoPair(b)]);
    return { ok: true };
  }));
  app.post('/events/:id/images', ...staff('ORG_ADMIN'), rawImage, h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const type = buf && imageType(buf);
    if (!buf || !type) throw new HttpError(400, 'envie uma imagem PNG, JPEG ou WebP (máx. 1 MB)');
    const n = await db.query<any>('SELECT count(*)::int AS c, COALESCE(max(position),-1)+1 AS next FROM event_images WHERE event_id=$1', [ev.id]);
    if (n.rows[0].c >= 12) throw new HttpError(409, 'limite de 12 imagens por evento');
    const r = await db.query<any>('INSERT INTO event_images(event_id,content_type,data,caption,position) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [ev.id, type, buf, opt(decodeURIComponent(String(req.headers['x-caption'] ?? '')), 140), n.rows[0].next]);
    return { id: r.rows[0].id };
  }));
  app.get('/events/:id/images', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    return (await db.query('SELECT id,caption,position FROM event_images WHERE event_id=$1 ORDER BY position,created_at', [ev.id])).rows;
  }));
  /** Pré-visualização para o organizador (mesmo antes de o evento estar publicado). */
  app.get('/events/:id/images/:img/file', ...staff('ORG_ADMIN'), async (req: any, res: Response, next: NextFunction) => {
    try {
      const ev = await eventFor(req.user!, req.params.id);
      const r = await db.query<any>('SELECT content_type,data FROM event_images WHERE id=$1 AND event_id=$2', [req.params.img, ev.id]);
      if (!r.rows[0]) throw new HttpError(404, 'imagem não encontrada');
      res.set({ 'Content-Type': r.rows[0].content_type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' }).send(r.rows[0].data);
    } catch (e) { next(e); }
  });
  app.patch('/events/:id/images/:img', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    await db.query('UPDATE event_images SET caption=$3 WHERE id=$1 AND event_id=$2', [req.params.img, ev.id, opt(req.body?.caption, 140)]);
    return { ok: true };
  }));
  app.put('/events/:id/images-order', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await db.transaction(async (tx) => { for (const [i, id] of ids.entries()) await tx.query('UPDATE event_images SET position=$3 WHERE id=$1 AND event_id=$2', [id, ev.id, i]); });
    return { ok: true };
  }));
  app.delete('/events/:id/images/:img', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    await db.query('DELETE FROM event_images WHERE id=$1 AND event_id=$2', [req.params.img, ev.id]);
    return { ok: true };
  }));
  app.get('/public/events/:sub/images/:img', async (req, res, next) => {
    try {
      const r = await db.query<any>(`SELECT i.content_type,i.data FROM event_domains d JOIN events e ON e.id=d.event_id JOIN event_images i ON i.event_id=e.id
        WHERE d.subdomain=$1 AND e.status='PUBLISHED' AND i.id=$2`, [req.params.sub, req.params.img]);
      if (!r.rows[0]) throw new HttpError(404, 'sem imagem');
      res.set({ 'Content-Type': r.rows[0].content_type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(r.rows[0].data);
    } catch (e) { next(e); }
  });

  app.post('/events/:id/sessions', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const b = req.body ?? {};
    const r = await db.query<any>('INSERT INTO event_sessions(event_id,title,starts_at,ends_at,stage,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [ev.id, str(b.title, 'título'), b.startsAt, b.endsAt || null, opt(b.stage, 80), opt(b.description, 500)]);
    return { id: r.rows[0].id };
  }));
  app.get('/events/:id/sessions', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    return (await db.query('SELECT id,title,starts_at,ends_at,stage,description FROM event_sessions WHERE event_id=$1 ORDER BY starts_at', [ev.id])).rows;
  }));
  app.delete('/events/:id/sessions/:sid', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    await db.query('DELETE FROM event_sessions WHERE id=$1 AND event_id=$2', [req.params.sid, ev.id]);
    return { ok: true };
  }));

  // ---------- área própria de cada empresa: entrada, equipa e isolamento ----------
  const ORG_RESERVED = new Set(['staff', 'registo', 'e', 'o', 't', 'api', 'admin', 'empresa', 'www', 'app', 'public']);
  const uniqueOrgSlug = async (tx: Tx, name: string) => {
    let base = slugify(name);
    if (base.length < 3 || ORG_RESERVED.has(base)) base = 'empresa';
    let slug = base;
    for (let i = 2; (await tx.query('SELECT 1 FROM organizations WHERE slug=$1', [slug])).rows.length; i++) slug = `${base.slice(0, 34)}-${i}`;
    return slug;
  };

  /** Dados públicos mínimos para a página de entrada da empresa (nome, marca). */
  app.get('/public/org/:slug', h(async (req) => {
    const r = await db.query<any>(`SELECT id,trade_name,slug,theme,status FROM organizations WHERE slug=$1 AND status<>'DISABLED'`, [req.params.slug]);
    if (!r.rows[0]) return { name: null, slug: null, theme: {}, logo: null }; // neutra: não revela se o endereço existe
    const a = await db.query<any>(`SELECT updated_at FROM brand_assets WHERE organization_id=$1 AND kind='logo'`, [r.rows[0].id]);
    return { name: r.rows[0].trade_name, slug: r.rows[0].slug, theme: r.rows[0].theme, logo: a.rows[0] ? +new Date(a.rows[0].updated_at) : null };
  }));
  app.get('/public/org/:slug/logo', async (req, res, next) => {
    try {
      const r = await db.query<any>(`SELECT a.content_type,a.data FROM organizations o JOIN brand_assets a ON a.organization_id=o.id AND a.kind='logo' WHERE o.slug=$1`, [req.params.slug]);
      if (!r.rows[0]) throw new HttpError(404, 'sem imagem');
      res.set({ 'Content-Type': r.rows[0].content_type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(r.rows[0].data);
    } catch (e) { next(e); }
  });

  // equipa da empresa (só a própria)
  app.get('/users', ...staffAny('ORG_ADMIN'), h(async (req) =>
    (await db.query(`SELECT u.id,u.name,u.email,u.role,u.status,u.created_at,m.name AS merchant_name FROM users u LEFT JOIN merchants m ON m.id=u.merchant_id
        WHERE u.organization_id=$1 ORDER BY u.created_at`, [req.user!.organization_id])).rows));
  app.get('/merchants', ...staff('ORG_ADMIN'), h(async (req) =>
    (await db.query(`SELECT m.id,m.name,e.name AS event_name FROM merchants m JOIN events e ON e.id=m.event_id WHERE e.organization_id=$1 ORDER BY e.starts_at DESC,m.name`, [req.user!.organization_id])).rows));
  const ownUser = async (req: Req) => {
    const r = await db.query<any>('SELECT id,role FROM users WHERE id=$1 AND organization_id=$2', [req.params.id, req.user!.organization_id]);
    if (!r.rows[0]) throw new HttpError(404, 'utilizador não encontrado');
    return r.rows[0] as { id: string; role: Role };
  };
  app.patch('/users/:id', ...staff('ORG_ADMIN'), h(async (req) => {
    const u = await ownUser(req);
    const status = req.body.status;
    if (!['ACTIVE', 'DISABLED'].includes(status)) throw new HttpError(400, 'estado inválido');
    if (u.id === req.user!.id) throw new HttpError(400, 'não pode desactivar a sua própria conta');
    await db.query('UPDATE users SET status=$2 WHERE id=$1', [u.id, status]);
    if (status === 'DISABLED') await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    await audit(db, req.user, 'user.status', 'user', u.id, { status });
    return { id: u.id, status };
  }));
  app.post('/users/:id/password', ...staff('ORG_ADMIN'), h(async (req) => {
    const u = await ownUser(req);
    const pw = str(req.body.password, 'password');
    if (pw.length < 8) throw new HttpError(400, 'a palavra-passe deve ter pelo menos 8 caracteres');
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, hashPassword(pw)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]); // termina as sessões abertas
    await audit(db, req.user, 'user.password_reset', 'user', u.id);
    return { ok: true };
  }));
  /** Qualquer utilizador altera a sua própria palavra-passe. */
  app.post('/me/password', authenticate, h(async (req) => {
    const r = await db.query<any>('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
    if (!checkPassword(String(req.body.current ?? ''), r.rows[0].password_hash)) throw new HttpError(401, 'palavra-passe actual incorrecta');
    const pw = str(req.body.password, 'password');
    if (pw.length < 8) throw new HttpError(400, 'a palavra-passe deve ter pelo menos 8 caracteres');
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user!.id, hashPassword(pw)]);
    return { ok: true };
  }));

  // ---------- acertos com comerciantes ----------
  /** Vendas, devoluções, comissão e valor devido a cada comerciante do evento. */
  const settlementsOf = async (ev: any) => {
    const st = (await settingsOf(db, ev)).effective;
    const r = await db.query<any>(
      `SELECT m.id,m.name,COALESCE(m.commission_bps,$2)::int AS bps,
              COALESCE(SUM(CASE WHEN l.type='PAYMENT' THEN -l.amount_minor END),0)::text AS gross,
              COALESCE(SUM(CASE WHEN l.type='REFUND' THEN l.amount_minor END),0)::text AS refunds,
              (SELECT COALESCE(SUM(p.amount_minor),0) FROM merchant_payouts p WHERE p.merchant_id=m.id)::text AS paid
         FROM merchants m LEFT JOIN wallet_ledger_entries l ON l.merchant_id=m.id AND l.type IN ('PAYMENT','REFUND')
        WHERE m.event_id=$1 GROUP BY m.id ORDER BY m.name`, [ev.id, st.merchantCommissionBps]);
    return r.rows.map((m: any) => {
      const net = BigInt(m.gross) - BigInt(m.refunds);
      const commission = (net * BigInt(m.bps)) / 10000n;
      const due = net - commission;
      return { merchantId: m.id, name: m.name, commissionBps: m.bps, grossMinor: BigInt(m.gross), refundsMinor: BigInt(m.refunds), netMinor: net, commissionMinor: commission, dueMinor: due, paidMinor: BigInt(m.paid), outstandingMinor: due - BigInt(m.paid) };
    });
  };
  app.get('/events/:id/settlements', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const rows = await settlementsOf(ev);
    const sum = (k: 'netMinor' | 'commissionMinor' | 'dueMinor' | 'paidMinor' | 'outstandingMinor') => rows.reduce((s, r) => s + r[k], 0n);
    return { merchants: rows, totals: { netMinor: sum('netMinor'), commissionMinor: sum('commissionMinor'), dueMinor: sum('dueMinor'), paidMinor: sum('paidMinor'), outstandingMinor: sum('outstandingMinor') } };
  }));
  app.put('/merchants/:id/commission', ...staff('ORG_ADMIN'), h(async (req) => {
    const m = (await db.query<any>('SELECT event_id FROM merchants WHERE id=$1', [req.params.id])).rows[0];
    if (!m) throw new HttpError(404, 'comerciante não encontrado');
    await eventFor(req.user!, m.event_id);
    const bps = req.body.bps === null || req.body.bps === '' || req.body.bps === undefined ? null : Number(req.body.bps);
    if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > 10000)) throw new HttpError(400, 'comissão inválida (0–10000 pontos base)');
    await db.query('UPDATE merchants SET commission_bps=$2 WHERE id=$1', [req.params.id, bps]);
    await audit(db, req.user, 'merchant.commission', 'merchant', req.params.id, { bps });
    return { bps };
  }));
  /** Regista o pagamento ao comerciante; não pode exceder o que está em dívida. */
  app.post('/events/:id/settlements/:mid/payouts', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const amount = money(req.body.amountMinor);
    return db.transaction(async (tx) => {
      await tx.query('SELECT 1 FROM merchants WHERE id=$1 AND event_id=$2 FOR UPDATE', [req.params.mid, ev.id]); // serializa pagamentos ao mesmo comerciante
      const row = (await settlementsOf(ev)).find((r) => r.merchantId === req.params.mid);
      if (!row) throw new HttpError(404, 'comerciante não encontrado');
      if (amount > row.outstandingMinor) throw new HttpError(409, 'o valor excede o que está em dívida ao comerciante');
      const r = await tx.query<any>('INSERT INTO merchant_payouts(merchant_id,amount_minor,reference,paid_by) VALUES($1,$2,$3,$4) RETURNING id', [req.params.mid, amount.toString(), opt(req.body.reference, 120), req.user!.id]);
      await audit(tx, req.user, 'merchant.payout', 'merchant', req.params.mid, { amount });
      return { id: r.rows[0].id, outstandingMinor: row.outstandingMinor - amount };
    });
  }));

  // ---------- exportação CSV ----------
  /** Células que começam por = + - @ seriam interpretadas como fórmulas no Excel: prefixa-se uma plica. */
  const csvCell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; // o separador é ';': a vírgula decimal não precisa de aspas
  };
  const sendCsv = (res: Response, name: string, head: string[], rows: unknown[][]) => {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' })
      .send('﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n'));
  };
  const money2 = (v: unknown) => (BigInt(String(v)) < 0n ? '-' : '') + (((BigInt(String(v)) < 0n ? -BigInt(String(v)) : BigInt(String(v))) / 100n).toString()) + ',' + ((BigInt(String(v)) < 0n ? -BigInt(String(v)) : BigInt(String(v))) % 100n).toString().padStart(2, '0');
  app.get('/events/:id/export/:what', ...staff('ORG_ADMIN'), async (req: any, res: Response, next: NextFunction) => {
    try {
      const ev = await eventFor(req.user!, req.params.id);
      const slug = slugify(ev.name) || 'evento';
      if (req.params.what === 'ledger') {
        const r = await db.query<any>(`SELECT l.created_at,l.type,l.amount_minor,m.name AS merchant,l.operator,l.id FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id LEFT JOIN merchants m ON m.id=l.merchant_id WHERE w.event_id=$1 ORDER BY l.created_at`, [ev.id]);
        return sendCsv(res, `${slug}-movimentos.csv`, ['Data', 'Tipo', 'Valor (MT)', 'Comerciante', 'Operador', 'Id'], r.rows.map((x: any) => [x.created_at, x.type, money2(x.amount_minor), x.merchant, x.operator, x.id]));
      }
      if (req.params.what === 'tickets') {
        const r = await db.query<any>(`SELECT o.created_at,o.buyer_name,o.channel,tt.name AS type,t.format,t.status,t.used_at,t.id FROM tickets t JOIN ticket_orders o ON o.id=t.order_id JOIN ticket_types tt ON tt.id=t.ticket_type_id WHERE t.event_id=$1 ORDER BY o.created_at`, [ev.id]);
        return sendCsv(res, `${slug}-bilhetes.csv`, ['Compra', 'Comprador', 'Canal', 'Tipo', 'Formato', 'Estado', 'Entrada', 'Id'], r.rows.map((x: any) => [x.created_at, x.buyer_name, x.channel, x.type, x.format, x.status, x.used_at, x.id]));
      }
      if (req.params.what === 'settlements') {
        const rows = await settlementsOf(ev);
        return sendCsv(res, `${slug}-acertos.csv`, ['Comerciante', 'Vendas (MT)', 'Devoluções (MT)', 'Líquido (MT)', 'Comissão (pb)', 'Comissão (MT)', 'Devido (MT)', 'Pago (MT)', 'Em dívida (MT)'],
          rows.map((r) => [r.name, money2(r.grossMinor), money2(r.refundsMinor), money2(r.netMinor), r.commissionBps, money2(r.commissionMinor), money2(r.dueMinor), money2(r.paidMinor), money2(r.outstandingMinor)]));
      }
      throw new HttpError(404, 'exportação desconhecida');
    } catch (e) { next(e); }
  });

  // ---------- comprovativos ----------
  app.get('/public/tickets/:token/receipts/:entry', h(async (req) => {
    const t = await byTicketToken(req.params.token);
    if (!/^[0-9a-f-]{36}$/.test(req.params.entry)) throw new HttpError(404, 'comprovativo não encontrado');
    const r = await db.query<any>(
      `SELECT l.id,l.type,l.amount_minor,l.created_at,m.name AS merchant,ms.items,ev.name AS event,o.trade_name AS organization,o.nuit
         FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id JOIN events ev ON ev.id=w.event_id JOIN organizations o ON o.id=ev.organization_id
         LEFT JOIN merchants m ON m.id=l.merchant_id LEFT JOIN merchant_sales ms ON ms.ledger_entry_id=l.id
        WHERE l.id=$1 AND l.wallet_id=$2`, [req.params.entry, t.wallet_id]); // só movimentos da própria carteira
    if (!r.rows[0]) throw new HttpError(404, 'comprovativo não encontrado');
    return { number: r.rows[0].id.slice(0, 8).toUpperCase(), ...r.rows[0], id: undefined };
  }));

  // ---------- portaria offline ----------
  /** Lista para validar sem rede: só hashes (não permite forjar bilhetes) e estado de cada um. */
  app.get('/events/:id/gate-manifest', ...staff('GATE_OPERATOR'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const st = (await settingsOf(db, ev)).effective;
    const t = await db.query<any>(`SELECT token_hash AS h,status AS s,short_code FROM tickets WHERE event_id=$1 AND status IN ('ISSUED','USED','REVOKED','BLOCKED')`, [ev.id]);
    // o código curto vai em hash (k), tal como o código completo: a lista guardada no telemóvel não revela nenhum código
    return { generatedAt: new Date().toISOString(), endsAt: ev.ends_at, reentryAllowed: st.reentryAllowed, tickets: t.rows.map((r: any) => ({ h: r.h, s: r.s, k: r.short_code ? createHash('sha256').update(r.short_code).digest('hex') : undefined })) };
  }));
  /** Sincroniza leituras feitas offline. Idempotente por clientId; conflitos (já usado noutra porta) ficam sinalizados. */
  app.post('/events/:id/scan-batch', ...staff('GATE_OPERATOR'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const scans: any[] = Array.isArray(req.body.scans) ? req.body.scans.slice(0, 500) : [];
    const st = (await settingsOf(db, ev)).effective;
    const out: { clientId: string; result: string; conflict: boolean }[] = [];
    for (const sc of scans.sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
      const clientId = str(sc.clientId, 'clientId');
      const at = new Date(sc.at); const when = isNaN(+at) || +at > Date.now() ? new Date() : at;
      out.push(await db.transaction(async (tx) => {
        const dup = await tx.query<any>('SELECT result FROM entry_scans WHERE event_id=$1 AND client_id=$2', [ev.id, clientId]);
        if (dup.rows[0]) return { clientId, result: dup.rows[0].result, conflict: false };
        const t = await findTicket(tx, ev.id, str(sc.token, 'token').trim());
        let result: string;
        if (!t || t.status === 'PENDING') result = 'UNAUTHORIZED';
        else if (t.status === 'REVOKED') result = 'REVOKED';
        else if (t.status === 'BLOCKED') result = 'BLOCKED';
        else if (new Date(ev.ends_at) < when) result = 'EXPIRED';
        else {
          const u = await tx.query(`UPDATE tickets SET status='USED',used_at=$2 WHERE id=$1 AND status='ISSUED' RETURNING id`, [t.id, when]);
          result = u.rows.length || st.reentryAllowed ? 'VALID' : 'ALREADY_USED';
        }
        await tx.query('INSERT INTO entry_scans(event_id,gate_id,ticket_id,operator_id,result,client_id,offline,created_at) VALUES($1,$2,$3,$4,$5,$6,true,$7)', [ev.id, sc.gateId ?? null, t?.id ?? null, req.user!.id, result, clientId, when]);
        // o dispositivo disse VALID mas o servidor já tinha o bilhete usado: houve dupla entrada entre portas
        return { clientId, result, conflict: result === 'ALREADY_USED' && sc.localResult === 'VALID' };
      }));
    }
    return { results: out, conflicts: out.filter((x) => x.conflict).length };
  }));

  // ---------- alertas e actividade ----------
  app.get('/events/:id/alerts', ...staff('ORG_ADMIN'), h(async (req) => {
    const ev = await eventFor(req.user!, req.params.id);
    const alerts: { level: 'warn' | 'bad'; text: string }[] = [];
    const q = async (sql: string) => (await db.query<any>(sql, [ev.id])).rows;
    const rep = (await q(`SELECT (SELECT COALESCE(SUM(l.amount_minor),0) FROM wallet_ledger_entries l JOIN wallets w ON w.id=l.wallet_id WHERE w.event_id=$1 AND l.type='TOPUP')
        - (SELECT COALESCE(SUM(r.amount_minor),0) FROM topup_requests r JOIN wallets w ON w.id=r.wallet_id WHERE w.event_id=$1 AND r.status='CONFIRMED')
        - (SELECT COALESCE(SUM(c.amount_minor),0) FROM cash_movements c JOIN cashier_sessions s ON s.id=c.session_id WHERE s.event_id=$1 AND c.kind='TOPUP') AS diff`))[0];
    if (BigInt(rep.diff) !== 0n) alerts.push({ level: 'bad', text: `Reconciliação de carregamentos com diferença de ${money2(rep.diff)} MT.` });
    for (const r of await q(`SELECT t.id,count(*)::int AS n FROM entry_scans s JOIN tickets t ON t.id=s.ticket_id WHERE s.event_id=$1 AND s.result='ALREADY_USED' GROUP BY t.id HAVING count(*)>=3`))
      alerts.push({ level: 'warn', text: `Bilhete ${String(r.id).slice(0, 8).toUpperCase()} lido ${r.n} vezes depois de já utilizado.` });
    const unauth = (await q(`SELECT count(*)::int AS n FROM entry_scans WHERE event_id=$1 AND result IN ('UNAUTHORIZED','REVOKED') AND created_at > now() - interval '1 hour'`))[0].n;
    if (unauth >= 5) alerts.push({ level: 'warn', text: `${unauth} leituras recusadas (não autorizado/revogado) na última hora.` });
    const conflicts = (await q(`SELECT count(*)::int AS n FROM entry_scans WHERE event_id=$1 AND offline AND result='ALREADY_USED'`))[0].n;
    if (conflicts > 0) alerts.push({ level: 'warn', text: `${conflicts} leituras offline em conflito (bilhete já tinha sido usado noutra porta).` });
    const out = (await q(`SELECT count(*)::int AS n FROM refund_requests r JOIN wallets w ON w.id=r.wallet_id WHERE w.event_id=$1 AND r.status='PENDING'`))[0].n;
    if (out > 0) alerts.push({ level: 'warn', text: `${out} pedidos de reembolso a aguardar decisão.` });
    const owed = (await settlementsOf(ev)).reduce((s, r) => s + r.outstandingMinor, 0n);
    if (owed > 0n) alerts.push({ level: 'warn', text: `${money2(owed)} MT em dívida aos comerciantes.` });
    return alerts;
  }));
  app.get('/audit', ...staff('ORG_ADMIN'), h(async (req) => {
    const limitN = Math.min(Number(req.query.limit) || 100, 500);
    return (await db.query(`SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.created_at,u.name AS user_name FROM audit_logs a JOIN users u ON u.id=a.user_id
      WHERE u.organization_id=$1 ORDER BY a.id DESC LIMIT $2`, [req.user!.organization_id, limitN])).rows; // só actividade da própria empresa
  }));

  // ---------- descoberta pública de eventos ----------
  const CATEGORIES = ['MUSICA', 'FESTIVAL', 'CONFERENCIA', 'FEIRA', 'DESPORTO', 'TEATRO', 'GASTRONOMIA', 'EMPRESARIAL', 'OUTRO'];
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  /** Pesquisa de eventos publicados e ainda por acabar: texto, categoria, data, grátis. Só mostra empresas aprovadas. */
  app.get('/public/events', h(async (req) => {
    const where = [`e.status='PUBLISHED'`, `o.status='ACTIVE'`, `e.ends_at > now()`];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };
    const q = typeof req.query.q === 'string' ? norm(req.query.q).trim().slice(0, 80) : '';
    for (const tok of q.split(/\s+/).filter(Boolean).slice(0, 6))
      add(`bp_norm(e.name||' '||COALESCE(e.description,'')||' '||COALESCE(e.location,'')||' '||o.trade_name) LIKE ?`, '%' + tok.replace(/[\\%_]/g, '\\$&') + '%');
    const cat = typeof req.query.category === 'string' ? req.query.category.toUpperCase() : '';
    if (cat) { if (!CATEGORIES.includes(cat)) throw new HttpError(400, 'categoria inválida'); add('e.category = ?', cat); }
    const when = String(req.query.when ?? '');
    if (when === 'today') where.push(`e.starts_at < date_trunc('day', now()) + interval '1 day'`);
    else if (when === 'week') where.push(`e.starts_at < now() + interval '7 days'`);
    else if (when === 'month') where.push(`e.starts_at < now() + interval '30 days'`);
    if (req.query.free === '1') where.push(`EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id=e.id) AND NOT EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id=e.id AND t.price_minor>0)`);
    const limitN = Math.min(Math.max(Number(req.query.limit) || 12, 1), 24);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const baseSql = `FROM events e JOIN event_domains d ON d.event_id=e.id JOIN organizations o ON o.id=e.organization_id WHERE ${where.join(' AND ')}`;
    const rows = (await db.query<any>(
      `SELECT e.name,e.starts_at,e.ends_at,e.location,e.category,e.latitude,e.longitude,d.subdomain,o.trade_name AS organization,e.theme,
              (SELECT min(t.price_minor) FROM ticket_types t WHERE t.event_id=e.id) AS min_price,
              (SELECT max(a.updated_at) FROM brand_assets a WHERE a.event_id=e.id AND a.kind='cover') AS cover_at,
              (SELECT count(*) FROM event_images i WHERE i.event_id=e.id)::int AS gallery
         ${baseSql} ORDER BY e.starts_at ASC LIMIT ${limitN} OFFSET ${offset}`, params)).rows;
    const total = (await db.query<any>(`SELECT count(*)::int AS n ${baseSql}`, params)).rows[0].n;
    const facets = (await db.query<any>(`SELECT e.category,count(*)::int AS n FROM events e JOIN organizations o ON o.id=e.organization_id
        WHERE e.status='PUBLISHED' AND o.status='ACTIVE' AND e.ends_at > now() AND e.category IS NOT NULL GROUP BY e.category ORDER BY n DESC`)).rows;
    return {
      total, facets,
      items: rows.map((r: any) => ({
        name: r.name, slug: r.subdomain, startsAt: r.starts_at, endsAt: r.ends_at, location: r.location, category: r.category, organization: r.organization,
        lat: r.latitude === null ? null : Number(r.latitude), lng: r.longitude === null ? null : Number(r.longitude),
        primary: r.theme?.primary ?? null, minPriceMinor: r.min_price, cover: r.cover_at ? +new Date(r.cover_at) : null,
      })),
    };
  }));

  // ---------- pesquisa de moradas para o mapa ----------
  const geoCache = new Map<string, { at: number; data: any[] }>();
  let geoLast: Promise<unknown> = Promise.resolve();
  /** Um pedido de cada vez e com 1,1 s de intervalo (política de utilização do Nominatim). */
  const geoQueue = <T,>(fn: () => Promise<T>) => { const run = geoLast.then(fn); geoLast = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100))); return run; };
  const defaultGeocoder = async (q: string) => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=mz&accept-language=pt&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': `Bilhete+/1.0 (${cfg.publicUrl ?? 'https://bilhetemais.live'})` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('geocoder ' + r.status);
    return ((await r.json()) as any[]).map((x) => ({ name: String(x.display_name).slice(0, 160), lat: Number(x.lat), lng: Number(x.lon), type: x.type }));
  };
  app.get('/public/geocode', limit(30), h(async (req) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 3) throw new HttpError(400, 'escreva pelo menos 3 letras');
    const key = norm(q), hit = geoCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
    let data: any[];
    try { data = await geoQueue(() => (cfg.geocoder ?? defaultGeocoder)(q)); } catch { throw new HttpError(503, 'a pesquisa de moradas não está disponível agora'); }
    if (geoCache.size > 500) geoCache.clear();
    geoCache.set(key, { at: Date.now(), data });
    return data;
  }));

  // ---------- M-Pesa: cobrança automática (recargas e bilhetes) ----------
  const mpesa = cfg.mpesa ?? null;
  const inflight = new Set<Promise<unknown>>();
  const chargeRef = (id: string) => 'BP' + id.replace(/-/g, '').slice(0, 16); // ≤ 20 caracteres alfanuméricos
  type Settle = { outcome: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN'; code: string; message: string; transactionId?: string };
  /** Aplica o resultado do M-Pesa. Só o SUCCESS dá saldo/bilhete, pelo caminho idempotente dos webhooks. */
  const settleCharge = async (id: string, r: Settle) => {
    const c = (await db.query<any>('SELECT * FROM mpesa_charges WHERE id=$1', [id])).rows[0];
    if (!c || c.status !== 'PENDING') return;
    if (r.outcome === 'SUCCESS') {
      await processProviderEvent('mpesa', { id: 'mpesa:' + id, type: 'payment.succeeded', kind: c.kind, ref: c.ref_id });
      await db.query(`UPDATE mpesa_charges SET status='CONFIRMED',provider_ref=$2,code=$3,updated_at=now() WHERE id=$1 AND status='PENDING'`, [id, r.transactionId ?? null, r.code]);
    } else if (r.outcome === 'FAILED') {
      await db.transaction(async (tx) => {
        await tx.query(`UPDATE mpesa_charges SET status='FAILED',code=$2,failure_reason=$3,updated_at=now() WHERE id=$1 AND status='PENDING'`, [id, r.code, r.message]);
        if (c.kind === 'TOPUP') await tx.query(`UPDATE topup_requests SET status='FAILED' WHERE id=$1 AND status='PENDING'`, [c.ref_id]);
      });
    } else await db.query(`UPDATE mpesa_charges SET code=$2,failure_reason=$3,updated_at=now() WHERE id=$1`, [id, r.code, r.message]); // por confirmar
  };
  const runCharge = async (id: string) => {
    if (!mpesa) return;
    const c = (await db.query<any>(`UPDATE mpesa_charges SET attempts=attempts+1,updated_at=now() WHERE id=$1 AND status='PENDING' RETURNING *`, [id])).rows[0];
    if (!c) return;
    const ref = chargeRef(id);
    await settleCharge(id, await mpesa.charge({ msisdn: c.msisdn, amountMinor: BigInt(c.amount_minor), reference: ref, thirdParty: ref }));
  };
  /** Regista a cobrança (na transacção do chamador) e devolve uma função que a dispara depois de confirmada a transacção. */
  const startCharge = async (tx: Tx, kind: 'TOPUP' | 'ORDER', refId: string, amountMinor: bigint, phone: unknown) => {
    if (!mpesa) throw new HttpError(409, 'o pagamento por M-Pesa não está disponível');
    const msisdn = normalizeMsisdn(String(phone ?? ''));
    if (!msisdn) throw new HttpError(400, 'número M-Pesa inválido (84 ou 85 seguido de 7 dígitos)');
    try {
      const r = await tx.query<any>('INSERT INTO mpesa_charges(kind,ref_id,msisdn,amount_minor) VALUES($1,$2,$3,$4) RETURNING id', [kind, refId, msisdn, amountMinor.toString()]);
      return r.rows[0].id as string;
    } catch (e: any) {
      if (e?.code === '23505') throw new HttpError(409, 'já há um pagamento M-Pesa por confirmar: confirme no telemóvel ou aguarde um momento');
      throw e;
    }
  };
  const fire = (id: string) => { const p = runCharge(id).catch((e) => console.error('mpesa', id, e)).finally(() => inflight.delete(p)); inflight.add(p); };

  /** Verifica no M-Pesa as cobranças que ficaram por confirmar (rede em baixo, reinício…). Expira as que nunca confirmam. */
  const reconcileMpesa = async () => {
    if (!mpesa) return 0;
    const rows = (await db.query<any>(`SELECT id,created_at FROM mpesa_charges WHERE status='PENDING' AND updated_at < now() - interval '90 seconds' ORDER BY created_at LIMIT 25`)).rows;
    for (const c of rows) {
      const ref = chargeRef(c.id);
      const q = await mpesa.query({ reference: ref, thirdParty: ref });
      if (q.outcome !== 'PENDING') { await settleCharge(c.id, q); continue; }
      if (Date.now() - +new Date(c.created_at) > 30 * 60_000) {
        // o pedido de PIN expira em minutos: passados 30 sem confirmação, liberta-se para nova tentativa
        await settleCharge(c.id, { outcome: 'FAILED', code: 'EXPIRED', message: 'Sem confirmação do M-Pesa. Se foi debitado, contacte o suporte com a referência ' + ref + '.' });
        await audit(db, undefined, 'mpesa.expired', 'mpesa_charge', c.id, { ref });
      } else await db.query('UPDATE mpesa_charges SET updated_at=now() WHERE id=$1', [c.id]);
    }
    return rows.length;
  };
  (app as any).reconcileMpesa = reconcileMpesa;
  (app as any).drain = () => Promise.all([...inflight]);
  if (mpesa && cfg.mpesaReconcileMs) setInterval(() => reconcileMpesa().catch((e) => console.error('reconcile', e)), cfg.mpesaReconcileMs).unref();

  /** Estado de uma cobrança (o identificador é aleatório e só o conhece quem a iniciou). */
  app.get('/public/charges/:id', h(async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'pagamento não encontrado');
    const c = (await db.query<any>('SELECT status,kind,failure_reason,attempts FROM mpesa_charges WHERE id=$1', [req.params.id])).rows[0];
    if (!c) throw new HttpError(404, 'pagamento não encontrado');
    return { status: c.status, kind: c.kind, reason: c.status === 'FAILED' ? c.failure_reason : null };
  }));
  /** Paga uma encomenda de bilhetes por M-Pesa. O bilhete só é emitido quando o M-Pesa confirma. */
  app.post('/public/orders/:id/pay', h(async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'encomenda não encontrada');
    const chargeId = await db.transaction(async (tx) => {
      const o = (await tx.query<any>('SELECT o.id,o.status,o.total_minor,e.ends_at FROM ticket_orders o JOIN events e ON e.id=o.event_id WHERE o.id=$1 FOR UPDATE OF o', [req.params.id])).rows[0];
      if (!o) throw new HttpError(404, 'encomenda não encontrada');
      if (o.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'esta encomenda já não está por pagar');
      if (new Date(o.ends_at) < new Date()) throw new HttpError(409, 'o evento já terminou: já não é possível pagar esta encomenda');
      return startCharge(tx, 'ORDER', o.id, BigInt(o.total_minor), req.body.phone);
    });
    fire(chargeId);
    return { chargeId, status: 'PENDING' };
  }));

  // ---------- interface web ----------
  if (cfg.webDir && existsSync(join(cfg.webDir, 'index.html'))) {
    app.use(express.static(cfg.webDir, {
      index: false,
      setHeaders: (res, file) => {
        if (/[\/]assets[\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // nome com hash: nunca muda
        else if (/\.(html|webmanifest)$|sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=600'); // logótipos e ícones: mudam pouco, mas não podem ficar dias desactualizados
      },
    }));
    app.get(/^\/(?!auth|public|webhooks|events|orgs|org\/|users|pos|tickets|merchants|refund-requests|me)/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(cfg.webDir!, 'index.html')); });
  }

  // ---------- erros ----------
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'ficheiro demasiado grande' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof WalletError) {
      const status = { INSUFFICIENT_FUNDS: 402, CREDENTIAL_INVALID: 403, WALLET_BLOCKED: 403, INVALID_AMOUNT: 400, NOT_FOUND: 404 }[err.code];
      return res.status(status).json({ error: err.code });
    }
    if (err?.code === '23505') return res.status(409).json({ error: 'registo duplicado' });
    if (['22P02', '22007', '23514', '23502', '23503'].includes(err?.code)) return res.status(400).json({ error: 'dados inválidos' });
    console.error(err);
    res.status(500).json({ error: 'erro interno' });
  });
  return app;
}
