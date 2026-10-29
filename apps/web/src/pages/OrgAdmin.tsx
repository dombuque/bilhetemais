import { locale } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { api, dt, eventUrl, mt, toMinor } from '../api';
import { BarRow, ConfirmButton, Empty, Field, Icon, Layout, Modal, MoneyInput, PageHead, Pill, Skeleton, useAction, useToast } from '../ui';
import { BrandEditor } from './Brand';
import { Company } from './Company';
import { Team } from './Team';
import { Activity } from './Activity';
import { SettlementsTab } from './Settlements';
import { ContentTab } from './Content';
import { SettingsTab } from './Settings';
import { PosterQr } from './Extras';
import { TicketControl } from './TicketControl';

type Toast = (m: string, e?: boolean) => void;

export function OrgAdmin({ me }: { me: any }) {
  const [view, setView] = useState('events');
  const [sel, setSel] = useState<string | null>(null);
  const toast = useToast();
  const nav = [{ id: 'events', label: 'Eventos', icon: 'ticket' }, { id: 'team', label: 'Equipa', icon: 'users' }, { id: 'activity', label: 'Actividade', icon: 'chart' }, { id: 'company', label: 'Empresa', icon: 'building' }];
  return (
    <Layout me={me} nav={nav} view={view} onView={(v) => { setView(v); setSel(null); }}>
      {view === 'team' ? <Team me={me} toast={toast.show} />
        : view === 'activity' ? <Activity />
        : view === 'company' ? <><PageHead title="Empresa" /><Company toast={toast.show} /></>
        : sel ? <EventAdmin id={sel} back={() => setSel(null)} toast={toast.show} onOpen={setSel} />
          : <Events onOpen={setSel} toast={toast.show} />}
      {toast.node}
    </Layout>
  );
}

function Events({ onOpen, toast }: { onOpen: (id: string) => void; toast: Toast }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [create, setCreate] = useState(false);
  const [base, setBase] = useState<string | null>(null);
  const load = useCallback(() => api('GET', '/events').then(setEvents), []);
  useEffect(() => { load(); fetch('/public/config').then((r) => r.json()).then((c) => setBase(c.baseDomain)); }, [load]);
  return (
    <>
      <PageHead title="Eventos" actions={<button onClick={() => setCreate(true)}><Icon n="plus" />Novo evento</button>} />
      {!events ? <Skeleton rows={3} /> : events.length === 0 ? (
        <div className="card stack center" style={{ padding: 40 }}><Empty icon="ticket">Ainda não tem eventos. Crie o primeiro para começar a vender bilhetes.</Empty><button className="big" style={{ justifySelf: 'center' }} onClick={() => setCreate(true)}><Icon n="plus" />Criar o primeiro evento</button></div>
      ) : (
        <div className="grid two">{events.map((e) => {
          const d = new Date(e.starts_at);
          const pct = e.capacity ? Math.min(100, Math.round((e.sold / e.capacity) * 100)) : 0;
          return (
            <button key={e.id} className="card hover" onClick={() => onOpen(e.id)} style={{ textAlign: 'left', display: 'block', color: 'inherit', background: 'var(--surface)', borderColor: 'var(--line)', padding: 0, overflow: 'hidden', minHeight: 0 }}>
              <div style={{ height: 8, background: `linear-gradient(90deg, ${e.theme?.primary ?? 'var(--brand)'}, ${e.theme?.accent ?? 'var(--accent)'})` }} />
              <div style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ textAlign: 'center', minWidth: 58, padding: '8px 0', borderRadius: 14, background: 'var(--surface-2)' }}>
                  <div style={{ font: '800 1.5rem/1 var(--font-display)' }}>{d.getDate()}</div>
                  <div className="eyebrow" style={{ marginTop: 4 }}>{d.toLocaleDateString(locale(), { month: 'short' }).replace('.', '')}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
                  <div className="between" style={{ alignItems: 'flex-start' }}><h3 style={{ fontSize: '1.1rem' }}>{e.name}</h3><Pill s={e.status} /></div>
                  <p className="muted small">{e.location ?? 'Sem local definido'}</p>
                  <p className="small" style={{ color: 'var(--brand-text)', fontWeight: 600 }}>{e.subdomain}{base ? `.${base}` : ''}</p>
                  <div><div className="between small"><span className="muted">Bilhetes vendidos</span><b>{e.sold}/{e.capacity}</b></div><div className="track" style={{ marginTop: 6 }}><div className="fill" style={{ width: `${pct}%` }} /></div></div>
                </div>
              </div>
            </button>);
        })}</div>
      )}
      {create && <NewEvent events={events ?? []} toast={toast} onClose={() => setCreate(false)} onCreated={(id) => { setCreate(false); onOpen(id); }} />}
    </>
  );
}

