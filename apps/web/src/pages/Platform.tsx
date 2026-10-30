import { useCallback, useEffect, useState } from 'react';
import { api, dt, eventShareUrl, eventUrl, getToken, mt } from '../api';
import { inApp } from '../i18n';
import { NewsletterAdmin } from './Newsletter';
import { Empty, Field, Icon, Layout, PageHead, Pill, Skeleton, useAction, useToast } from '../ui';

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: 'Administrador da empresa', CASHIER: 'Balcão / caixa', MERCHANT_OPERATOR: 'Operador de comerciante', GATE_OPERATOR: 'Controlo de acessos', PLATFORM_ADMIN: 'Administrador Bilhete+' };
const FILTERS = [['PENDING', 'Pendentes'], ['ACTIVE', 'Activas'], ['all', 'Todas']] as const;

/** Administração Bilhete+: revisão e aprovação das empresas registadas online. */
export function Platform({ me }: { me: any }) {
  const [orgs, setOrgs] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<string>('PENDING');
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState('orgs');
  const toast = useToast();
  const load = useCallback(() => api('GET', '/orgs').then(setOrgs), []);
  useEffect(() => { load(); }, [load]);
  const pending = orgs?.filter((o) => o.status === 'PENDING').length ?? 0;
  const list = (orgs ?? []).filter((o) => filter === 'all' || o.status === filter);
  useEffect(() => { if (orgs && filter === 'PENDING' && pending === 0) setFilter('all'); }, [orgs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout me={me} nav={[{ id: 'orgs', label: 'Empresas', icon: 'building' }, { id: 'events', label: 'Eventos', icon: 'ticket' }, { id: 'newsletter', label: 'Newsletter', icon: 'mail' }, { id: 'users', label: 'Utilizadores', icon: 'users' }, { id: 'support', label: 'Suporte', icon: 'mail' }]} view={view} onView={setView}>
      {view === 'events' ? <AllEvents /> : view === 'newsletter' ? <NewsletterAdmin toast={toast.show} /> : view === 'support' ? <SupportEmails toast={toast.show} /> : view === 'users' ? <UsersAdmin orgs={orgs ?? []} meId={me.id} toast={toast.show} /> : <>
      <div hidden={creating || !!sel}>
      <PageHead title="Empresas" sub={`${orgs?.length ?? 0} empresa${orgs?.length === 1 ? '' : 's'}${pending ? ` · ${pending} a aguardar aprovação` : ''}`} actions={<button onClick={() => setCreating(true)}><Icon n="plus" />Nova empresa</button>} />
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}{k === 'PENDING' && pending > 0 ? ` (${pending})` : ''}</button>)}</div>
      <div className="card">
        {!orgs ? <Skeleton rows={4} /> : list.length === 0 ? <Empty icon="building">Nenhuma empresa nesta lista.</Empty> : (
          <table className="resp"><thead><tr><th>Empresa</th><th>NUIT</th><th>Responsável</th><th>Backoffice</th><th>Docs</th><th>Registo</th><th>Estado</th></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.id} className="click" onClick={() => setSel(o.id)}>
                <td data-l="Empresa"><b>{o.trade_name}</b><br /><small className="muted">{o.legal_name}</small></td><td data-l="NUIT">{o.nuit}</td>
                <td data-l="Responsável">{o.contact_name}<br /><small className="muted">{o.phone}</small></td><td data-l="Backoffice" onClick={(e) => e.stopPropagation()}><a href={`/company/${o.slug}`} target="_blank" rel="noopener noreferrer" className="mono small">/company/{o.slug}</a><br /><button type="button" className="ghost sm" onClick={() => navigator.clipboard?.writeText(`${location.origin}/company/${o.slug}`)}><Icon n="copy" />Copiar link</button></td><td data-l="Documentos">{o.documents}</td>
                <td data-l="Registo">{dt(o.created_at)}</td><td data-l="Estado"><Pill s={o.status} /></td></tr>))}</tbody></table>)}
      </div>
      </div>
      {creating && <NewOrg toast={toast.show} onClose={() => { setCreating(false); load(); }} />}
      {sel && <Review id={sel} onClose={() => { setSel(null); load(); }} toast={toast.show} />}
      </>}
      {toast.node}
    </Layout>
  );
}

