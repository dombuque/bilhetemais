import { useCallback, useEffect, useState } from 'react';
import { api, mt, newKey, toMinor } from '../api';
import { Barcode, ConfirmButton, Empty, Field, Icon, Layout, MoneyInput, PageHead, Pill, Qr, ScanInput, Skeleton, Stepper, TokenCode, nfcSupported, useAction, useToast, writeNfcTag } from '../ui';

type Toast = (m: string, e?: boolean) => void;
const NAV = [{ id: 'sell', label: 'Vender', icon: 'ticket' }, { id: 'wallet', label: 'Carteira', icon: 'wallet' }, { id: 'cash', label: 'Caixa', icon: 'cash' }];

export function Cashier({ me }: { me: any }) {
  const [view, setView] = useState('sell');
  const [events, setEvents] = useState<any[] | null>(null);
  const [eid, setEid] = useState('');
  const [session, setSession] = useState<any>(null);
  const [types, setTypes] = useState<any[]>([]);
  const toast = useToast();
  const { busy, run } = useAction(toast.show);

  useEffect(() => { api('GET', '/events').then((e) => { setEvents(e); if (e[0]) setEid(e[0].id); }); }, []);
  const load = useCallback(async () => {
    if (!eid) return;
    setSession(await api('GET', `/events/${eid}/cashier-sessions/current`));
    setTypes(await api('GET', `/events/${eid}/ticket-types`));
  }, [eid]);
  useEffect(() => { load(); }, [load]);

  return (
    <Layout me={me} nav={NAV} view={view} onView={setView}>
      <PageHead title="Balcão" sub={session ? (session.open ? <><Pill s="ACTIVE" /> Caixa aberta</> : 'Caixa fechada') : undefined}
        actions={events && events.length > 1 ? <select aria-label="Evento" value={eid} onChange={(e) => setEid(e.target.value)}>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select> : undefined} />
      {!events || !session ? <Skeleton rows={4} /> : events.length === 0 ? <Empty icon="ticket">Sem eventos activos na sua empresa.</Empty> : !session.open ? (
        <div className="card stack center"><Icon n="cash" className="icon" /><h2>A caixa está fechada</h2><p className="muted">Abra a caixa para vender bilhetes e receber numerário.</p>
          <button className="big wide" disabled={busy} onClick={() => run(async () => { await api('POST', `/events/${eid}/cashier-sessions/open`, {}); await load(); }, 'Caixa aberta')}>Abrir caixa</button></div>
      ) : <>
        {view === 'sell' && <Sell eid={eid} types={types} onSold={load} toast={toast.show} />}
        {view === 'wallet' && <WalletView eid={eid} onChange={load} toast={toast.show} />}
        {view === 'cash' && <CloseSession eid={eid} expected={session.expectedMinor} onDone={load} toast={toast.show} />}
      </>}
      {toast.node}
    </Layout>
  );
}

function CloseSession({ eid, expected, onDone, toast }: { eid: string; expected: string; onDone: () => void; toast: Toast }) {
  const [counted, setCounted] = useState('');
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useAction(toast);
  if (res) return (
    <div className="card stack center"><Icon n="check" className="icon" /><h2>Caixa fechada</h2>
      <table><tbody><tr><td>Esperado</td><td className="num">{mt(res.expectedMinor)}</td></tr><tr><td>Contado</td><td className="num">{mt(res.countedMinor)}</td></tr>
        <tr><td><b>Diferença</b></td><td className="num"><b>{mt(res.differenceMinor)}</b></td></tr></tbody></table>
      <button className="wide" onClick={onDone}>Concluir</button></div>
  );
  return (
    <div className="card stack">
      <h2>Fecho de caixa</h2>
      <div className="kpi"><span><Icon n="cash" className="" />Numerário esperado</span><b>{mt(expected)}</b></div>
      <Field label="Numerário contado"><MoneyInput value={counted} onChange={setCounted} /></Field>
      <ConfirmButton label="Fechar caixa" confirmLabel="Confirmar fecho" className="danger" disabled={busy || toMinor(counted) === null}
        onConfirm={() => run(async () => { setRes(await api('POST', `/events/${eid}/cashier-sessions/close`, { countedMinor: toMinor(counted) })); })} />
    </div>
  );
}

