import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { accountApi, accountToken, api, dt, mt, toMinor } from '../api';
import type { Config } from '../main';
import { assetUrl, themeStyle, type Assets, type Theme } from '../theme';
import { Empty, Field, Icon, MoneyInput, Pill, Qr, Skeleton, Stepper, TokenCode, useAction, useToast } from '../ui';
import { Countdown, Gallery, Programme, WhereWhen } from './Extras';
import { ReceiptModal } from './Receipt';
import { MiniMap } from '../map/Maps';
import { AuthPanel, useAccount } from './Participant';

interface Brand { organization: string; subdomain: string; theme: Theme; assets: Assets }

/** Moldura pública: aplica o tema do evento (cores, tipo de letra) a tudo o que está lá dentro. */
function Frame({ brand, hero, children, bar, size = 'wide' }: { brand?: Brand; hero?: ReactNode; children: ReactNode; bar?: ReactNode; size?: 'wide' | 'narrow' }) {
  const logo = brand ? assetUrl(brand.subdomain, 'logo', brand.assets.logo) : null;
  return (
    <div className="themed" style={{ ...(brand ? themeStyle(brand.theme) : {}), minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' } as CSSProperties}>
      <header className="pub-bar">
        <a href="/" aria-label="Início">{logo ? <img src={logo} alt={brand!.organization} /> : brand ? <span>{brand.organization}</span> : <img src="/logo.svg" alt="Bilhete+" />}</a>
        {brand && <span className="muted small">por {brand.organization}</span>}
        <a className="small" href="/conta" style={{ marginLeft: 'auto' }}>{accountToken() ? 'A minha conta' : 'Entrar'}</a>
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
  const { me, refresh, logout } = useAccount();
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  useEffect(() => { api('GET', `/public/events/${slug}`).then(setEv).catch(() => setErr(true)); }, [slug]);
  void cfg;

  if (err) return <Frame><Empty icon="ticket">Evento não encontrado ou ainda não publicado.</Empty></Frame>;
  if (!ev) return <Frame><Skeleton rows={4} /></Frame>;

  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([ticketTypeId, n]) => ({ ticketTypeId, qty: n }));
  const count = items.reduce((s, i) => s + i.qty, 0);
  const total = ev.ticketTypes.reduce((s: bigint, t: any) => s + BigInt(t.price_minor) * BigInt(qty[t.id] ?? 0), 0n);
  const cta = ev.theme.ctaLabel || 'Comprar';
  const buy = () => run(async () => {
    try { const o = await accountApi('POST', `/public/events/${slug}/orders`, { items }); location.assign('/o/' + o.orderId); }
    catch (e: any) { if (e?.code === 'LOGIN_REQUIRED') refresh(); throw e; }
  });
  const day = new Date(ev.startsAt).toLocaleDateString('pt-MZ', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <Frame brand={ev}
      hero={<Cover brand={ev} title={ev.name}>
        <div className="chips-row"><span className="chip"><Icon n="calendar" />{day}</span>{ev.location && <span className="chip"><Icon n="pin" />{ev.location}</span>}</div>
        <Countdown startsAt={ev.startsAt} endsAt={ev.endsAt} />
      </Cover>}
      bar={count > 0 && !checkout && (
        <div className="sticky-bar mobile-only"><div className="in"><div><b>{count} bilhete{count > 1 ? 's' : ''}</b><div className="muted small">{mt(total)}</div></div><button className="big" onClick={() => setCheckout(true)}>{cta}<Icon n="arrowup" /></button></div></div>
      )}>
      <div className="pub-layout">
        <aside className="pub-aside stack">
          <section className="stub" id="bilhetes">
            <div className="top">
              <div className="between"><h2>{ev.settings.ticketCategories === 'single' ? 'Entrada' : 'Bilhetes'}</h2><span className="eyebrow">Em meticais</span></div>
              {!ev.settings.onlineSalesEnabled && <p className="muted" style={{ marginTop: 10 }}>A venda online está encerrada. Adquira o seu bilhete nos balcões do evento.</p>}
              {ev.ticketTypes.length === 0 && <Empty icon="ticket">Os bilhetes ainda não estão à venda.</Empty>}
              {ev.ticketTypes.map((t: any) => (
                <div key={t.id} className="ticket-row">
                  <div><b>{t.name}</b> {ev.settings.ticketCategories !== 'single' && t.kind !== 'GENERAL' && <span className="pill">{t.kind}</span>}
                    <div className="muted small">{t.available > 0 ? (t.available <= 10 ? `Restam ${t.available}` : 'Disponível') : 'Esgotado'}</div></div>
                  <div className="inline" style={{ gap: 12 }}>
                    <span className="price">{BigInt(t.price_minor) === 0n ? 'Grátis' : mt(t.price_minor)}</span>
                    {t.available > 0 && ev.settings.onlineSalesEnabled ? <Stepper label={`Quantidade ${t.name}`} value={qty[t.id] ?? 0} max={Math.max(0, Math.min(ev.settings.maxTicketsPerOrder - (count - (qty[t.id] ?? 0)), t.available))} onChange={(n) => setQty({ ...qty, [t.id]: n })} /> : <Pill s="CLOSED" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="perf" />
            <div className="bottom stack-sm">
              <div className="between"><span className="muted">{count ? `${count} bilhete${count > 1 ? 's' : ''}` : 'Escolha os bilhetes'}</span><b className="price" style={{ fontSize: '1.3rem' }}>{mt(total)}</b></div>
              {!checkout && <button className="big wide desktop-only" disabled={!count} onClick={() => setCheckout(true)}>{cta}<Icon n="arrowup" /></button>}
            </div>
          </section>
          {checkout && (
            me === null ? <><AuthPanel onDone={refresh} /><button className="ghost wide" onClick={() => setCheckout(false)}>Voltar</button></> : me === undefined ? <Skeleton rows={2} /> : (
            <section className="card stack">
              <h2>Confirmar compra</h2>
              <p>A comprar como <b>{me.name}</b><br /><span className="muted small">{me.email}</span></p>
              <p className="muted small">Os bilhetes ficam na sua conta, em «Os meus bilhetes».</p>
              <button className="big wide" disabled={busy || count === 0} onClick={buy}>{busy ? 'A processar…' : total === 0n ? 'Obter bilhetes' : `Pagar ${mt(total)}`}</button>
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
          <Programme items={ev.programme} eventName={ev.name} location={ev.location} />
        </div>
      </div>
      {toast.node}
    </Frame>
  );
}

/** Pagamento por M-Pesa: pede o número, dispara a cobrança e acompanha-a até o M-Pesa confirmar ou recusar. */
function MpesaPay({ label, start, onDone }: { label: string; start: (phone: string) => Promise<{ chargeId: string }>; onDone: () => void }) {
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem('bp_phone') ?? ''; } catch { return ''; } });
  const [charge, setCharge] = useState<string | null>(null);
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

/** Depois de pago, permite receber os links dos bilhetes por e-mail. */
function EmailTickets({ id }: { id: string }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  return (
    <section className="card stack">
      <h2>Receber por e-mail</h2>
      {done ? <p role="status">{done}</p> : <>
        <Field label="O seu e-mail"><input type="email" inputMode="email" autoComplete="email" placeholder="nome@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <button disabled={busy || !email.includes('@')} onClick={() => run(async () => {
          const r = await api('POST', `/public/orders/${id}/email`, { email });
          setDone(r.delivered ? `Enviámos os bilhetes para ${email}.` : 'O envio de e-mail ainda não está ativo. Guarde o link desta página ou o QR acima.');
        })}>Enviar bilhetes por e-mail</button>
      </>}
      {toast.node}
    </section>
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
          {cfg.mpesa && <MpesaPay label={`Pagar ${mt(o.total_minor)} com M-Pesa`} start={(phone) => api('POST', `/public/orders/${id}/pay`, { phone })} onDone={load} />}
        </>}
      </div>
      {paid && <EmailTickets id={id} />}
      {paid && o.tickets.filter((t: any) => t.token).map((t: any, i: number) => (
        <section key={t.id} className="stub">
          <div className="top"><span className="eyebrow">Bilhete {i + 1}</span><h3 style={{ marginTop: 6 }}>Apresente à entrada</h3></div>
          <div className="perf" />
          <div className="bottom stack center"><Qr value={t.token} label={`QR do bilhete ${i + 1}`} /><TokenCode value={t.token} />
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
              <Qr value={token} label="QR de entrada e pagamento" /><TokenCode value={token} />
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
  return <Frame size="narrow"><div className="card stack center" style={{ padding: 36 }}><h1>Registo fechado</h1><p className="muted">As empresas são criadas pela equipa Bilhete+. Se já tem conta, entre na área da equipa.</p><a className="btn big wide" href="/staff">Entrada da equipa</a></div></Frame>;
}

/** Registo self-service em três passos (aprovação pela plataforma antes de criar eventos). */
export function Register() {
  const [f, setF] = useState({ legalName: '', tradeName: '', nuit: '', address: '', phone: '', contactName: '', email: '', password: '', acceptTerms: false });
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ok0 = !!f.legalName.trim() && !!f.tradeName.trim() && /^\d{9}$/.test(f.nuit);
  const ok1 = !!f.contactName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 8;
  const ready = ok0 && ok1 && f.acceptTerms;

  if (done) return (
    <Frame size="narrow"><div className="card stack center" style={{ padding: 36 }}>
      <span className="pill ok" style={{ justifySelf: 'center', margin: '0 auto' }}>Registo recebido</span>
      <h1>Falta pouco.</h1>
      <p className="muted">A sua empresa está <b>a aguardar aprovação</b>. Entretanto pode entrar, completar o perfil, anexar documentos e escolher a marca. Só depois da aprovação poderá criar eventos.</p>
      <a className="btn big wide" href="/staff">Entrar</a></div></Frame>
  );
  return (
    <Frame size="narrow">
      <div className="card stack" style={{ padding: 'clamp(20px, 4vw, 36px)' }}>
        <div><span className="eyebrow">Nova empresa</span><h1 style={{ marginTop: 8 }}>Registar a minha empresa</h1><p className="muted" style={{ marginTop: 6 }}>A equipa Bilhete+ valida os dados antes de activar a criação de eventos.</p></div>
        <ol className="steps" aria-label="Passos">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Icon n="check" /> : i + 1}</span>{s}</li>)}</ol>

        {step === 0 && <div className="stack">
          <div className="field-row">
            <Field label="Denominação legal"><input value={f.legalName} onChange={set('legalName')} autoComplete="organization" autoFocus /></Field>
            <Field label="Nome comercial"><input value={f.tradeName} onChange={set('tradeName')} /></Field>
          </div>
          <div className="field-row">
            <Field label="NUIT" hint="9 dígitos."><input inputMode="numeric" maxLength={9} value={f.nuit} onChange={set('nuit')} /></Field>
            <Field label="Telefone" hint="Opcional."><input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></Field>
          </div>
          <Field label="Endereço" hint="Opcional."><input value={f.address} onChange={set('address')} autoComplete="street-address" /></Field>
          <button className="big wide" disabled={!ok0} onClick={() => setStep(1)}>Continuar<Icon n="arrowup" /></button>
        </div>}

        {step === 1 && <div className="stack">
          <Field label="Nome do responsável"><input value={f.contactName} onChange={set('contactName')} autoComplete="name" autoFocus /></Field>
          <Field label="E-mail" hint="Será o seu utilizador de acesso."><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
          <Field label="Palavra-passe" hint="Pelo menos 8 caracteres."><div className="pw"><input type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} autoComplete="new-password" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'}>{show ? 'Esconder' : 'Mostrar'}</button></div></Field>
          <div className="inline"><button className="ghost big" onClick={() => setStep(0)}>Voltar</button><button className="big" style={{ flex: 1 }} disabled={!ok1} onClick={() => setStep(2)}>Continuar<Icon n="arrowup" /></button></div>
        </div>}

        {step === 2 && <div className="stack">
          <div className="card flat"><table><tbody>
            {([['Empresa', f.tradeName], ['Denominação', f.legalName], ['NUIT', f.nuit], ['Responsável', f.contactName], ['E-mail', f.email]] as const).map(([k, v]) => <tr key={k}><th style={{ width: '38%' }}>{k}</th><td>{v}</td></tr>)}
          </tbody></table></div>
          <label className="inline" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} /><span className="small">Declaro que os dados são verdadeiros e aceito os termos de utilização da plataforma.</span></label>
          <div className="inline"><button className="ghost big" onClick={() => setStep(1)}>Voltar</button>
            <button className="big" style={{ flex: 1 }} disabled={busy || !ready} onClick={() => run(async () => { await api('POST', '/public/register', f); setDone(true); })}>{busy ? 'A enviar…' : 'Registar empresa'}</button></div>
        </div>}
        <p className="muted small center">Já tem conta? <a href="/staff">Entrar</a></p>
      </div>
      {toast.node}
    </Frame>
  );
}