const ROLE_OPTIONS: [string, string][] = [['PLATFORM_ADMIN', 'Administrador Bilhete+'], ['ORG_ADMIN', 'Administrador da empresa'], ['CASHIER', 'Balcão / caixa'], ['GATE_OPERATOR', 'Controlo de acessos']];

/** Utilizadores: administradores Bilhete+ e equipas das empresas. Adicionar, desactivar e repor palavra-passe, tudo inline. */
function UsersAdmin({ orgs, meId, toast }: { orgs: any[]; meId: string; toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'PLATFORM_ADMIN', organizationId: '', password: genPassword() });
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState('');
  const { busy, run } = useAction(toast);
  const load = useCallback(() => api('GET', '/platform/users').then(setList), []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const ready = f.name.trim() && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 8 && (f.role === 'PLATFORM_ADMIN' || f.organizationId);
  return (
    <>
      <PageHead title="Utilizadores" sub="Administradores da Bilhete+ e equipas das empresas." actions={!adding && <button onClick={() => { setAdding(true); setShown(null); }}><Icon n="plus" />Novo utilizador</button>} />
      {shown && <div className="card stack"><p style={{ margin: 0 }}>Utilizador criado. Entregue estes dados; a palavra-passe <b>não volta a ser mostrada</b>.</p>
        <div className="card flat mono">E-mail: {shown.email}<br />Palavra-passe: {shown.password}</div>
        <div className="inline"><button onClick={() => navigator.clipboard?.writeText(`E-mail: ${shown.email}\nPalavra-passe: ${shown.password}`)}><Icon n="copy" />Copiar</button><button className="ghost" onClick={() => setShown(null)}>Fechar</button></div></div>}
      {adding && <div className="card stack">
        <h2 style={{ margin: 0 }}>Novo utilizador</h2>
        <div className="field-row">
          <Field label="Nome"><input value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="E-mail"><input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <div className="field-row">
          <Field label="Função"><select value={f.role} onChange={set('role')}>{ROLE_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {f.role !== 'PLATFORM_ADMIN' && <Field label="Empresa"><select value={f.organizationId} onChange={set('organizationId')}><option value="">Escolha…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.trade_name}</option>)}</select></Field>}
        </div>
        <Field label="Palavra-passe inicial" hint="Gerada automaticamente; o utilizador pode alterá-la em «A minha conta»."><div className="inline" style={{ flexWrap: 'nowrap' }}><input value={f.password} onChange={set('password')} className="mono" /><button type="button" className="ghost" onClick={() => setF({ ...f, password: genPassword() })}>Gerar</button></div></Field>
        <div className="inline">
          <button disabled={busy || !ready} onClick={() => run(async () => { await api('POST', '/platform/users', f); setShown({ email: f.email, password: f.password }); setAdding(false); setF({ name: '', email: '', role: 'PLATFORM_ADMIN', organizationId: '', password: genPassword() }); await load(); })}>{busy ? 'A criar…' : 'Criar utilizador'}</button>
          <button className="ghost" onClick={() => setAdding(false)}>Cancelar</button>
        </div>
      </div>}
      <div className="card">
        {!list ? <Skeleton rows={4} /> : list.length === 0 ? <Empty icon="users">Sem utilizadores.</Empty> : (
          <table className="resp"><thead><tr><th>Nome</th><th>Função</th><th>Empresa</th><th>Estado</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id}>
                <td data-l="Nome"><b>{u.name}</b><br /><small className="muted">{u.email}</small></td>
                <td data-l="Função">{ROLE_LABEL[u.role] ?? u.role}</td>
                <td data-l="Empresa">{u.organization ?? 'Bilhete+'}</td>
                <td data-l="Estado"><Pill s={u.status} /></td>
                <td className="nolabel">
                  {resetFor === u.id
                    ? <span className="inline"><input className="mono" value={newPw} onChange={(e) => setNewPw(e.target.value)} aria-label="Nova palavra-passe" /><button className="sm" disabled={busy || newPw.length < 8} onClick={() => run(async () => { await api('POST', `/platform/users/${u.id}/password`, { password: newPw }); setResetFor(null); setNewPw(''); }, 'Palavra-passe reposta')}>Repor</button><button className="ghost sm" onClick={() => setResetFor(null)}>Cancelar</button></span>
                    : <span className="inline"><button className="ghost sm" onClick={() => { setResetFor(u.id); setNewPw(genPassword()); }}>Repor palavra-passe</button>
                      {u.id !== meId && <button className="ghost sm" disabled={busy} onClick={() => run(async () => { await api('PATCH', `/platform/users/${u.id}`, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); await load(); }, u.status === 'ACTIVE' ? 'Utilizador desactivado' : 'Utilizador activado')}>{u.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}</button>}</span>}
                </td></tr>))}</tbody></table>)}
      </div>
    </>
  );
}