function Sell({ eid, types, onSold, toast }: { eid: string; types: any[]; onSold: () => void; toast: Toast }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [buyer, setBuyer] = useState('');
  const [format, setFormat] = useState('PHYSICAL');
  const [sale, setSale] = useState<any>(null);
  const { busy, run } = useAction(toast);
  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([ticketTypeId, n]) => ({ ticketTypeId, qty: n }));
  const total = types.reduce((s, t) => s + BigInt(t.price_minor) * BigInt(qty[t.id] ?? 0), 0n);

  if (sale) return (
    <div className="stack">
      <div className="card stack center"><Icon n="check" className="icon" /><h2>Venda registada · {mt(sale.totalMinor)}</h2><p className="muted">Numerário recebido.</p>
        <div className="inline" style={{ justifyContent: 'center' }}><button onClick={() => window.print()}><Icon n="print" />Imprimir bilhetes</button><button className="ghost" onClick={() => setSale(null)}>Nova venda</button></div></div>
      {sale.tickets.map((tk: any, i: number) => <div className="card stack center" key={tk.id}><h3>Bilhete {i + 1}</h3><Qr value={tk.token} label={`QR do bilhete ${i + 1}`} />{tk.format === 'PHYSICAL' && <Barcode value={tk.token} />}<TokenCode value={tk.token} /><p className="muted small mono">{tk.id.slice(0, 8).toUpperCase()}</p></div>)}
      {sale.tickets.map((tk: any) => (
        <div className="ticket-print" key={'p' + tk.id}><h2>Bilhete+</h2><p>{tk.id.slice(0, 8).toUpperCase()}</p><Qr value={tk.token} /><Barcode value={tk.token} /><p className="mono" style={{ fontSize: '.8rem', letterSpacing: '.05em' }}>{tk.token.match(/.{1,4}/g).join(' ')}</p>
          <p>Apresente este bilhete à entrada. Pode carregar saldo no balcão e pagar com este mesmo QR.</p><p><small>Perdeu o bilhete? Dirija-se ao balcão de apoio.</small></p></div>))}
    </div>
  );
  return (
    <div className="stack">
      <div className="card">
        {types.length === 0 ? <Empty icon="ticket">Este evento ainda não tem bilhetes.</Empty> : types.map((t) => (
          <div key={t.id} className="ticket-row"><div><b>{t.name}</b><div className="muted small">{BigInt(t.price_minor) === 0n ? 'Grátis' : mt(t.price_minor)} · {t.available} disponíveis</div></div>
            <Stepper label={`Quantidade ${t.name}`} value={qty[t.id] ?? 0} max={Math.min(20, t.available)} onChange={(n) => setQty({ ...qty, [t.id]: n })} /></div>))}
      </div>
      <div className="card stack">
        <Field label="Nome do comprador"><input value={buyer} onChange={(e) => setBuyer(e.target.value)} autoComplete="off" /></Field>
        <div className="seg" role="radiogroup" aria-label="Formato"><button role="radio" aria-checked={format === 'PHYSICAL'} className={format === 'PHYSICAL' ? 'on' : ''} onClick={() => setFormat('PHYSICAL')}>Impresso (QR)</button><button role="radio" aria-checked={format === 'DIGITAL'} className={format === 'DIGITAL' ? 'on' : ''} onClick={() => setFormat('DIGITAL')}>Digital</button></div>
        <button className="big wide" disabled={busy || !items.length || !buyer.trim()} onClick={() => run(async () => { setSale(await api('POST', `/events/${eid}/counter/sales`, { buyerName: buyer, format, items })); setQty({}); setBuyer(''); onSold(); })}>Receber {mt(total)} em numerário</button>
      </div>
    </div>
  );
}

