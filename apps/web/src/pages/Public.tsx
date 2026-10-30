import { locale } from '../i18n';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { accountApi, api, appBack, dt, mt, toMinor } from '../api';
import type { Config } from '../main';
import { assetUrl, themeStyle, type Assets, type Theme } from '../theme';
import { Empty, Field, Icon, MoneyInput, Pill, Qr, LangSwitch, Skeleton, Stepper, TokenCode, useAction, useToast } from '../ui';
import { Countdown, Gallery, Programme, WhereWhen } from './Extras';
import { ReceiptModal } from './Receipt';
import { MiniMap } from '../map/Maps';
import { AuthPanel, useAccount } from './Participant';
import { useAccountName } from '../accountName';

interface Brand { organization: string; subdomain: string; theme: Theme; assets: Assets }

/** Moldura pública: aplica o tema do evento (cores, tipo de letra) a tudo o que está lá dentro. */
function Frame({ brand, hero, children, bar, size = 'wide' }: { brand?: Brand; hero?: ReactNode; children: ReactNode; bar?: ReactNode; size?: 'wide' | 'narrow' }) {
  const logo = brand ? assetUrl(brand.subdomain, 'logo', brand.assets.logo) : null;
  const acctName = useAccountName();
  return (
    <div className="themed" style={{ ...(brand ? themeStyle(brand.theme) : {}), minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' } as CSSProperties}>
      <header className="pub-bar">
        {brand && <a className="pub-back" href="/events" aria-label="Voltar" onClick={(e) => { if ((history.state as any)?.bp) { e.preventDefault(); appBack(); } }}><Icon n="arrowleft" /></a>}
        <a href="/" aria-label="Início">{logo ? <img src={logo} alt={brand!.organization} /> : brand ? <span className="pub-brand-name">{brand.organization}</span> : <img src="/logo.svg" alt="Bilhete+" />}</a>
        {brand && logo && <span className="muted small">por {brand.organization}</span>} {/* sem logótipo, o nome da empresa já aparece à esquerda: não se repete */}
        <LangSwitch /><a className="small acct-link" href="/account">{acctName ? <><Icon n="users" />{acctName}</> : 'Entrar'}</a>
      </header>
      {hero}
      <main className={'pub stack ' + size + (hero ? ' overlap' : '')}>{children}</main>
      {bar}
      <p className="muted small center" style={{ padding: '0 16px 32px' }}>Bilhetes e pagamentos por <a href="/">Bilhete+</a></p>
    </div>
  );
}

/** Cabeçalho de ecrã inteiro do evento: capa (ou gradiente da marca), título, frase e informação-chave. */
function Cover({ brand, title, children }: { brand: Brand; title: string; children?: ReactNode }) {
  const t = brand.theme;
  const cover = assetUrl(brand.subdomain, 'cover', brand.assets.cover);
  const useImg = t.heroStyle === 'image' && !!cover;
  const style: CSSProperties | undefined = useImg ? { backgroundImage: `url(${cover})` } : t.heroStyle === 'solid' ? { background: 'var(--brand)' } : undefined;
  return (
    <section className={'cover' + (useImg ? ' image' : '')} style={style}>
      <div className="in"><h1>{title}</h1>{t.tagline && <p className="tagline">{t.tagline}</p>}{children}</div>
    </section>
  );
}

export function PublicEvent({ slug, cfg }: { slug: string; cfg: Config }) {
  const [ev, setEv] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem('bp_phone') ?? ''; } catch { return ''; } });
  const { me, refresh, logout } = useAccount();
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  useEffect(() => { api('GET', `/public/events/${slug}`).then(setEv).catch(() => setErr(true)); }, [slug]);

  if (err) return <Frame><Empty icon="ticket">Evento não encontrado ou ainda não publicado.</Empty></Frame>;
  if (!ev) return <Frame><Skeleton rows={4} /></Frame>;

  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([ticketTypeId, n]) => ({ ticketTypeId, qty: n }));
  const count = items.reduce((s, i) => s + i.qty, 0);
  const total = ev.ticketTypes.reduce((s: bigint, t: any) => s + BigInt(t.price_minor) * BigInt(qty[t.id] ?? 0), 0n);
  const cta = ev.theme.ctaLabel || 'Comprar';
  const ended = new Date(ev.endsAt) < new Date(); // evento terminado: sem compras e sem calendário
  const buy = () => run(async () => {
    try {
      const o = await accountApi('POST', `/public/events/${slug}/orders`, { items });
      // bilhetes pagos: o pagamento por M-Pesa arranca já aqui (o pedido de PIN chega ao telemóvel) e a encomenda acompanha-o
      if (o.status === 'PENDING_PAYMENT') {
        try { localStorage.setItem('bp_phone', phone); } catch { /* sem armazenamento */ }
        try { await api('POST', `/public/orders/${o.orderId}/pay`, { phone }); } catch (e: any) { toast.show(e.message, true); }
      }
      location.assign('/o/' + o.orderId);
    } catch (e: any) { if (e?.code === 'LOGIN_REQUIRED') refresh(); throw e; }
  });
  const day = new Date(ev.startsAt).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <Frame brand={ev}
      hero={<Cover brand={ev} title={ev.name}>
        <div className="chips-row"><span className="chip"><Icon n="calendar" />{day}</span>{ev.location && <span className="chip"><Icon n="pin" />{ev.location}</span>}</div>
        <Countdown startsAt={ev.startsAt} endsAt={ev.endsAt} />
      </Cover>}
      bar={!ended && count > 0 && !checkout && (
        <div className="sticky-bar mobile-only"><div className="in"><div><b>{count} bilhete{count > 1 ? 's' : ''}</b><div className="muted small">{mt(total)}</div></div><button className="big" onClick={() => setCheckout(true)}>{cta}<Icon n="arrowright" /></button></div></div>
      )}>
      <div className="pub-layout">
        <aside className="pub-aside stack">
          <section className="stub" id="bilhetes">
            <div className="top">
              <div className="between"><h2>{ev.settings.ticketCategories === 'single' ? 'Entrada' : 'Bilhetes'}</h2><span className="eyebrow">Em meticais</span></div>
              {ended && <p className="muted" style={{ marginTop: 10 }}>O evento já terminou. Já não é possível comprar bilhetes.</p>}
              {!ended && !ev.settings.onlineSalesEnabled && <p className="muted" style={{ marginTop: 10 }}>A venda online está encerrada. Adquira o seu bilhete nos balcões do evento.</p>}
              {ev.ticketTypes.length === 0 && <Empty icon="ticket">Os bilhetes ainda não estão à venda.</Empty>}
              {ev.ticketTypes.map((t: any) => (
                <div key={t.id} className="ticket-row">
                  <div><b>{t.name}</b> {ev.settings.ticketCategories !== 'single' && t.kind !== 'GENERAL' && <span className="pill">{t.kind}</span>}
                    <div className="muted small">{t.available > 0 ? (t.available <= 10 ? `Restam ${t.available}` : 'Disponível') : 'Esgotado'}</div></div>
                  <div className="inline" style={{ gap: 12 }}>
                    <span className="price">{BigInt(t.price_minor) === 0n ? 'Grátis' : mt(t.price_minor)}</span>
                    {!ended && t.available > 0 && ev.settings.onlineSalesEnabled ? <Stepper label={`Quantidade ${t.name}`} value={qty[t.id] ?? 0} max={Math.max(0, Math.min(ev.settings.maxTicketsPerOrder - (count - (qty[t.id] ?? 0)), t.available))} onChange={(n) => setQty({ ...qty, [t.id]: n })} /> : <Pill s="CLOSED" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="perf" />
            <div className="bottom stack-sm">
              <div className="between"><span className="muted">{count ? `${count} bilhete${count > 1 ? 's' : ''}` : 'Escolha os bilhetes'}</span><b className="price" style={{ fontSize: '1.3rem' }}>{mt(total)}</b></div>
              {!ended && !checkout && <button className="big wide desktop-only" disabled={!count} onClick={() => setCheckout(true)}>{cta}<Icon n="arrowright" /></button>}
            </div>
          </section>
          {!ended && checkout && (
            me === null ? <><AuthPanel onDone={refresh} /><button className="ghost wide" onClick={() => setCheckout(false)}>Voltar</button></> : me === undefined ? <Skeleton rows={2} /> : (
            <section className="card stack">
              <h2>Confirmar compra</h2>
              <p>A comprar como <b>{me.name}</b><br /><span className="muted small">{me.email}</span></p>
              <p className="muted small">Os bilhetes ficam na sua conta, em «Os meus bilhetes».</p>
              {total > 0n && <>
                <div className="mpesa-badge"><img src="/mpesa.svg" alt="M-Pesa" height="28" /><span className="muted small">Pagamento seguro por M-Pesa</span></div>
                <Field label="Número M-Pesa (Vodacom)" hint="Vai receber um pedido de PIN no telemóvel."><input type="tel" inputMode="tel" autoComplete="tel-national" placeholder="84 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              </>}
              <button className="big wide" disabled={busy || count === 0 || (total > 0n && (!cfg.mpesa || phone.replace(/\D/g, '').length < 9))} onClick={buy}>{busy ? 'A processar…' : total === 0n ? 'Obter bilhetes' : `Pagar ${mt(total)} com M-Pesa`}</button>
              {total > 0n && !cfg.mpesa && <p className="muted small">O pagamento por M-Pesa não está disponível de momento.</p>}
              <button className="ghost wide" onClick={() => setCheckout(false)}>Voltar</button>
              <button type="button" className="ghost sm" onClick={logout}>Não é {me.name.split(' ')[0]}? Sair</button>
            </section>)
          )}
        </aside>
        <div className="pub-main stack">
          {ev.description && <section className="card"><h2 style={{ marginBottom: 8 }}>Sobre o evento</h2><p style={{ whiteSpace: 'pre-line' }}>{ev.description}</p></section>}
          <WhereWhen ev={{ ...ev, tagline: ev.theme.tagline }} />
          {ev.lat !== null && ev.lat !== undefined && <MiniMap lat={ev.lat} lng={ev.lng} name={ev.name} address={ev.location} />}
          <Gallery slug={slug} items={ev.gallery} />
          <Programme items={ev.programme} eventName={ev.name} location={ev.location} ended={ended} />
        </div>
      </div>
      {toast.node}
    </Frame>
  );
}

/** Pagamento por M-Pesa: pede o número, dispara a cobrança e acompanha-a até o M-Pesa confirmar ou recusar. */
function MpesaPay({ label, start, onDone, resume }: { label: string; start: (phone: string) => Promise<{ chargeId: string }>; onDone: () => void; resume?: string | null }) {
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem('bp_phone') ?? ''; } catch { return ''; } });
  const [charge, setCharge] = useState<string | null>(resume ?? null); // retoma um pagamento já iniciado (ex.: vindo do ecrã de compra)
  const [state, setState] = useState<{ status: string; reason?: string | null } | null>(null);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  useEffect(() => {
    if (!charge) return;
    let stop = false;
    const tick = async () => {
      try {
        const c = await api('GET', `/public/charges/${charge}`);
        if (stop) return;
        setState(c);
        if (c.status !== 'PENDING') { setCharge(null); if (c.status === 'CONFIRMED') onDone(); }
      } catch { /* tenta outra vez */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [charge, onDone]);
  const waiting = !!charge;
  return (
    <div className="stack">
      <Field label="Número M-Pesa (Vodacom)"><input type="tel" inputMode="tel" autoComplete="tel-national" placeholder="84 123 4567" value={phone} disabled={waiting} onChange={(e) => setPhone(e.target.value)} /></Field>
      <button className="big wide" disabled={busy || waiting || phone.replace(/\D/g, '').length < 9} onClick={() => run(async () => {
        try { localStorage.setItem('bp_phone', phone); } catch { /* sem armazenamento */ }
        setState(null);
        const r = await start(phone);
        setCharge(r.chargeId);
      })}>{waiting ? 'A aguardar confirmação…' : <><img src="/mpesa.svg" alt="" height="22" style={{ borderRadius: 4, marginRight: 10 }} />{label}</>}</button>
      {waiting && <p className="scan-note" role="status">Verifique o telemóvel: vai receber um pedido do M-Pesa. Introduza o PIN para confirmar.</p>}
      {state?.status === 'FAILED' && <p className="scan-note" role="alert" style={{ borderColor: 'var(--bad)' }}>{state.reason || 'O pagamento não foi concluído.'}</p>}
      {state?.status === 'CONFIRMED' && <p className="scan-note" role="status">Pagamento confirmado.</p>}
      {toast.node}
    </div>
  );
}

export function Order({ id, cfg }: { id: string; cfg: Config }) {
  const [o, setO] = useState<any>(null);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const load = useCallback(() => api('GET', `/public/orders/${id}`).then(setO).catch(() => setO(false)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (o && o.status === 'PENDING_PAYMENT') { const t = setInterval(load, 4000); return () => clearInterval(t); } }, [o, load]);
  if (o === false) return <Frame size="narrow"><Empty icon="alert">Encomenda não encontrada.</Empty></Frame>;
  if (!o) return <Frame size="narrow"><Skeleton /></Frame>;
  const paid = o.status === 'PAID';
  return (
    <Frame size="narrow">
      <div className="card stack">
        <div className="between"><h2>A sua encomenda</h2><Pill s={o.status} /></div>
        <div className="between"><span className="muted">Total</span><b className="price" style={{ fontSize: '1.4rem' }}>{mt(o.total_minor)}</b></div>
        {o.status === 'PENDING_PAYMENT' && <>
          <p className="muted">O bilhete só é emitido depois de o prestador de pagamento confirmar o pagamento. Esta página actualiza sozinha.</p>
          {cfg.mpesa && <div className="mpesa-badge"><img src="/mpesa.svg" alt="M-Pesa" height="28" /><span className="muted small">Pagamento seguro por M-Pesa</span></div>}
          {cfg.mpesa && <MpesaPay resume={o.chargeId} label={`Pagar ${mt(o.total_minor)} com M-Pesa`} start={(phone) => api('POST', `/public/orders/${id}/pay`, { phone })} onDone={load} />}
        </>}
      </div>
      {paid && o.emailedTo && <p className="scan-note" role="status"><Icon n="check" /> Enviámos os bilhetes para {o.emailedTo}.</p>}
      {paid && o.tickets.filter((t: any) => t.token).map((t: any, i: number) => (
        <section key={t.id} className="stub">
          <div className="top"><span className="eyebrow">Bilhete {i + 1}</span><h3 style={{ marginTop: 6 }}>Apresente à entrada</h3></div>
          <div className="perf" />
          <div className="bottom stack center"><Qr value={t.token} label={`QR do bilhete ${i + 1}`} /><TokenCode value={t.token} shortCode={t.shortCode} />
            <a className="btn wide" href={`/t/${t.token}`}><Icon n="wallet" />Abrir bilhete e carteira</a>
            <p className="muted small">Guarde este link: dá acesso ao bilhete e ao saldo.</p></div>
        </section>
      ))}
      {toast.node}
    </Frame>
  );
}

const KIND: Record<string, [string, string]> = { TOPUP: ['Carregamento', 'arrowdown'], PAYMENT: ['Pagamento', 'cart'], REFUND: ['Devolução', 'refund'], CASHOUT: ['Levantamento', 'arrowup'], ADJUSTMENT: ['Ajuste', 'cash'] };

/** Participante: passe com QR e saldo, carregamento e histórico. */
export function Wallet({ token, cfg }: { token: string; cfg: Config }) {
  const [w, setW] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const cacheKey = 'bp_wallet_' + token.slice(0, 12);
  const load = useCallback(() => api('GET', `/public/tickets/${token}`).then((d) => {
    setW(d); setOfflineAt(null);
    try { localStorage.setItem(cacheKey, JSON.stringify({ d, at: new Date().toISOString() })); } catch { /* sem armazenamento */ }
  }).catch((e) => {
    // sem ligação: mostra o último saldo conhecido (o QR continua a funcionar)
    if (e?.status === undefined) {
      try { const c = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); if (c) { setW(c.d); setOfflineAt(c.at); return; } } catch { /* cache inválida */ }
    }
    setW((cur: any) => cur ?? false);
  }), [token, cacheKey]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const openReceipt = (id: string) => run(async () => setReceipt(await api('GET', `/public/tickets/${token}/receipts/${id}`)));
  if (w === false) return <Frame><Empty icon="ticket">Bilhete não encontrado.</Empty></Frame>;
  if (!w) return <Frame><Skeleton rows={4} /></Frame>;

  return (
    <Frame brand={w}>
      {offlineAt && <div className="scan-note" role="status" style={{ marginBottom: 12 }}>Sem ligação. A mostrar o último saldo conhecido ({dt(offlineAt)}). O QR continua válido.</div>}
      <div className="pub-layout wallet-layout">
        <div className="stack">
          <section className="pass">
            <div className="head">
              <div className="between"><span style={{ fontWeight: 600, opacity: .92 }}>{w.event}</span><Pill s={w.ticketStatus} /></div>
              <p style={{ opacity: .85, marginTop: 22, fontSize: '.9rem' }}>Saldo disponível</p>
              <div className="balance">{mt(w.balanceMinor)}</div>
            </div>
            <div className="perf" />
            <div className="body stack center">
              <Qr value={token} label="QR de entrada e pagamento" /><TokenCode value={token} shortCode={w.shortCode} />
              <p className="muted small">Mostre à porta para entrar e ao comerciante para pagar. O QR não contém o seu saldo.</p>
            </div>
          </section>
        </div>
        <div className="stack">
          {w.settings.walletEnabled && <section className="card stack">
            <h2>Carregar saldo</h2>
            <div className="chips" role="group" aria-label="Valores sugeridos">{[100, 200, 500, 1000].map((v) => <button key={v} type="button" className={amount === String(v) ? 'on' : ''} aria-pressed={amount === String(v)} disabled={busy} onClick={() => setAmount(String(v))}>{v} MT</button>)}</div>
            <Field label="Outro valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
            {cfg.mpesa && <div className="mpesa-badge"><img src="/mpesa.svg" alt="M-Pesa" height="28" /><span className="muted small">Pagamento seguro por M-Pesa</span></div>}
            {cfg.mpesa && toMinor(amount) && <MpesaPay label={`Confirmar carregamento de ${amount} MT`} start={(phone) => api('POST', `/public/tickets/${token}/topup`, { provider: 'mpesa', amountMinor: toMinor(amount), phone })} onDone={() => { setAmount(''); load(); }} />}
            {cfg.mpesa && !toMinor(amount) && <p className="muted small">Escolha ou escreva um valor.</p>}
            {!cfg.mpesa && <p className="muted small">Carregamentos indisponíveis de momento.</p>}
          </section>}
          <section className="card">
            <h2 style={{ marginBottom: 6 }}>Movimentos</h2>
            {w.movements.length === 0 ? <Empty icon="wallet">Ainda sem movimentos.</Empty> : w.movements.map((m: any, i: number) => {
              const [label, icon] = KIND[m.type] ?? [m.type, 'cash'];
              const pos = BigInt(m.amount_minor) > 0n;
              return <div className="mv" key={i} onClick={() => m.id && openReceipt(m.id)} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && m.id && openReceipt(m.id)}><span className="inline"><span className="ic"><Icon n={icon} /></span><span>{label}<br /><small className="muted">{dt(m.created_at)}</small></span></span><span className={pos ? 'pos' : 'neg'}>{pos ? '+' : ''}{mt(m.amount_minor)}</span></div>;
            })}
          </section>
          <RefundRequest token={token} balance={w.balanceMinor} toast={toast.show} />
        </div>
      </div>
      {receipt && <ReceiptModal r={receipt} onClose={() => setReceipt(null)} />}
      {toast.node}
    </Frame>
  );
}

function RefundRequest({ token, balance, toast }: { token: string; balance: string; toast: (m: string, e?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const { busy, run } = useAction(toast);
  if (BigInt(balance) === 0n) return null;
  if (!open) return <button className="ghost wide" onClick={() => setOpen(true)}>Pedir reembolso do saldo</button>;
  return (
    <section className="card stack">
      <h3>Pedir reembolso do saldo</h3>
      <p className="muted small">Só é possível se o organizador do evento o permitir.</p>
      <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
      <button disabled={busy || !amount} onClick={() => run(async () => { const m = toMinor(amount); if (!m) throw new Error('Valor inválido'); await api('POST', `/public/tickets/${token}/refund-request`, { amountMinor: m }); setAmount(''); setOpen(false); }, 'Pedido enviado')}>Enviar pedido</button>
    </section>
  );
}

const STEPS = ['Empresa', 'Responsável', 'Confirmar'];

/** O registo público está desligado: as empresas são criadas pela administração. */
export function RegistrationClosed() {
  return <Frame size="narrow"><div className="card stack center" style={{ padding: 36 }}><h1>Registo fechado</h1><p className="muted">O registo de empresas está fechado de momento. Contacte a equipa Bilhete+.</p><a className="btn big wide" href="/events">Ver eventos</a></div></Frame>;
}

/** Registo self-service em três passos (aprovação pela plataforma antes de criar eventos). */
export { Register } from './RegisterCompany';
