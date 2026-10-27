import { useCallback, useEffect, useState } from 'react';
import { accountApi, accountToken, dt, mt, setAccountToken } from '../api';
import { Empty, Icon, LangSwitch, Pill, Skeleton, useAction, useToast } from '../ui';
import './participant.css';

export interface Me { name: string; email: string; phone: string | null }

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

function useGoogle() {
  const [on, setOn] = useState(false);
  useEffect(() => { fetch('/public/config').then((r) => r.json()).then((c) => setOn(!!c.google)).catch(() => {}); }, []);
  return on;
}
const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
);

/** Entrar ou criar conta (e-mail e palavra-passe, ou Google). Chama `onDone` quando a sessão fica iniciada. */
export function AuthPanel({ onDone, intro, next }: { onDone: () => void; intro?: string; next?: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [show, setShow] = useState(false);
  const google = useGoogle();
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => run(async () => {
    const r = mode === 'login'
      ? await accountApi('POST', '/account/login', { email: f.email, password: f.password })
      : await accountApi('POST', '/account/register', { name: f.name, email: f.email, phone: f.phone || undefined, password: f.password });
    setAccountToken(r.token);
    onDone();
  });
  const ready = f.email.includes('@') && f.password.length >= 8 && (mode === 'login' || f.name.trim());
  const back = next ?? location.pathname + location.search;
  return (
    <section className="pp-card pp-auth" aria-label="Entrar ou criar conta">
      <span className="pp-label">[BP/ {mode === 'login' ? 'Entrar' : 'Criar conta'}]</span>
      <h2 className="pp-h">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
      <p className="pp-sub">{intro ?? 'Para comprar bilhetes precisa de uma conta. Assim os seus bilhetes ficam guardados e pode recuperá-los em qualquer telemóvel.'}</p>
      {google && <>
        <a className="pp-google" href={`/account/google/start?next=${encodeURIComponent(back)}`}><GoogleG />Continuar com o Google</a>
        <div className="pp-or"><span>ou</span></div>
      </>}
      {mode === 'register' && <label className="pp-field"><span>Nome</span><input value={f.name} autoComplete="name" onChange={set('name')} /></label>}
      <label className="pp-field"><span>E-mail</span><input type="email" inputMode="email" value={f.email} autoComplete="email" onChange={set('email')} /></label>
      {mode === 'register' && <label className="pp-field"><span>Telemóvel (opcional)</span><input type="tel" inputMode="tel" value={f.phone} autoComplete="tel" onChange={set('phone')} /></label>}
      <label className="pp-field"><span>Palavra-passe</span>
        <span className="pp-pw"><input type={show ? 'text' : 'password'} value={f.password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={set('password')} onKeyDown={(e) => e.key === 'Enter' && ready && submit()} />
          <button type="button" className="pp-link" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button></span>
        {mode === 'register' && <small>Pelo menos 8 caracteres.</small>}
      </label>
      <button className="pp-btn" disabled={busy || !ready} onClick={submit}>{busy ? 'A entrar…' : mode === 'login' ? 'Entrar' : 'Criar conta e continuar'}</button>
      <button type="button" className="pp-link center" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Ainda não tem conta? Criar conta' : 'Já tem conta? Entrar'}</button>
      {toast.node}
    </section>
  );
}

/** Página «A minha conta»: os meus bilhetes, dados, palavra-passe e apagar conta. */
export function AccountPage() {
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
  const [tab, setTab] = useState<'tickets' | 'profile'>('tickets');
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const [prof, setProf] = useState({ name: '', phone: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [del, setDel] = useState('');
  const load = useCallback(() => accountApi('GET', '/account/orders').then(setOrders).catch(() => setOrders([])), []);
  useEffect(() => { if (me) { load(); setProf({ name: me.name, phone: me.phone ?? '' }); } }, [me, load]);

  return (
    <div className="pp">
      <header className="pp-top"><a href="/" aria-label="Início"><img src="/logo-dark.svg" alt="Bilhete+" /></a><span className="pp-top-r"><LangSwitch className="on-dark" /><a href="/events">Ver eventos</a>{me && <button type="button" className="pp-out" onClick={logout}><Icon n="logout" />Sair</button>}</span></header>
      <section className="pp-hero">
        <span className="pp-label">[BP/ A minha conta]</span>
        <h1>{me ? me.name : 'A minha conta'}</h1>
        {me && <p>{me.email}</p>}
      </section>
      <main className="pp-main">
        {urlError && GOOGLE_ERRORS[urlError] && !me && <p className="pp-alert" role="alert">{GOOGLE_ERRORS[urlError]}</p>}
        {me === undefined ? <Skeleton rows={3} /> : me === null ? <AuthPanel onDone={refresh} next="/account" intro="Entre para ver os seus bilhetes e encomendas." /> : <>
          <div className="pp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'tickets'} className={tab === 'tickets' ? 'on' : ''} onClick={() => setTab('tickets')}>Os meus bilhetes</button>
            <button role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>Dados e segurança</button>
          </div>
          {tab === 'tickets' && (!orders ? <Skeleton rows={3} /> : orders.length === 0 ? <div className="pp-card"><Empty icon="ticket">Ainda não comprou bilhetes. <a href="/events">Ver eventos</a></Empty></div> : (
            <div className="pp-orders">{orders.map((o) => (
              <article className="pp-ticket" key={o.id}>
                <div className="pp-ticket-top">
                  <span className="pp-label">{dt(o.starts_at)}</span>
                  <h3>{o.event}</h3>
                  {o.location && <p>{o.location}</p>}
                </div>
                <div className="pp-perf" aria-hidden="true" />
                <div className="pp-ticket-bot">
                  <div className="between"><Pill s={o.status} /><b>{BigInt(o.total_minor) === 0n ? 'Grátis' : mt(o.total_minor)}</b></div>
                  {o.status === 'PENDING_PAYMENT' && <a className="pp-btn" href={`/o/${o.id}`}>Pagar esta encomenda</a>}
                  {o.tickets.map((t: any, i: number) => <a key={t.id} className="pp-btn alt" href={`/t/${t.token}`}><Icon n="ticket" />Abrir bilhete {i + 1} (QR e carteira)</a>)}
                </div>
              </article>))}</div>))}
          {tab === 'profile' && <>
            <section className="pp-card"><h2 className="pp-h sm">Os meus dados</h2>
              <label className="pp-field"><span>Nome</span><input value={prof.name} autoComplete="name" onChange={(e) => setProf({ ...prof, name: e.target.value })} /></label>
              <label className="pp-field"><span>Telemóvel</span><input type="tel" value={prof.phone} autoComplete="tel" onChange={(e) => setProf({ ...prof, phone: e.target.value })} /></label>
              <button className="pp-btn" disabled={busy || !prof.name.trim()} onClick={() => run(async () => { await accountApi('PATCH', '/account/me', { name: prof.name, phone: prof.phone || null }); refresh(); }, 'Dados guardados')}>Guardar</button></section>
            <section className="pp-card"><h2 className="pp-h sm">Palavra-passe</h2>
              <label className="pp-field"><span>Palavra-passe actual</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
              <label className="pp-field"><span>Nova palavra-passe</span><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><small>Pelo menos 8 caracteres. As outras sessões serão terminadas.</small></label>
              <button className="pp-btn" disabled={busy || pw.next.length < 8 || !pw.current} onClick={() => run(async () => { await accountApi('POST', '/account/password', pw); setPw({ current: '', next: '' }); }, 'Palavra-passe alterada')}>Alterar palavra-passe</button></section>
            <section className="pp-card"><h2 className="pp-h sm">Apagar conta</h2>
              <p className="pp-sub">Remove os seus dados pessoais. Os bilhetes já emitidos continuam válidos através do link de cada bilhete.</p>
              <label className="pp-field"><span>Palavra-passe para confirmar</span><input type="password" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} /></label>
              <button className="pp-btn danger" disabled={busy || !del} onClick={() => run(async () => { await accountApi('DELETE', '/account/me', { password: del }); setAccountToken(null); location.assign('/'); })}>Apagar a minha conta</button></section>
          </>}
        </>}
      </main>
      {toast.node}
    </div>
  );
}