function NewEvent({ events, toast, onClose, onCreated }: { events: any[]; toast: Toast; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: '', startsAt: '', endsAt: '', location: '', description: '', category: '' });
  const [sub, setSub] = useState('');            // endereço curto escolhido (vazio = acompanha o nome)
  const [subEdited, setSubEdited] = useState(false);
  const [chk, setChk] = useState<{ slug: string; available: boolean; reason: string | null; suggestion: string | null } | null>(null);
  const [from, setFrom] = useState('');
  const [inherit, setInherit] = useState(true);
  const [copy, setCopy] = useState<string[]>(['ticketTypes', 'gates']);
  const { busy, run } = useAction(toast);
  // o endereço sugere-se a partir do nome, a menos que a pessoa o tenha escrito; verifica-se se está livre
  useEffect(() => { if (!subEdited) setSub(f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)); }, [f.name, subEdited]);
  useEffect(() => {
    if (!sub) { setChk(null); return; }
    const t = setTimeout(() => api('GET', `/events/subdomain-check?q=${encodeURIComponent(sub)}`).then(setChk).catch(() => setChk(null)), 300);
    return () => clearTimeout(t);
  }, [sub]);
  const toggle = (k: string) => setCopy((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  return (
    <Modal title="Novo evento" onClose={onClose}>
      <Field label="Nome"><input value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Endereço curto do evento" hint="Será o endereço público do evento. Só letras, números e hífens; tem de ser único.">
        <div className="sub-input"><input value={sub} maxLength={36} autoCapitalize="off" spellCheck={false} placeholder="feira-de-maputo" onChange={(e) => { setSubEdited(true); setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} /><span className="mono">.{location.hostname.split('.').slice(-2).join('.')}</span></div>
      </Field>
      {sub && chk && (chk.available
        ? <p className="sub-ok" role="status"><Icon n="check" /> <b>{chk.slug}</b> está livre</p>
        : <p className="sub-bad" role="alert">{chk.reason === 'curto' ? 'Use pelo menos 3 letras ou números.' : chk.reason === 'reservado' ? 'Este endereço é reservado.' : 'Este endereço já está em uso.'}{chk.suggestion && <> Sugestão: <button type="button" className="ghost sm" onClick={() => { setSubEdited(true); setSub(chk.suggestion!); }}>{chk.suggestion}</button></>}</p>)}
      <div className="field-row">
        <Field label="Início"><input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Fim"><input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
      </div>
      <Field label="Categoria"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Sem categoria</option>{[['MUSICA', 'Música'], ['FESTIVAL', 'Festival'], ['CONFERENCIA', 'Conferência'], ['FEIRA', 'Feira'], ['DESPORTO', 'Desporto'], ['TEATRO', 'Teatro'], ['GASTRONOMIA', 'Gastronomia'], ['EMPRESARIAL', 'Empresarial'], ['OUTRO', 'Outro']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Local"><input value={f.location} placeholder="Ex.: Estádio da Machava, Maputo" onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      {events.length > 0 && (
        <div className="card flat stack-sm">
          <Field label="Basear noutro evento" hint="Reaproveite bilhetes, portas e comerciantes, e herde parâmetros e aparência."><select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Começar do zero</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          {from && <>
            <label className="inline"><input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} /><span>Herdar parâmetros e aparência (acompanha o evento original)</span></label>
            {([['ticketTypes', 'Copiar tipos de bilhete'], ['gates', 'Copiar portas'], ['merchants', 'Copiar comerciantes e produtos']] as const).map(([k, l]) => (
              <label key={k} className="inline"><input type="checkbox" checked={copy.includes(k)} onChange={() => toggle(k)} /><span>{l}</span></label>))}
          </>}
        </div>
      )}
      <button className="big wide" disabled={busy || !f.name || !f.startsAt || !f.endsAt || (!!sub && chk !== null && !chk.available)} onClick={() => run(async () => {
        const r = await api('POST', '/events', { ...f, ...(sub ? { subdomain: sub } : {}), startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), ...(from ? { inheritFrom: from, inherit, copy } : {}) });
        onCreated(r.id);
      }, 'Evento criado')}>Criar evento</button>
    </Modal>
  );
}

