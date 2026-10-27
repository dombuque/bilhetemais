import { useCallback, useEffect, useState } from 'react';
import { accountApi, accountToken, dt, mt, setAccountToken } from '../api';
import { Empty, Field, Icon, Pill, Skeleton, useAction, useToast } from '../ui';

export interface Me { name: string; email: string; phone: string | null }

/** Conta de participante em sessão (ou null). Actualiza-se quando a conta muda noutro separador. */
export function useAccount() {
  const [me, setMe] = useState<Me | null | undefined>(accountToken() ? undefined : null);
  const refresh = useCallback(() => {
    if (!accountToken()) { setMe(null); return; }
    accountApi('GET', '/account/me').then((r) => setMe(r.account)).catch(() => { setAccountToken(null); setMe(null); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { me, refresh, logout: async () => { try { await accountApi('POST', '/account/logout', {}); } catch { /* já expirou */ } setAccountToken(null); setMe(null); } };
}

/** Entrar ou criar conta com e-mail e palavra-passe. Chama `onDone` quando a sessão fica iniciada. */
export function AuthPanel({ onDone, intro }: { onDone: () => void; intro?: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [show, setShow] = useState(false);
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
  return (
    <section className="card stack" aria-label="Entrar ou criar conta">
      <div className="seg" role="tablist"><button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Entrar</button><button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Criar conta</button></div>
      <p className="muted small">{intro ?? 'Para comprar bilhetes precisa de uma conta. Assim os seus bilhetes ficam guardados e pode recuperá-los em qualquer telemóvel.'}</p>
      {mode === 'register' && <Field label="Nome"><input value={f.name} autoComplete="name" onChange={set('name')} /></Field>}
      <Field label="E-mail"><input type="email" inputMode="email" value={f.email} autoComplete="email" onChange={set('email')} /></Field>
      {mode === 'register' && <Field label="Telemóvel (opcional)"><input type="tel" inputMode="tel" value={f.phone} autoComplete="tel" onChange={set('phone')} /></Field>}
      <Field label="Palavra-passe" hint={mode === 'register' ? 'Pelo menos 8 caracteres.' : undefined}>
        <div className="pw"><input type={show ? 'text' : 'password'} value={f.password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={set('password')} onKeyDown={(e) => e.key === 'Enter' && ready && submit()} />
          <button type="button" className="ghost sm" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button></div>
      </Field>
      <button className="big wide" disabled={busy || !ready} onClick={submit}>{busy ? 'A entrar…' : mode === 'login' ? 'Entrar' : 'Criar conta e continuar'}</button>
      {toast.node}
    </section>
  );
}

/** Página «A minha conta»: os meus bilhetes, dados, palavra-passe e apagar conta. */
export function AccountPage() {
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
    <div className="themed" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <header className="pub-bar"><a href="/" aria-label="Início"><img src="/logo.svg" alt="Bilhete+" /></a><a className="small" href="/eventos">Ver eventos</a></header>
      <main className="pub stack narrow">
        {me === undefined ? <Skeleton rows={3} /> : me === null ? <AuthPanel onDone={refresh} intro="Entre para ver os seus bilhetes e encomendas." /> : <>
          <div className="between"><div><h1>A minha conta</h1><p className="muted">{me.name} · {me.email}</p></div><button className="ghost sm" onClick={logout}><Icon n="logout" />Sair</button></div>
          <div className="seg" role="tablist"><button role="tab" aria-selected={tab === 'tickets'} className={tab === 'tickets' ? 'on' : ''} onClick={() => setTab('tickets')}>Os meus bilhetes</button><button role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>Dados e segurança</button></div>
          {tab === 'tickets' && (!orders ? <Skeleton rows={3} /> : orders.length === 0 ? <div className="card"><Empty icon="ticket">Ainda não comprou bilhetes. <a href="/eventos">Ver eventos</a></Empty></div> : orders.map((o) => (
            <section className="card stack" key={o.id}>
              <div className="between"><div><b>{o.event}</b><div className="muted small">{dt(o.starts_at)}{o.location ? ` · ${o.location}` : ''}</div></div><Pill s={o.status} /></div>
              <div className="between small"><span className="muted">Total</span><b>{BigInt(o.total_minor) === 0n ? 'Grátis' : mt(o.total_minor)}</b></div>
              {o.status === 'PENDING_PAYMENT' && <a className="btn wide" href={`/o/${o.id}`}>Pagar esta encomenda</a>}
              {o.tickets.map((t: any, i: number) => <a key={t.id} className="btn ghost wide" href={`/t/${t.token}`}><Icon n="ticket" />Abrir bilhete {i + 1} (QR e carteira)</a>)}
            </section>
          )))}
          {tab === 'profile' && <>
            <section className="card stack"><h2>Os meus dados</h2>
              <Field label="Nome"><input value={prof.name} autoComplete="name" onChange={(e) => setProf({ ...prof, name: e.target.value })} /></Field>
              <Field label="Telemóvel"><input type="tel" value={prof.phone} autoComplete="tel" onChange={(e) => setProf({ ...prof, phone: e.target.value })} /></Field>
              <button disabled={busy || !prof.name.trim()} onClick={() => run(async () => { await accountApi('PATCH', '/account/me', { name: prof.name, phone: prof.phone || null }); refresh(); }, 'Dados guardados')}>Guardar</button></section>
            <section className="card stack"><h2>Palavra-passe</h2>
              <Field label="Palavra-passe actual"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
              <Field label="Nova palavra-passe" hint="Pelo menos 8 caracteres. As outras sessões serão terminadas."><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
              <button disabled={busy || pw.next.length < 8 || !pw.current} onClick={() => run(async () => { await accountApi('POST', '/account/password', pw); setPw({ current: '', next: '' }); }, 'Palavra-passe alterada')}>Alterar palavra-passe</button></section>
            <section className="card stack"><h2>Apagar conta</h2>
              <p className="muted small">Remove os seus dados pessoais. Os bilhetes já emitidos continuam válidos através do link de cada bilhete.</p>
              <Field label="Palavra-passe para confirmar"><input type="password" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} /></Field>
              <button className="danger" disabled={busy || !del} onClick={() => run(async () => { await accountApi('DELETE', '/account/me', { password: del }); setAccountToken(null); location.assign('/'); })}>Apagar a minha conta</button></section>
          </>}
        </>}
        {toast.node}
      </main>
    </div>
  );
}
