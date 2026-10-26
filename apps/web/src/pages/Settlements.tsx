import { useCallback, useEffect, useState } from 'react';
import { api, download, mt } from '../api';
import { Empty, Field, Icon, Modal, MoneyInput, Skeleton, useAction } from '../ui';
import { toMinor } from '../api';

type Toast = (m: string, e?: boolean) => void;

/** Acertos com comerciantes: vendas, comissão, valor devido, pagamentos e em dívida. */
export function SettlementsTab({ id, toast }: { id: string; toast: Toast }) {
  const [data, setData] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction(toast);
  const load = useCallback(async () => setData(await api('GET', `/events/${id}/settlements`)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Skeleton rows={4} />;
  const t = data.totals;
  const exp = (what: string, name: string) => run(() => download(`/events/${id}/export/${what}`, name));

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><span><Icon n="cart" className="" />Vendas líquidas</span><b>{mt(t.netMinor)}</b></div>
        <div className="kpi"><span><Icon n="cash" className="" />Comissão retida</span><b>{mt(t.commissionMinor)}</b></div>
        <div className="kpi"><span><Icon n="store" className="" />Devido aos comerciantes</span><b>{mt(t.dueMinor)}</b></div>
        <div className="kpi"><span><Icon n="check" className="" />Em dívida</span><b>{mt(t.outstandingMinor)}</b><small>já pago {mt(t.paidMinor)}</small></div>
      </div>
      <div className="card">
        <div className="between" style={{ marginBottom: 8 }}><h2>Por comerciante</h2>
          <span className="inline"><button className="ghost sm" disabled={busy} onClick={() => exp('settlements', 'acertos.csv')}><Icon n="arrowdown" />Acertos CSV</button>
            <button className="ghost sm" disabled={busy} onClick={() => exp('ledger', 'movimentos.csv')}><Icon n="arrowdown" />Movimentos CSV</button>
            <button className="ghost sm" disabled={busy} onClick={() => exp('tickets', 'bilhetes.csv')}><Icon n="arrowdown" />Bilhetes CSV</button></span></div>
        {data.merchants.length === 0 ? <Empty icon="store">Sem comerciantes neste evento.</Empty> : (
          <table className="resp"><thead><tr><th>Comerciante</th><th className="num">Líquido</th><th className="num">Comissão</th><th className="num">Devido</th><th className="num">Pago</th><th className="num">Em dívida</th><th /></tr></thead>
            <tbody>{data.merchants.map((m: any) => (
              <tr key={m.merchantId}><td data-l="Comerciante"><b>{m.name}</b></td><td className="num" data-l="Líquido">{mt(m.netMinor)}</td>
                <td className="num" data-l="Comissão">{mt(m.commissionMinor)}<br /><button className="ghost sm" style={{ minHeight: 28 }} onClick={() => setEdit(m)}>{(m.commissionBps / 100).toString().replace('.', ',')}%</button></td>
                <td className="num" data-l="Devido">{mt(m.dueMinor)}</td><td className="num" data-l="Pago">{mt(m.paidMinor)}</td><td className="num" data-l="Em dívida"><b>{mt(m.outstandingMinor)}</b></td>
                <td className="nolabel"><button className="sm" disabled={BigInt(m.outstandingMinor) <= 0n} onClick={() => setPay(m)}>Registar pagamento</button></td></tr>))}</tbody></table>)}
        <p className="muted small" style={{ marginTop: 10 }}>Valor devido = vendas − devoluções − comissão. Os saldos dos participantes não são receita do organizador.</p>
      </div>
      {pay && <PayModal m={pay} id={id} toast={toast} onClose={() => setPay(null)} onDone={() => { setPay(null); load(); }} />}
      {edit && <CommissionModal m={edit} toast={toast} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function PayModal({ m, id, toast, onClose, onDone }: { m: any; id: string; toast: Toast; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(Number(BigInt(m.outstandingMinor)) / 100));
  const [ref, setRef] = useState('');
  const { busy, run } = useAction(toast);
  return (
    <Modal title={`Pagar a ${m.name}`} onClose={onClose}>
      <p className="muted">Em dívida: <b>{mt(m.outstandingMinor)}</b></p>
      <Field label="Valor pago"><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="Referência" hint="Ex.: número da transferência ou do M-Pesa."><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <button className="big wide" disabled={busy || !toMinor(amount)} onClick={() => run(async () => { await api('POST', `/events/${id}/settlements/${m.merchantId}/payouts`, { amountMinor: toMinor(amount), reference: ref }); onDone(); }, 'Pagamento registado')}>Registar pagamento</button>
    </Modal>
  );
}

function CommissionModal({ m, toast, onClose, onDone }: { m: any; toast: Toast; onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState(String(m.commissionBps / 100));
  const { busy, run } = useAction(toast);
  return (
    <Modal title={`Comissão · ${m.name}`} onClose={onClose}>
      <Field label="Percentagem retida" hint="Deixe em branco para usar a do evento."><div className="money"><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /><span>%</span></div></Field>
      <button className="big wide" disabled={busy} onClick={() => run(async () => { await api('PUT', `/merchants/${m.merchantId}/commission`, { bps: pct === '' ? null : Math.round(parseFloat(pct.replace(',', '.')) * 100) }); onDone(); }, 'Comissão actualizada')}>Guardar</button>
    </Modal>
  );
}
