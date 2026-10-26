import { useEffect, useState, type ReactNode } from 'react';
import { api, mt } from '../api';
import { Field, MoneyInput, useAction } from '../ui';

type Toast = (m: string, e?: boolean) => void;
type Draft = Record<string, any>;

/** Pequeno interruptor acessível. */
const Switch = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="ghost" style={{ minWidth: 64, background: on ? 'var(--brand)' : 'var(--surface-2)', color: on ? 'var(--brand-ink)' : 'var(--muted)', borderColor: on ? 'var(--brand)' : 'var(--line)' }}>{on ? 'Sim' : 'Não'}</button>
);

/** Parâmetros do evento. Cada um pode ser definido aqui ou herdado do evento-pai / valores padrão. */
export function SettingsTab({ id, ov, siblings, toast, onChange }: { id: string; ov: any; siblings: any[]; toast: Toast; onChange: () => void }) {
  const { effective, sources, own } = ov.settings;
  const [d, setD] = useState<Draft>(own);
  const { busy, run } = useAction(toast);
  useEffect(() => setD(own), [own]);
  const dirty = JSON.stringify(d) !== JSON.stringify(own);

  const origin = (k: string) => (k in d ? <span className="pill ok">Definido neste evento</span> : sources[k] ? <span className="pill warn">Herdado de {sources[k]}</span> : <span className="pill">Valor padrão</span>);
  const value = (k: string) => (k in d ? d[k] : effective[k]);
  const set = (k: string, v: any) => setD((x) => ({ ...x, [k]: v }));
  const unset = (k: string) => setD((x) => { const { [k]: _, ...rest } = x; return rest; });
  const minorField = (k: string, empty: string) => (
    <MoneyInput value={k in d ? String(d[k] / 100) : ''} placeholder={effective[k] ? `${effective[k] / 100}` : empty} onChange={(v) => (v === '' ? unset(k) : /^\d+([.,]\d{0,2})?$/.test(v) && set(k, Math.round(parseFloat(v.replace(',', '.')) * 100)))} />
  );
  const Row = ({ k, title, hint, children }: { k: string; title: string; hint?: string; children: ReactNode }) => (
    <div className="between" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 240px' }}><b>{title}</b>{hint && <p className="muted small">{hint}</p>}<div style={{ marginTop: 4 }}>{origin(k)} {k in d && <button className="ghost sm" onClick={() => unset(k)}>Repor herança</button>}</div></div>
      <div style={{ flex: '0 1 220px', minWidth: 140 }}>{children}</div>
    </div>
  );

  const parentId = ov.parent?.id ?? '';
  return (
    <div className="stack">
      <div className="card stack-sm">
        <h3>Herança</h3>
        <p className="muted small">Este evento pode herdar parâmetros e aparência de outro evento da empresa. O que definir aqui substitui o herdado; o resto acompanha o evento original.</p>
        <Field label="Herda de"><select value={parentId} onChange={(e) => run(async () => { await api('PUT', `/events/${id}/parent`, { parentId: e.target.value || null }); onChange(); }, 'Herança actualizada')}>
          <option value="">Nenhum (parâmetros próprios)</option>{siblings.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>

      <div className="card">
        <h3>Bilhetes</h3>
        <Row k="ticketCategories" title="Categorias de bilhete" hint="«Bilhete único» para eventos sem distinção (sem VIP, geral, etc.).">
          <select value={value('ticketCategories')} onChange={(e) => set('ticketCategories', e.target.value)}><option value="multiple">Várias categorias</option><option value="single">Bilhete único</option></select></Row>
        <Row k="maxTicketsPerOrder" title="Máximo de bilhetes por compra"><input type="number" min={1} max={50} value={value('maxTicketsPerOrder')} onChange={(e) => set('maxTicketsPerOrder', Number(e.target.value))} /></Row>
        <Row k="onlineSalesEnabled" title="Venda online"><Switch label="Venda online" on={value('onlineSalesEnabled')} onChange={(v) => set('onlineSalesEnabled', v)} /></Row>
        <Row k="counterSalesEnabled" title="Venda no balcão"><Switch label="Venda no balcão" on={value('counterSalesEnabled')} onChange={(v) => set('counterSalesEnabled', v)} /></Row>
      </div>

      <div className="card">
        <h3>Carteira cashless</h3>
        <Row k="walletEnabled" title="Carteira activa" hint="Desligue em eventos que só vendem bilhetes."><Switch label="Carteira activa" on={value('walletEnabled')} onChange={(v) => set('walletEnabled', v)} /></Row>
        <Row k="minTopupMinor" title="Carregamento mínimo">{minorField('minTopupMinor', 'sem mínimo')}</Row>
        <Row k="maxTopupMinor" title="Carregamento máximo">{minorField('maxTopupMinor', 'sem limite')}</Row>
        <Row k="maxBalanceMinor" title="Saldo máximo por carteira">{minorField('maxBalanceMinor', 'sem limite')}</Row>
        <Row k="balanceRefundAllowed" title="Reembolso do saldo não gasto" hint="Permite aos participantes pedirem a devolução do saldo."><Switch label="Reembolso de saldo" on={value('balanceRefundAllowed')} onChange={(v) => set('balanceRefundAllowed', v)} /></Row>
      </div>

      <div className="card">
        <h3>Comerciantes</h3>
        <Row k="merchantCommissionBps" title="Comissão sobre as vendas dos comerciantes" hint="Percentagem retida pelo organizador. Cada comerciante pode ter a sua (aba Acertos).">
          <div className="money"><input inputMode="decimal" value={'merchantCommissionBps' in d ? String(d.merchantCommissionBps / 100) : ''} placeholder={String((effective.merchantCommissionBps ?? 0) / 100)} aria-label="Comissão em percentagem"
            onChange={(e) => (e.target.value === '' ? unset('merchantCommissionBps') : /^\d{1,3}([.,]\d{0,2})?$/.test(e.target.value) && set('merchantCommissionBps', Math.min(10000, Math.round(parseFloat(e.target.value.replace(',', '.')) * 100))))} /><span>%</span></div></Row>
      </div>

      <div className="card">
        <h3>Acessos</h3>
        <Row k="reentryAllowed" title="Reentrada permitida" hint="Se desligado, cada bilhete só entra uma vez."><Switch label="Reentrada" on={value('reentryAllowed')} onChange={(v) => set('reentryAllowed', v)} /></Row>
      </div>

      <div className="inline"><button disabled={busy || !dirty} onClick={() => run(async () => { await api('PUT', `/events/${id}/settings`, d); onChange(); }, 'Parâmetros guardados')}>Guardar parâmetros</button>
        {dirty && <button className="ghost" onClick={() => setD(own)}>Descartar alterações</button>}
        <span className="muted small">Saldo máximo e limites aplicam-se a novos carregamentos. Valores actuais: mínimo {mt(effective.minTopupMinor)}.</span></div>
    </div>
  );
}