/** E-mails de suporte da Bilhete+: recebem o aviso quando uma empresa se regista. */
function SupportEmails({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [email, setEmail] = useState('');
  const { busy, run } = useAction(toast);
  const load = useCallback(() => api('GET', '/platform/support-emails').then(setList), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Suporte" sub="Estes e-mails recebem um aviso sempre que uma empresa se regista e aguarda aprovação." />
      <div className="card stack">
        <div className="row" style={{ gap: 8 }}>
          <input type="email" value={email} placeholder="suporte@exemplo.com" aria-label="E-mail de suporte" onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy || !/\S+@\S+\.\S+/.test(email)} onClick={() => run(async () => { await api('POST', '/platform/support-emails', { email }); setEmail(''); await load(); }, 'E-mail adicionado')}><Icon n="plus" />Adicionar</button>
        </div>
        {!list ? <Skeleton rows={2} /> : list.length === 0 ? <Empty icon="mail">Ainda não há e-mails de suporte. Adicione pelo menos um para ser avisado dos novos registos.</Empty> : (
          <table className="resp"><tbody>{list.map((r) => <tr key={r.id}><td>{r.email}</td><td className="nolabel"><button className="ghost sm" disabled={busy} onClick={() => run(async () => { await api('DELETE', `/platform/support-emails/${r.id}`); await load(); }, 'E-mail removido')}><Icon n="trash" />Remover</button></td></tr>)}</tbody></table>)}
      </div>
    </>
  );
}

/** Detalhe aberto no próprio ecrã (sem janelas): título, «Voltar» e o conteúdo. */
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="stack">
      <a href="#back" onClick={(e) => { e.preventDefault(); onClose(); window.scrollTo(0, 0); }} className="crumb"><Icon n="back" />Voltar</a>
      <PageHead title={title} />
      <div className="card stack">{children}</div>
    </div>
  );
}