function WalletView({ eid, onChange, toast }: { eid: string; onChange: () => void; toast: Toast }) {
  const [token, setToken] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [nfc, setNfc] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null); // credencial criada mas ainda por gravar na pulseira
  const { busy, run } = useAction(toast);
  const lookup = useCallback((tk: string) => run(async () => { const r = await api('POST', `/events/${eid}/counter/balance`, { token: tk }); setToken(tk); setBalance(r.balanceMinor); }), [eid, run]);
  const topup = (minor: string | null) => run(async () => {
    if (!minor || minor === '0') throw new Error('Indique um valor válido');
    const r = await api('POST', `/events/${eid}/counter/topup-cash`, { token, amountMinor: minor, idempotencyKey: newKey() });
    setBalance(r.balanceMinor); setAmount(''); onChange();
  }, 'Carregamento registado');
  const cred = (replace: boolean) => run(async () => {
    await api('POST', `/events/${eid}/counter/credentials`, { token, kind: 'NFC', replace, newToken: nfc.trim() });
    setNfc(''); setBalance(null); setToken('');
  }, replace ? 'Credencial substituída; a antiga foi revogada' : 'Cartão/pulseira associado');

  return (
    <div className="stack">
      <div className="card stack"><h2>Identificar o participante</h2><ScanInput onScan={lookup} disabled={busy} autoStart placeholder="Ou escreva / use um leitor" /></div>
      {balance !== null && <>
        <div className="wallet-card"><p style={{ opacity: .85 }}>Saldo</p><div className="balance">{mt(balance)}</div></div>
        <div className="card stack"><h3>Carregar em numerário</h3>
          <div className="chips">{[100, 200, 500, 1000].map((v) => <button key={v} className="ghost" disabled={busy} onClick={() => topup(String(v * 100))}>+ {v} MT</button>)}</div>
          <div className="field-row"><Field label="Outro valor"><MoneyInput value={amount} onChange={setAmount} /></Field><button disabled={busy || !amount} onClick={() => topup(toMinor(amount))}>Receber e carregar</button></div></div>
        <div className="card stack"><h3>Cartão ou pulseira NFC</h3>
          <p className="muted small">Aproxime a credencial do leitor para preencher o campo. Em caso de perda, substituir revoga a antiga e mantém saldo e histórico.</p>
          {nfcSupported() && <div className="card flat stack-sm"><b>Gravar pulseira com o telemóvel</b><p className="muted small">Cria a credencial e grava-a na pulseira ou cartão NFC encostado ao telemóvel.</p>
            {pendingTag ? <button className="big" disabled={busy} onClick={() => run(async () => { await writeNfcTag(pendingTag); setPendingTag(null); setBalance(null); setToken(''); }, 'Pulseira gravada')}>Tentar gravar de novo</button>
              : <button className="big" disabled={busy} onClick={() => run(async () => {
                const r = await api('POST', `/events/${eid}/counter/credentials`, { token, kind: 'NFC', replace: false });
                setPendingTag(r.token);
                await writeNfcTag(r.token);
                setPendingTag(null); setBalance(null); setToken('');
              }, 'Pulseira gravada e associada')}><Icon n="wallet" />Gravar pulseira NFC</button>}</div>}
          <Field label="Ou código lido da credencial (leitor externo)"><input value={nfc} onChange={(e) => setNfc(e.target.value)} autoComplete="off" /></Field>
          <div className="inline"><button disabled={busy || !nfc.trim()} onClick={() => cred(false)}>Associar</button><button className="ghost" disabled={busy || !nfc.trim()} onClick={() => cred(true)}>Substituir a identificada acima</button>
            <ConfirmButton label="Bloquear (perdida)" confirmLabel="Confirmar bloqueio" disabled={busy} onConfirm={() => run(async () => { await api('POST', `/events/${eid}/counter/block`, { token }); setBalance(null); setToken(''); }, 'Credencial bloqueada')} /></div></div>
      </>}
    </div>
  );
}