const TABS = ['Resumo', 'Bilhetes', 'Comerciantes', 'Portas', 'Acertos', 'Reembolsos', 'Conteúdo', 'Parâmetros', 'Aparência'] as const;

function EventAdmin({ id, back, toast, onOpen }: { id: string; back: () => void; toast: Toast; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Resumo');
  const [ov, setOv] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const { busy, run } = useAction(toast);
  const load = useCallback(async () => {
    const [o, r, s, a] = await Promise.all([api('GET', `/events/${id}/overview`), api('GET', `/events/${id}/report`), api('GET', '/events'), api('GET', `/events/${id}/alerts`)]);
    setOv(o); setRep(r); setSiblings(s); setAlerts(a);
  }, [id]);
  useEffect(() => { setOv(null); load(); }, [load]);
  const act = (fn: () => Promise<unknown>, ok: string) => run(async () => { await fn(); await load(); }, ok);
  if (!ov || !rep) return <Skeleton rows={5} />;
  const ev = ov.event;
  const url = eventUrl(ev.subdomain);

  return (
    <>
      <a href="#back" onClick={(e) => { e.preventDefault(); back(); }} className="crumb"><Icon n="back" />Eventos</a>
      <PageHead title={ev.name} sub={<><Pill s={ev.status} /> · {dt(ev.starts_at)}{ov.parent && <> · herda de <a href="#parent" onClick={(e) => { e.preventDefault(); onOpen(ov.parent.id); }}>{ov.parent.name}</a></>}</>}
        actions={<>
          <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Ver página pública</a>
          {ev.status !== 'PUBLISHED' && <button disabled={busy} onClick={() => act(() => api('POST', `/events/${id}/publish`, {}), 'Evento publicado')}>Publicar</button>}
        </>} />
      <div className="seg scroll" role="tablist" style={{ marginBottom: 18 }}>{TABS.map((t) => <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === 'Resumo' && <Summary ov={ov} rep={rep} url={url} alerts={alerts} />}
      {tab === 'Bilhetes' && <div className="stack"><Tickets ov={ov} id={id} act={act} busy={busy} /><TicketControl id={id} toast={toast} /></div>}
      {tab === 'Comerciantes' && <Merchants ov={ov} id={id} act={act} busy={busy} />}
      {tab === 'Portas' && <div className="card stack">
        {ov.gates.length === 0 ? <Empty icon="door">Sem portas. Crie pelo menos uma para o controlo de acessos.</Empty> : <ul style={{ margin: 0, paddingLeft: 20 }}>{ov.gates.map((g: any) => <li key={g.id}>{g.name}</li>)}</ul>}
        <Inline label="Nova porta" button="Adicionar" onSave={(name) => act(() => api('POST', `/events/${id}/gates`, { name }), 'Porta criada')} />
      </div>}
      {tab === 'Acertos' && <SettlementsTab id={id} toast={toast} />}
      {tab === 'Reembolsos' && <Refunds ov={ov} act={act} busy={busy} />}
      {tab === 'Conteúdo' && <ContentTab id={id} ev={ev} toast={toast} onChange={load} />}
      {tab === 'Parâmetros' && <SettingsTab id={id} ov={ov} siblings={siblings.filter((e) => e.id !== id)} toast={toast} onChange={load} />}
      {tab === 'Aparência' && <BrandEditor base={`/events/${id}`} theme={ev.theme} assets={ov.ownAssets} inherited={ov.inheritedTheme} onChange={load} toast={toast} />}
    </>
  );
}

const K = ({ l, v, icon, sub }: { l: string; v: any; icon: string; sub?: string }) => <div className="kpi"><span><Icon n={icon} className="" />{l}</span><b>{v}</b>{sub && <small>{sub}</small>}</div>;

function Summary({ ov, rep, url, alerts }: { ov: any; rep: any; url: string; alerts: any[] }) {
  const [poster, setPoster] = useState(false);
  const diff = BigInt(rep.reconciliation.differenceMinor);
  const maxSales = Math.max(1, ...rep.merchants.map((m: any) => Number(BigInt(m.salesMinor))));
  return (
    <div className="stack">
      {alerts.length > 0 && <div className="card stack-sm" style={{ borderColor: 'var(--warn)' }}><h3>Alertas</h3>{alerts.map((a, i) => <p key={i} className="inline"><span className={'pill ' + (a.level === 'bad' ? 'bad' : 'warn')}>{a.level === 'bad' ? 'Crítico' : 'Atenção'}</span><span>{a.text}</span></p>)}</div>}
      <div className="kpis">
        <K l="Bilhetes emitidos" v={rep.tickets.issued} icon="ticket" /><K l="Entradas" v={rep.tickets.entered} icon="door" sub={rep.tickets.issued ? `${Math.round((rep.tickets.entered / rep.tickets.issued) * 100)}% dos emitidos` : undefined} />
        <K l="Receita de bilhética" v={mt(rep.tickets.revenueMinor)} icon="cash" /><K l="Carregamentos" v={mt(rep.wallets.topupsMinor)} icon="wallet" />
        <K l="Pagamentos" v={mt(rep.wallets.paymentsMinor)} icon="cart" /><K l="Saldo em circulação" v={mt(rep.wallets.balanceInCirculationMinor)} icon="chart" sub="fundos dos participantes" />
      </div>
      <div className="grid two">
        <div className="card"><h2 style={{ marginBottom: 8 }}>Vendas por comerciante</h2>
          {rep.merchants.length === 0 ? <Empty icon="store">Sem comerciantes.</Empty> : rep.merchants.map((m: any) => <BarRow key={m.name} label={m.name} value={Number(BigInt(m.salesMinor))} max={maxSales} text={mt(m.salesMinor)} />)}</div>
        <div className="card"><div className="between"><h2>Reconciliação</h2>{diff === 0n ? <Pill s="CONFIRMED" /> : <span className="pill bad">Diferença {mt(diff)}</span>}</div>
          <table><tbody>
            <tr><td>Carregamentos no ledger</td><td className="num">{mt(rep.reconciliation.ledgerTopupsMinor)}</td></tr>
            <tr><td>Digitais confirmados</td><td className="num">{mt(rep.reconciliation.digitalConfirmedMinor)}</td></tr>
            <tr><td>Numerário nos balcões</td><td className="num">{mt(rep.reconciliation.cashMinor)}</td></tr></tbody></table>
          <p className="muted small" style={{ marginTop: 8 }}>Carregamentos e saldos não são receita do organizador: são fundos dos participantes.</p></div>
      </div>
      <div className="card stack-sm"><div className="between"><div><h3>Divulgação</h3><p className="muted small">{url}</p></div>
        <span className="inline"><button className="ghost sm" onClick={() => navigator.clipboard?.writeText(url)}><Icon n="copy" />Copiar ligação</button><button className="ghost sm" onClick={() => setPoster(!poster)}><Icon n="qr" />Cartaz com QR</button></span></div>
        {poster && <><PosterQr url={url} name={ov.event.name} /><button className="ghost" onClick={() => window.print()}><Icon n="print" />Imprimir cartaz</button></>}</div>
    </div>
  );
}

function Inline({ label, button, onSave }: { label: string; button: string; onSave: (v: string) => unknown }) {
  const [v, setV] = useState('');
  return <div className="field-row"><Field label={label}><input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && (onSave(v.trim()), setV(''))} /></Field><button disabled={!v.trim()} onClick={() => { onSave(v.trim()); setV(''); }}>{button}</button></div>;
}

function Tickets({ ov, id, act, busy }: { ov: any; id: string; act: (fn: () => Promise<unknown>, ok: string) => unknown; busy: boolean }) {
  const single = ov.settings.effective.ticketCategories === 'single';
  const [f, setF] = useState({ name: single ? 'Entrada' : '', kind: 'GENERAL', price: '', quantity: '' });
  return (
    <div className="stack">
      <div className="card">
        {ov.ticketTypes.length === 0 ? <Empty icon="ticket">Ainda sem bilhetes. Adicione o primeiro abaixo.</Empty> : ov.ticketTypes.map((t: any) => (
          <div key={t.id} style={{ marginBottom: 10 }}><div className="between"><span><b>{t.name}</b> {!single && t.kind !== 'GENERAL' && <span className="pill">{t.kind}</span>}</span><span className="muted">{BigInt(t.price_minor) === 0n ? 'Grátis' : mt(t.price_minor)}</span></div>
            <BarRow label="Vendidos" value={t.sold} max={t.quantity} text={`${t.sold}/${t.quantity}`} /></div>))}
      </div>
      <div className="card stack"><h3>{single ? 'Novo bilhete' : 'Novo tipo de bilhete'}</h3>
        <p className="muted small">{single ? 'Este evento não distingue categorias: todos os bilhetes são iguais em termos de acesso.' : 'Pode criar categorias (geral, VIP, imprensa…) ou apenas um bilhete único.'}</p>
        <div className="field-row">
          <Field label="Nome"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          {!single && <Field label="Categoria"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{[['GENERAL', 'Geral'], ['VIP', 'VIP'], ['GUEST', 'Convidado'], ['PRESS', 'Imprensa'], ['STAFF', 'Equipa'], ['FREE', 'Gratuito'], ['PROMO', 'Promocional']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
          <Field label="Preço"><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} placeholder="0 = grátis" /></Field>
          <Field label="Quantidade"><input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        </div>
        <button disabled={busy || !f.name || toMinor(f.price || '0') === null || !f.quantity} onClick={() => { act(() => api('POST', `/events/${id}/ticket-types`, { name: f.name, kind: single ? 'GENERAL' : f.kind, priceMinor: toMinor(f.price || '0'), quantity: Number(f.quantity) }), 'Bilhete criado'); setF({ name: single ? 'Entrada' : '', kind: 'GENERAL', price: '', quantity: '' }); }}>Adicionar</button>
      </div>
    </div>
  );
}

function Merchants({ ov, id, act, busy }: { ov: any; id: string; act: (fn: () => Promise<unknown>, ok: string) => unknown; busy: boolean }) {
  const [p, setP] = useState<Record<string, { name: string; price: string }>>({});
  return (
    <div className="stack">
      {ov.merchants.map((m: any) => {
        const d = p[m.id] ?? { name: '', price: '' };
        return (
          <div className="card stack" key={m.id}><h3>{m.name}</h3>
            {m.products.length === 0 ? <p className="muted small">Sem produtos.</p> : <table><tbody>{m.products.map((x: any) => <tr key={x.id}><td>{x.name}</td><td className="num">{mt(x.price_minor)}</td></tr>)}</tbody></table>}
            <div className="field-row"><Field label="Produto"><input value={d.name} onChange={(e) => setP({ ...p, [m.id]: { ...d, name: e.target.value } })} /></Field>
              <Field label="Preço"><MoneyInput value={d.price} onChange={(v) => setP({ ...p, [m.id]: { ...d, price: v } })} /></Field>
              <button disabled={busy || !d.name || !toMinor(d.price)} onClick={() => { act(() => api('POST', `/merchants/${m.id}/products`, { name: d.name, priceMinor: toMinor(d.price) }), 'Produto adicionado'); setP({ ...p, [m.id]: { name: '', price: '' } }); }}>Adicionar</button></div>
          </div>);
      })}
      <div className="card"><Inline label="Novo comerciante (bar, banca, merchandising…)" button="Criar" onSave={(name) => act(() => api('POST', `/events/${id}/merchants`, { name }), 'Comerciante criado')} /></div>
    </div>
  );
}

function Refunds({ ov, act, busy }: { ov: any; act: (fn: () => Promise<unknown>, ok: string) => unknown; busy: boolean }) {
  const allowed = ov.settings.effective.balanceRefundAllowed;
  return (
    <div className="card stack">
      <p className="muted">Reembolso do saldo não gasto: <b>{allowed ? 'permitido' : 'não permitido'}</b> neste evento (altere em Parâmetros).</p>
      {ov.refundRequests.length === 0 ? <Empty icon="refund">Sem pedidos de reembolso.</Empty> : (
        <table className="resp"><thead><tr><th>Pedido</th><th className="num">Valor</th><th>Estado</th><th /></tr></thead>
          <tbody>{ov.refundRequests.map((r: any) => (
            <tr key={r.id}><td data-l="Pedido">{dt(r.created_at)}</td><td className="num" data-l="Valor">{mt(r.amount_minor)}</td><td data-l="Estado"><Pill s={r.status} /></td>
              <td className="nolabel">{r.status === 'PENDING' && <span className="inline"><button className="sm" disabled={busy} onClick={() => act(() => api('POST', `/refund-requests/${r.id}/decide`, { approve: true }), 'Aprovado')}>Aprovar</button>
                <ConfirmButton label="Rejeitar" confirmLabel="Confirmar rejeição" disabled={busy} onConfirm={() => act(() => api('POST', `/refund-requests/${r.id}/decide`, { approve: false }), 'Rejeitado')} className="danger ghost sm" /></span>}</td></tr>))}</tbody></table>)}
    </div>
  );
}