/** Todos os eventos da plataforma, em cartões com a imagem, e o rendimento de cada um ao abrir. */
function AllEvents() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { api('GET', '/platform/events').then(setRows); }, []);
  return (
    <>
      <PageHead title="Eventos" sub={`${rows?.length ?? 0} evento${rows?.length === 1 ? '' : 's'} em todas as empresas`} />
      <div hidden={!!sel}>
      {!rows ? <Skeleton rows={4} /> : rows.length === 0 ? <div className="card"><Empty icon="ticket">Ainda não há eventos.</Empty></div> : (
        <div className="evgrid">
          {rows.map((e) => {
            const primary = e.theme?.primary ?? '#5b2eff';
            const bg = e.cover_at && e.subdomain ? `center / cover url(/public/events/${e.subdomain}/assets/cover?v=${+new Date(e.cover_at)})` : `linear-gradient(140deg, ${primary}, #0b0820)`;
            return (
              <button type="button" key={e.id} className={'evcard' + (e.org_status !== 'ACTIVE' ? ' off' : '')} onClick={() => setSel(e)} aria-label={`Ver rendimento de ${e.name}`}>
                <span className="img" style={{ background: bg }}><span className="pillbox">{e.org_status !== 'ACTIVE' ? <span className="pill">Empresa {e.org_status === 'SUSPENDED' ? 'suspensa' : e.org_status === 'PENDING' ? 'por aprovar' : 'desativada'}</span> : <Pill s={e.status} />}</span></span>
                <span className="body">
                  <small className="mono">{e.organization} · {dt(e.starts_at)}</small>
                  <b>{e.name}</b>
                  <small className="muted">{e.location}</small>
                  <span className="between"><span className="mono small">{e.sold}/{e.capacity} bilhetes</span><b className="price">{mt(e.revenue_minor)}</b></span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      </div>
      {sel && <EventEarnings ev={sel} onClose={() => setSel(null)} />}
    </>
  );
}

/** Quanto o evento rendeu: bilhetes, consumos com a carteira e saldo ainda por gastar. */
function EventEarnings({ ev, onClose }: { ev: any; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api('GET', `/platform/events/${ev.id}/summary`).then(setD); }, [ev.id]);
  return (
    <Panel title={ev.name} onClose={onClose}>
      {!d ? <Skeleton /> : <>
        <div className="between"><span className="muted">{d.event.organization} · {dt(d.event.starts_at)}</span><Pill s={d.event.status} /></div>
        <div className="earn"><span className="mono small">Total ganho</span><b>{mt(d.totalMinor)}</b><span className="muted small">bilhetes {mt(d.tickets.revenueMinor)} + consumos na carteira {mt(d.wallets.spentMinor)}</span></div>
        <table><tbody>
          <tr><th>Bilhetes vendidos</th><td>{d.tickets.sold} de {d.tickets.capacity}</td></tr>
          <tr><th>Entradas validadas</th><td>{d.tickets.entered}</td></tr>
          <tr><th>Encomendas pagas</th><td>{d.tickets.paidOrders}</td></tr>
          <tr><th>Carregamentos de carteiras</th><td>{mt(d.wallets.topupsMinor)}</td></tr>
          <tr><th>Saldo por gastar</th><td>{mt(d.wallets.balanceMinor)}</td></tr>
        </tbody></table>
        <div><h3>Por tipo de bilhete</h3>
          {d.byType.map((t: any) => <div className="between small" key={t.name}><span>{t.name}</span><span className="muted">{t.sold} · {mt(t.revenueMinor)}</span></div>)}</div>
        {ev.subdomain && ev.org_status === 'ACTIVE' && <a className="btn ghost" href={inApp() ? eventUrl(ev.subdomain) : eventShareUrl(ev.subdomain)} {...(inApp() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>Abrir página do evento</a>}
      </>}
    </Panel>
  );
}

function Review({ id, onClose, toast }: { id: string; onClose: () => void; toast: (m: string, e?: boolean) => void }) {
  const [o, setO] = useState<any>(null);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction(toast);
  const load = useCallback(() => api('GET', `/orgs/${id}`).then(setO), [id]);
  useEffect(() => { load(); }, [load]);
  const decide = (status: string) => run(async () => { await api('POST', `/orgs/${id}/status`, { status, reason: reason || undefined }); await load(); setReason(''); }, 'Estado actualizado');
  /** Os documentos exigem sessão: descarrega-se com o token e abre-se o ficheiro localmente. */
  const download = (d: any) => run(async () => {
    const r = await fetch(`/orgs/${id}/documents/${d.id}`, { headers: { authorization: 'Bearer ' + getToken() } });
    if (!r.ok) throw new Error('Não foi possível descarregar');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = d.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  return (
    <Panel title={o?.trade_name ?? 'Empresa'} onClose={onClose}>
      {!o ? <Skeleton /> : <>
        <div className="between"><span className="muted">{o.legal_name}</span><Pill s={o.status} /></div>
        <table><tbody>
          {([['NUIT', o.nuit], ['Responsável', o.contact_name], ['Telefone', o.phone], ['E-mail de facturação', o.billing_email], ['Endereço', o.address], ['Website', o.website], ['Registo', dt(o.created_at)]] as const).map(([k, v]) => v ? <tr key={k}><th>{k}</th><td>{v}</td></tr> : null)}
        </tbody></table>
        <div><h3>Documentos</h3>
          {o.documents.length === 0 ? <p className="muted small">Sem documentos anexados.</p> : o.documents.map((d: any) => (
            <div className="between" key={d.id}><span>{d.label}<br /><small className="muted">{d.filename}</small></span><button className="ghost sm" onClick={() => download(d)}><Icon n="arrowdown" />Descarregar</button></div>))}</div>
        <div><h3>Equipa ({o.users.length})</h3>
          {o.users.map((u: any) => <div className="between small" key={u.id}><span>{u.name} · <span className="muted">{u.email}</span></span><span className="muted">{ROLE_LABEL[u.role] ?? u.role}</span></div>)}</div>
        <div><h3>Eventos ({o.events.length})</h3>
          {o.events.length === 0 ? <p className="muted small">Ainda sem eventos.</p> : o.events.map((e: any) => <div className="between small" key={e.id}><span>{e.name}</span><span className="muted">{e.sold} bilhetes · <Pill s={e.status} /></span></div>)}</div>
        <p className="muted small">Área de entrada da equipa: <span className="mono">/company/{o.slug}</span></p>
        {o.status_reason && <p className="muted">Último motivo: {o.status_reason}</p>}
        <Field label="Motivo (obrigatório para rejeitar ou suspender)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: NUIT não confere com a certidão" /></Field>
        <div className="inline">
          {o.status !== 'ACTIVE' && <button disabled={busy} onClick={() => decide('ACTIVE')}><Icon n="check" />Aprovar</button>}
          {o.status === 'PENDING' && <button className="danger ghost" disabled={busy || !reason.trim()} onClick={() => decide('REJECTED')}>Rejeitar</button>}
          {o.status === 'ACTIVE' && <button className="danger ghost" disabled={busy || !reason.trim()} onClick={() => decide('SUSPENDED')}>Suspender</button>}
        </div>
      </>}
    </Panel>
  );
}

const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(14)); return Array.from(b, (x) => a[x % a.length]).join(''); };

/** Cria a empresa (já activa) e o seu administrador. A palavra-passe inicial só é mostrada uma vez. */
function NewOrg({ toast, onClose }: { toast: (m: string, e?: boolean) => void; onClose: () => void }) {
  const [f, setF] = useState({ legalName: '', tradeName: '', nuit: '', adminName: '', adminEmail: '', adminPassword: genPassword() });
  const [done, setDone] = useState<{ slug: string; email: string; password: string } | null>(null);
  const { busy, run } = useAction(toast);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const ready = f.legalName.trim() && f.tradeName.trim() && f.nuit.trim() && f.adminName.trim() && /\S+@\S+\.\S+/.test(f.adminEmail) && f.adminPassword.length >= 8;
  const create = () => run(async () => {
    const r = await api('POST', '/orgs', f);
    const o = await api('GET', `/orgs/${r.id}`);
    setDone({ slug: o.slug, email: f.adminEmail, password: f.adminPassword });
  });
  if (done) {
    const link = `${location.origin}/company/${done.slug}`;
    return (
      <Panel title="Empresa criada" onClose={onClose}>
        <p>A empresa já está <b>activa</b>. Entregue estes dados ao responsável; a palavra-passe <b>não volta a ser mostrada</b>.</p>
        <div className="card flat stack-sm mono">
          <div>Entrada: {link}</div><div>E-mail: {done.email}</div><div>Palavra-passe: {done.password}</div>
        </div>
        <button onClick={() => navigator.clipboard?.writeText(`Entrada: ${link}
E-mail: ${done.email}
Palavra-passe: ${done.password}`)}><Icon n="copy" />Copiar dados</button>
        <button className="ghost" onClick={onClose}>Fechar</button>
      </Panel>
    );
  }
  return (
    <Panel title="Nova empresa" onClose={onClose}>
      <div className="field-row">
        <Field label="Denominação legal"><input value={f.legalName} onChange={set('legalName')} autoFocus /></Field>
        <Field label="Nome comercial"><input value={f.tradeName} onChange={set('tradeName')} /></Field>
      </div>
      <Field label="NUIT"><input inputMode="numeric" value={f.nuit} onChange={set('nuit')} /></Field>
      <h3>Administrador da empresa</h3>
      <div className="field-row">
        <Field label="Nome"><input value={f.adminName} onChange={set('adminName')} /></Field>
        <Field label="E-mail"><input type="email" value={f.adminEmail} onChange={set('adminEmail')} /></Field>
      </div>
      <Field label="Palavra-passe inicial" hint="Gerada automaticamente. O responsável pode alterá-la em «A minha conta»."><div className="inline" style={{ flexWrap: 'nowrap' }}><input value={f.adminPassword} onChange={set('adminPassword')} className="mono" /><button type="button" className="ghost" onClick={() => setF({ ...f, adminPassword: genPassword() })}>Gerar outra</button></div></Field>
      <button className="big wide" disabled={busy || !ready} onClick={create}>{busy ? 'A criar…' : 'Criar empresa'}</button>
    </Panel>
  );
}
