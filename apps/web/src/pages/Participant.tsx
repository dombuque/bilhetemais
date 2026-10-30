import { useCallback, useEffect, useRef, useState } from 'react';
import { accountApi, accountToken, dt, goTo, mainUrl, mt, onEventHost, setAccountToken } from '../api';
import { Empty, Icon, LangSwitch, Pill, Skeleton, useAction, useToast } from '../ui';
import { AppTabs } from '../AppTabs';
import { InstallButton, isStandalone, useInstall } from '../install';
import { disablePush, enablePush, pushActive, pushPermission, pushSupported, syncPush } from '../push';
import './participant.css';

export interface Me { name: string; email: string | null; phone: string | null; hasPassword?: boolean; newsletter?: boolean }

/** Conta de participante em sessão (ou null). */
export function useAccount() {
  const [me, setMe] = useState<Me | null | undefined>(accountToken() ? undefined : null);
  const refresh = useCallback(() => {
    if (!accountToken()) { setMe(null); return; }
    accountApi('GET', '/account/me').then((r) => setMe(r.account)).catch(() => { setAccountToken(null); setMe(null); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { me, refresh, logout: async () => { try { await accountApi('POST', '/account/logout', {}); } catch { /* já expirou */ } setAccountToken(null); setMe(null); } };
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'A entrada com Google foi cancelada.', google_state: 'A entrada com Google expirou. Tente outra vez.',
  google_failed: 'Não foi possível entrar com Google. Tente outra vez.', google_unverified: 'O e-mail da conta Google não está verificado.', google_off: 'A entrada com Google não está disponível.',
};

/** Formas de entrar disponíveis neste servidor (Google, telemóvel). */
function useAuthConfig() {
  const [c, setC] = useState<{ google: boolean; phone: boolean } | null>(null);
  useEffect(() => { fetch('/public/config').then((r) => r.json()).then((x) => setC({ google: !!x.google, phone: !!x.phone })).catch(() => setC({ google: false, phone: false })); }, []);
  return c;
}
const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
);

/** Entrada por telemóvel: número + nome, recebe um código por SMS e entra. Sem e-mail nem palavra-passe. */
function PhoneEntry({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [code, setCode] = useState('');
  const [needName, setNeedName] = useState(false);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const codeRef = useRef<HTMLInputElement>(null);
  const send = () => run(async () => { await accountApi('POST', '/account/phone/start', { phone }); setStep('code'); setCode(''); setTimeout(() => codeRef.current?.focus(), 50); });
  const verify = (c: string) => run(async () => {
    try { const r = await accountApi('POST', '/account/phone/verify', { phone, code: c, name: name || undefined }); setAccountToken(r.token); onDone(); }
    catch (e: any) { if (/nome/.test(e?.message ?? '')) setNeedName(true); throw e; }
  });
  return (
    <div className="pp-form">
      {step === 'number' ? <>
        <label className="pp-field"><span>O seu telemóvel</span><input type="tel" inputMode="tel" autoComplete="tel" placeholder="84 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></label>
        <label className="pp-field"><span>O seu nome</span><input value={name} autoComplete="name" placeholder="Como se chama?" onChange={(e) => setName(e.target.value)} /><small>Para criar a conta. Se já a tem, pode deixar em branco.</small></label>
        <button className="pp-btn" disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={send}>{busy ? 'A enviar…' : 'Receber código por SMS'}</button>
      </> : <>
        <p className="pp-sub">Enviámos um código de 6 dígitos para <b>{phone}</b>.</p>
        <label className="pp-field"><span>Código</span><input ref={codeRef} className="pp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6 && (!needName || name.trim().length >= 2)) verify(v); }} /></label>
        {needName && <label className="pp-field"><span>O seu nome</span><input value={name} autoComplete="name" placeholder="Como se chama?" onChange={(e) => setName(e.target.value)} autoFocus /><small>É a primeira vez neste número: diga-nos o seu nome.</small></label>}
        <button className="pp-btn" disabled={busy || code.length !== 6 || (needName && name.trim().length < 2)} onClick={() => verify(code)}>{busy ? 'A confirmar…' : 'Entrar'}</button>
        <div className="pp-actions2"><button type="button" className="pp-link" onClick={() => setStep('number')}>Alterar número</button><button type="button" className="pp-link" disabled={busy} onClick={send}>Reenviar código</button></div>
      </>}
      {toast.node}
    </div>
  );
}

/** Google dentro da app instalada: o Google abre no navegador do telemóvel, que não partilha a sessão com a app. A app fica a perguntar ao servidor até a entrada terminar. */
function GoogleInApp({ next, onDone }: { next: string; onDone: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; setWaiting(false); };
  useEffect(() => stop, []);
  const go = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const rid = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.open(`${mainUrl()}/account/google/start?next=${encodeURIComponent(next)}&rid=${rid}`, '_blank');
    setWaiting(true);
    const started = Date.now();
    const poll = async () => {
      if (Date.now() - started > 5 * 60_000) return stop();
      try { const r = await fetch(`/account/google/poll?rid=${rid}`).then((x) => x.json()); if (r.done) { stop(); setAccountToken(r.token); onDone(); } } catch { /* tenta outra vez */ }
    };
    timer.current = window.setInterval(() => { if (Date.now() - started > 5 * 60_000) return stop(); poll(); }, 1500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer.current) poll(); }); // ao voltar à app, verifica logo
  };
  return waiting
    ? <div className="pp-wait"><p className="pp-sub">A aguardar o Google… Entre na janela que abriu e volte à app.</p><button type="button" className="pp-link" onClick={stop}>Cancelar</button></div>
    : <button type="button" className="pp-google" onClick={go}><GoogleG />Continuar com o Google</button>;
}

/** Página aberta no navegador depois de o Google terminar uma entrada iniciada na app. */
export function AccountDone() {
  // a sessão já foi entregue à app: esta janela fecha-se sozinha; se o navegador não deixar, fica só um aviso mínimo
  useEffect(() => { const t = setTimeout(() => window.close(), 150); return () => clearTimeout(t); }, []);
  return (
    <div className="pp done-min"><p>✓ Sessão iniciada. Volte à app Bilhete+.</p><button type="button" className="pp-btn" onClick={() => window.close()}>Fechar</button></div>
  );
}

/** Entrar ou criar conta: Google ou código por SMS. Chama `onDone` quando a sessão fica iniciada. */
export function AuthPanel({ onDone, intro, next }: { onDone: () => void; intro?: string; next?: string }) {
  const cfg = useAuthConfig();
  const back = next ?? location.pathname + location.search;
  const none = cfg && !cfg.google && !cfg.phone;
  return (
    <section className="pp-card pp-auth" aria-label="Entrar ou criar conta">
      <span className="pp-label">[BP/ Entrar]</span>
      <h2 className="pp-h">Entrar</h2>
      <p className="pp-sub">{intro ?? 'Para comprar bilhetes precisa de uma conta. É rápido: entre com o Google ou com o seu telemóvel.'}</p>
      {!cfg ? <Skeleton rows={2} /> : <>
        {cfg.google && (isStandalone()
          ? <GoogleInApp next={onEventHost() ? location.href : back} onDone={onDone} />
          : <a className="pp-google" href={`${mainUrl()}/account/google/start?next=${encodeURIComponent(onEventHost() ? location.href : back)}`}><GoogleG />Continuar com o Google</a>)}
        {cfg.google && cfg.phone && <div className="pp-or"><span>ou</span></div>}
        {cfg.phone && <PhoneEntry onDone={onDone} />}
        {none && <p className="pp-alert" role="alert">A entrada de contas não está disponível neste momento.</p>}
      </>}
    </section>
  );
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

/** Linha de uma lista de definições (como nas apps nativas): abre/fecha o seu conteúdo. */
function Row({ icon, title, hint, open, onToggle, danger, children }: { icon: string; title: string; hint?: string; open: boolean; onToggle: () => void; danger?: boolean; children?: React.ReactNode }) {
  return (
    <section className={'pp-row-item' + (open ? ' open' : '') + (danger ? ' danger' : '')}>
      <button type="button" className="pp-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="pp-row-ic"><Icon n={icon} /></span>
        <span className="pp-row-tx"><b>{title}</b>{hint && <small>{hint}</small>}</span>
        <Icon n="arrowright" />
      </button>
      {open && <div className="pp-row-body">{children}</div>}
    </section>
  );
}

const MV: Record<string, string> = { TOPUP: 'Carregamento', PAYMENT: 'Compra', REFUND: 'Devolução', CASHOUT: 'Levantamento', ADJUSTMENT: 'Ajuste' };
const TICKET_STATE: Record<string, string> = { ISSUED: 'Válido', USED: 'Já utilizado', BLOCKED: 'Bloqueado', REVOKED: 'Cancelado', PENDING: 'A aguardar pagamento' };

/** Um bilhete: tipo, estado, saldo da carteira, o que já gastou e o detalhe dos consumos. */
function TicketCard({ t, n, total, shared, reload }: { t: any; n: number; total: number; shared?: boolean; reload: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(t.nickname ?? '');
  const [link, setLink] = useState<string | null>(null);
  const off = !!t.inactive; // empresa suspensa: o bilhete fica visível, mas desativado
  const gone = !!t.share?.claimed && !shared; // partilhado e aceite: já não funciona para quem o partilhou
  const bad = t.status === 'BLOCKED' || t.status === 'REVOKED';
  const spent = BigInt(t.spentMinor ?? 0), topup = BigInt(t.topupMinor ?? 0);
  const untouched = t.status === 'ISSUED' && (t.usage?.length ?? 0) === 0;
  const doShare = () => run(async () => {
    const r = await accountApi('POST', `/account/tickets/${t.id}/share`, {});
    setLink(r.link);
    const text = `${t.nickname ? t.nickname + ', t' : 'T'}em um bilhete no Bilhete+. Abra este link para o receber na sua app (válido 7 dias, uso único): ${r.link}`;
    if (typeof navigator.share === 'function') { try { await navigator.share({ title: 'Bilhete+', text, url: r.link }); } catch { /* cancelado: o link continua abaixo */ } }
    reload();
  });
  return (
    <div className={'pp-tk' + (bad ? ' bad' : '') + (gone || off ? ' gone' : '') + (off ? ' off' : '')} aria-disabled={off || undefined}>
      <div className="pp-tk-head">
        <b>{t.nickname ? `${t.nickname} · ` : ''}{t.typeName ?? 'Bilhete'}{total > 1 ? ` · ${n}/${total}` : ''}</b>
        <span className={'pp-tk-st st-' + (off ? 'OFF' : gone ? 'SHARED' : t.status)}>{off ? 'Desativado' : gone ? 'Partilhado' : TICKET_STATE[t.status] ?? t.status}</span>
      </div>
      {off && <p className="pp-tk-reason" style={{ color: 'var(--muted)' }}>Este bilhete está desativado: o evento deixou de estar disponível. Para esclarecimentos, contacte o organizador.</p>}
      {!shared && !gone && !off && (editing
        ? <div className="pp-tk-nick"><input value={nick} maxLength={40} placeholder="Apelido (ex.: Ana, Pai…)" aria-label="Apelido do bilhete" onChange={(e) => setNick(e.target.value)} autoFocus />
            <button type="button" className="pp-link" disabled={busy} onClick={() => run(async () => { await accountApi('PATCH', `/account/tickets/${t.id}`, { nickname: nick }); setEditing(false); reload(); }, 'Apelido guardado')}>Guardar</button>
            <button type="button" className="pp-link" onClick={() => { setEditing(false); setNick(t.nickname ?? ''); }}>Cancelar</button></div>
        : <button type="button" className="pp-link pp-tk-edit" onClick={() => setEditing(true)}>{t.nickname ? 'Mudar apelido' : 'Dar um apelido'}</button>)}
      {gone && <div className="pp-tk-gone"><b>Partilhado com {t.share.to ?? 'outra pessoa'}.</b><span>Este bilhete já não funciona para si: o código passou para a conta dela.</span>
        {untouched && <button type="button" className="pp-link" disabled={busy} onClick={() => run(async () => { await accountApi('POST', `/account/tickets/${t.id}/unshare`, {}); reload(); }, 'Acesso retirado: o bilhete voltou para si')}>Retirar acesso</button>}</div>}
      {bad && t.reason && <p className="pp-tk-reason">Motivo: {t.reason}</p>}
      {!gone && !off && t.hasWallet && !bad && <div className="pp-tk-bal">
        <div><small>Saldo</small><strong>{mt(t.balanceMinor)}</strong></div>
        <div><small>Carregado</small><span>{mt(topup)}</span></div>
        <div><small>Gasto</small><span>{mt(spent)}</span></div>
      </div>}
      {!gone && !off && t.token && <a className="pp-btn alt" href={`/t/${t.token}`}><Icon n="ticket" />Abrir bilhete (QR{t.hasWallet ? ' e carteira' : ''})</a>}
      {!shared && !gone && !off && untouched && (
        t.share && !t.share.claimed
          ? <div className="pp-tk-gone"><b>Link de partilha gerado.</b><span>Ainda ninguém o aceitou. Pode gerar outro ou cancelar.</span>
              <span className="inline"><button type="button" className="pp-link" disabled={busy} onClick={doShare}>Gerar outro link</button><button type="button" className="pp-link" disabled={busy} onClick={() => run(async () => { await accountApi('POST', `/account/tickets/${t.id}/unshare`, {}); setLink(null); reload(); }, 'Partilha cancelada')}>Cancelar partilha</button></span></div>
          : <button type="button" className="pp-btn alt" disabled={busy} onClick={doShare}><Icon n="users" />Partilhar este bilhete</button>)}
      {link && <div className="pp-tk-gone"><b>Link para enviar:</b><span className="mono" style={{ overflowWrap: 'anywhere' }}>{link}</span>
        <span className="inline"><button type="button" className="pp-link" onClick={() => { navigator.clipboard?.writeText(link); toast.show('Link copiado'); }}>Copiar</button>
          <a className="pp-link" href={`https://wa.me/?text=${encodeURIComponent('Abra este link para receber o seu bilhete no Bilhete+: ' + link)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></span>
        <small>Quando a pessoa aceitar, o bilhete passa para a conta dela e deixa de funcionar para si. Só se pode partilhar antes de ser utilizado.</small></div>}
      {toast.node}
      {t.usage?.length > 0 && <details className="pp-tk-use"><summary>Consumos e movimentos ({t.usage.length})</summary>
        <ul>{t.usage.map((u: any) => {
          const pos = BigInt(u.amount_minor) > 0n;
          return <li key={u.id}>
            <div className="between"><span><b>{u.merchant ?? MV[u.type] ?? u.type}</b><small>{u.merchant ? MV[u.type] + ' · ' : ''}{dt(u.created_at)}</small></span><span className={pos ? 'pos' : 'neg'}>{pos ? '+' : '−'}{mt(pos ? u.amount_minor : -BigInt(u.amount_minor))}</span></div>
            {Array.isArray(u.items) && u.items.length > 0 && <p className="pp-tk-items">{u.items.map((i: any) => `${i.qty} × ${i.name}`).join(' · ')}</p>}
          </li>;
        })}</ul>
      </details>}
    </div>
  );
}

/** Bilhetes por prioridade: «Próximos» (por pagar primeiro, depois o evento mais próximo) e «Passados» (o mais recente primeiro). */
function TicketTabs({ orders, reload }: { orders: any[]; reload: () => void }) {
  const next = orders.filter((o) => !o.past).sort((a, b) => (a.status === 'PENDING_PAYMENT' ? 0 : 1) - (b.status === 'PENDING_PAYMENT' ? 0 : 1) || +new Date(a.starts_at) - +new Date(b.starts_at));
  const past = orders.filter((o) => o.past).sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at));
  const [tab, setTab] = useState<'next' | 'past'>(next.length === 0 && past.length > 0 ? 'past' : 'next');
  return (
    <>
      <div className="pp-tabs" role="tablist" aria-label="Filtrar bilhetes">
        <button type="button" role="tab" aria-selected={tab === 'next'} className={tab === 'next' ? 'on' : ''} onClick={() => setTab('next')}>Próximos<span>{next.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Passados<span>{past.length}</span></button>
      </div>
      {tab === 'next'
        ? <OrderGroup items={next} empty="Sem eventos próximos. Veja os eventos e escolha o seu." reload={reload} />
        : <OrderGroup items={past} empty="Ainda sem eventos passados." past reload={reload} />}
    </>
  );
}

function OrderGroup({ items, empty, past, reload }: { items: any[]; empty: string; past?: boolean; reload: () => void }) {
  return (
    <section className={'pp-group' + (past ? ' past' : '')}>
      {items.length === 0 ? <p className="pp-sub">{empty}</p> : <div className="pp-orders">{items.map((o) => (
        <article className="pp-ticket" key={o.id}>
          <div className="pp-ticket-top">
            <span className="pp-label">{dt(o.starts_at)}</span>
            <h3>{o.event}</h3>
            {o.location && <p>{o.location}</p>}
          </div>
          <div className="pp-perf" aria-hidden="true" />
          <div className="pp-ticket-bot">
            {o.shared
              ? <div className="between"><span className="pp-tk-st st-SHARED">Partilhado consigo</span><small className="muted">por {o.from}</small></div>
              : o.inactive ? <div className="between"><span className="pp-tk-st st-OFF">Evento desativado</span><b>{BigInt(o.total_minor) === 0n ? 'Grátis' : mt(o.total_minor)}</b></div>
              : <div className="between"><Pill s={o.status} /><b>{BigInt(o.total_minor) === 0n ? 'Grátis' : mt(o.total_minor)}</b></div>}
            {o.status === 'PENDING_PAYMENT' && !past && !o.inactive && <a className="pp-btn" href={`/o/${o.id}`}>Pagar esta encomenda</a>}
            {o.tickets.map((t: any, i: number) => <TicketCard key={t.id} t={t} n={i + 1} total={o.tickets.length} shared={!!o.shared} reload={reload} />)}
          </div>
        </article>))}</div>}
    </section>
  );
}

/** Link de partilha: mostra o evento e quem partilhou; depois de entrar, aceita e o bilhete fica na conta. */
export function ClaimTicket({ code }: { code: string }) {
  const [info, setInfo] = useState<any>(undefined);
  const { me, refresh } = useAccount();
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  useEffect(() => { fetch(`/account/claim/${code}`).then((r) => r.json()).then((j) => setInfo(j.error ? null : j)).catch(() => setInfo(null)); }, [code]);
  const accept = () => run(async () => { await accountApi('POST', `/account/claim/${code}`, {}); goTo('/account'); }, 'Bilhete adicionado à sua conta');
  return (
    <div className="pp"><header className="pp-top"><img src="/logo-dark.svg" alt="Bilhete+" /><span className="pp-top-r"><LangSwitch className="on-dark" /></span></header>
      <section className="pp-hero"><span className="pp-label">[BP/ Bilhete partilhado]</span><h1>{info ? 'Recebeu um bilhete' : 'Bilhete partilhado'}</h1></section>
      <main className="pp-main">
        {info === undefined ? <Skeleton rows={3} /> : info === null
          ? <section className="pp-card pp-wide"><p className="pp-sub">Este link já foi usado ou expirou. Peça a quem o partilhou que gere um novo.</p><a className="pp-btn" href="/events">Ver eventos</a></section>
          : <>
            <section className="pp-card pp-wide"><p className="pp-sub"><b>{info.from}</b> partilhou consigo um bilhete para:</p>
              <h2 className="pp-h" style={{ margin: 0 }}>{info.event}</h2><p className="pp-sub">{dt(info.startsAt)}{info.location ? ` · ${info.location}` : ''}</p>
              {me ? <button type="button" className="pp-btn" disabled={busy} onClick={accept}>{busy ? 'A adicionar…' : 'Aceitar bilhete'}</button> : null}
            </section>
            {me === null && <AuthPanel onDone={refresh} next={'/claim/' + code} intro="Entre para receber este bilhete na sua conta." />}
            {me === undefined && <Skeleton rows={2} />}
          </>}
      </main>{toast.node}</div>
  );
}

/** «A minha conta»: separador Bilhetes (encomendas) e separador Perfil (dados, segurança, newsletter, idioma, app). */
export function AccountPage({ view = 'tickets' }: { view?: 'tickets' | 'profile' }) {
  // a entrada com Google devolve a sessão no fragmento (#t=…&next=…): guarda-se e limpa-se o endereço
  const [back] = useState(() => {
    const m = /^#t=([\w-]+)&next=([^&]*)$/.exec(location.hash);
    if (!m) return null;
    setAccountToken(m[1]);
    history.replaceState(null, '', location.pathname);
    return decodeURIComponent(m[2]);
  });
  useEffect(() => { if (back && back !== '/account') location.replace(back); }, [back]);
  const urlError = new URLSearchParams(location.search).get('error');
  const { me, refresh, logout } = useAccount();
  const [orders, setOrders] = useState<any[] | null>(null);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const [open, setOpen] = useState<string | null>(null);
  const [prof, setProf] = useState({ name: '', phone: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [del, setDel] = useState('');
  const load = useCallback(() => accountApi('GET', '/account/orders').then(setOrders).catch(() => setOrders([])), []);
  useEffect(() => { if (me) { if (view === 'tickets') load(); setProf({ name: me.name, phone: me.phone ?? '' }); } }, [me, load, view]);
  const inst = useInstall();
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => { if (pushSupported()) pushActive().then(setPushOn); }, []);
  useEffect(() => { if (me) syncPush(); }, [me]); // liga o aparelho à conta e refaz a subscrição se a chave do servidor mudou
  const toggle = (k: string) => setOpen(open === k ? null : k);
  const method = me ? (me.email && me.hasPassword === false ? 'Google' : me.email ? 'E-mail' : 'Telemóvel') : '';

  return (
    <div className="pp pp-app">
      <header className="pp-top"><a href="/" aria-label="Início"><img src="/logo-dark.svg" alt="Bilhete+" /></a><span className="pp-top-r"><LangSwitch className="on-dark" /></span></header>
      <section className="pp-hero">
        {view === 'profile' && me
          ? <><span className="pp-avatar" aria-hidden="true">{initials(me.name)}</span><h1>{me.name}</h1><p>{me.email ?? me.phone} · {method}</p></>
          : <><span className="pp-label">[BP/ {view === 'profile' ? 'Perfil' : 'Os meus bilhetes'}]</span><h1>{view === 'profile' ? 'Perfil' : 'Os meus bilhetes'}</h1></>}
      </section>
      <main className="pp-main">
        {urlError && GOOGLE_ERRORS[urlError] && !me && <p className="pp-alert" role="alert">{GOOGLE_ERRORS[urlError]}</p>}
        {me === undefined ? <Skeleton rows={3} /> : me === null ? <AuthPanel onDone={refresh} next={location.pathname} intro="Entre para ver os seus bilhetes e o seu perfil." /> : <>
          {view === 'tickets' && (!orders ? <Skeleton rows={3} /> : orders.length === 0 ? <div className="pp-card"><Empty icon="ticket">Ainda não comprou bilhetes. <a href="/events">Ver eventos</a></Empty></div> : <>
            <TicketTabs orders={orders} reload={load} />
          </>)}

          {view === 'profile' && <div className="pp-list">
            <Row icon="users" title="Dados pessoais" hint={me.email ?? me.phone ?? ''} open={open === 'data'} onToggle={() => toggle('data')}>
              <label className="pp-field"><span>Nome</span><input value={prof.name} autoComplete="name" onChange={(e) => setProf({ ...prof, name: e.target.value })} /></label>
              {me.email && <label className="pp-field"><span>Telemóvel</span><input type="tel" value={prof.phone} autoComplete="tel" onChange={(e) => setProf({ ...prof, phone: e.target.value })} /></label>}
              <button className="pp-btn" disabled={busy || !prof.name.trim()} onClick={() => run(async () => { await accountApi('PATCH', '/account/me', { name: prof.name, ...(me.email ? { phone: prof.phone || null } : {}) }); refresh(); }, 'Dados guardados')}>Guardar</button>
            </Row>
            <Row icon="shield" title="Segurança" hint={me.hasPassword === false ? `Entra com ${method === 'Google' ? 'o Google' : 'o telemóvel'}` : 'Palavra-passe'} open={open === 'sec'} onToggle={() => toggle('sec')}>
              {me.hasPassword === false
                ? <p className="pp-sub">{method === 'Google' ? 'Esta conta entra com o Google: a segurança é a da sua conta Google. Não precisa de palavra-passe.' : 'Esta conta entra com o telemóvel: cada entrada pede um código por SMS. Não precisa de palavra-passe.'}</p>
                : <>
                  <label className="pp-field"><span>Palavra-passe actual</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
                  <label className="pp-field"><span>Nova palavra-passe</span><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><small>Pelo menos 8 caracteres. As outras sessões serão terminadas.</small></label>
                  <button className="pp-btn" disabled={busy || pw.next.length < 8 || !pw.current} onClick={() => run(async () => { await accountApi('POST', '/account/password', pw); setPw({ current: '', next: '' }); }, 'Palavra-passe alterada')}>Alterar palavra-passe</button>
                </>}
            </Row>
            {me.email && <Row icon="mail" title="Newsletter" hint={me.newsletter !== false ? 'Ativada' : 'Desativada'} open={open === 'news'} onToggle={() => toggle('news')}>
              <label className="pp-check"><input type="checkbox" checked={me.newsletter !== false} disabled={busy} onChange={(e) => run(async () => { await accountApi('PATCH', '/account/me', { newsletter: e.target.checked }); refresh(); }, e.target.checked ? 'Newsletter ativada' : 'Newsletter desativada')} /><span>Receber novidades e eventos por e-mail.</span></label>
              <p className="pp-sub">Os e-mails das suas compras (bilhetes e pagamentos) continuam a chegar sempre.</p>
            </Row>}
            {pushSupported() && <section className="pp-row-item"><div className="pp-row-head static"><span className="pp-row-ic"><Icon n="bell" /></span><span className="pp-row-tx"><b>Notificações</b><small>{pushPermission() === 'denied' ? 'Bloqueadas nas definições do aparelho' : 'Novos eventos num raio de 150 km e bilhetes confirmados'}</small></span>
              <label className="pp-switch"><input type="checkbox" checked={pushOn} disabled={busy || pushPermission() === 'denied'} onChange={(e) => run(async () => { if (e.target.checked) { const ok = await enablePush(); setPushOn(ok); if (!ok) throw new Error('Não foi possível ativar as notificações.'); } else { await disablePush(); setPushOn(false); } }, e.target.checked ? 'Notificações ativadas' : 'Notificações desativadas')} /><span /></label></div></section>}
            <section className="pp-row-item"><div className="pp-row-head static"><span className="pp-row-ic"><Icon n="globe" /></span><span className="pp-row-tx"><b>Idioma</b></span><LangSwitch always /></div></section>
            {inst.canPrompt && !inst.installed && <section className="pp-row-item"><div className="pp-row-head static"><span className="pp-row-ic"><Icon n="arrowdown" /></span><span className="pp-row-tx"><b>App no telemóvel</b><small>Instale o Bilhete+ no ecrã principal</small></span><InstallButton label="Instalar" className="pp-link" /></div></section>}
            <Row icon="trash" title="Apagar conta" hint="Remove os seus dados pessoais" open={open === 'del'} onToggle={() => toggle('del')} danger>
              <p className="pp-sub">Os bilhetes já emitidos continuam válidos através do link de cada bilhete.</p>
              {me.hasPassword === false
                ? <label className="pp-field"><span>{me.email ? 'Escreva o seu e-mail para confirmar' : 'Escreva o seu telemóvel para confirmar'}</span><input type={me.email ? 'email' : 'tel'} autoComplete="off" placeholder={me.email ?? me.phone ?? ''} value={del} onChange={(e) => setDel(e.target.value)} /></label>
                : <label className="pp-field"><span>Palavra-passe para confirmar</span><input type="password" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} /></label>}
              <button className="pp-btn danger" disabled={busy || !del} onClick={() => run(async () => { await accountApi('DELETE', '/account/me', me.hasPassword === false ? { confirm: del } : { password: del }); setAccountToken(null); location.assign('/'); })}>Apagar a minha conta</button>
            </Row>
            <button type="button" className="pp-signout" onClick={logout}><Icon n="logout" />Terminar sessão</button>
          </div>}
        </>}
      </main>
      <AppTabs current={view === 'profile' ? 'profile' : 'tickets'} />
      {toast.node}
    </div>
  );
}
