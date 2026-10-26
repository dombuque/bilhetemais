import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dt, mt, newKey } from '../api';
import { ConfirmButton, Empty, FullResult, Icon, Layout, Modal, PageHead, ScanInput, Skeleton, useAction, useToast } from '../ui';

const NAV = [{ id: 'sell', label: 'Vender', icon: 'cart' }, { id: 'sales', label: 'Vendas', icon: 'chart' }];

export function Pos({ me }: { me: any }) {
  const [view, setView] = useState('sell');
  const [products, setProducts] = useState<any[] | null>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<{ kind: string; title: string; detail?: string } | null>(null);
  // a mesma chave é reutilizada nas retentativas do mesmo carrinho: uma falha de rede nunca duplica o débito
  const key = useRef(newKey());
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const load = useCallback(async () => { setProducts(await api('GET', '/pos/products')); setSales(await api('GET', '/pos/sales')); }, []);
  useEffect(() => { load(); }, [load]);

  const lines = (products ?? []).filter((p) => cart[p.id]);
  const total = lines.reduce((s, p) => s + BigInt(p.price_minor) * BigInt(cart[p.id]), 0n);
  const count = lines.reduce((n, p) => n + cart[p.id], 0);
  const add = (id: string, d: number) => { key.current = newKey(); setCart((c) => { const n = Math.max(0, (c[id] ?? 0) + d); const { [id]: _, ...rest } = c; return n ? { ...rest, [id]: n } : rest; }); };

  const pay = async (token: string) => {
    if (!lines.length) return;
    setPaying(false);
    try {
      const r = await api('POST', '/pos/pay', { token, idempotencyKey: key.current, items: lines.map((p) => ({ productId: p.id, qty: cart[p.id] })) });
      setResult({ kind: 'OK', title: `Pago · ${mt(r.totalMinor)}`, detail: `Saldo restante ${mt(r.balanceMinor)}` });
      setCart({}); key.current = newKey(); load();
    } catch (e: any) { setResult({ kind: 'FAIL', title: 'Pagamento recusado', detail: e.message }); }
  };

  return (
    <Layout me={me} nav={NAV} view={view} onView={setView}>
      <PageHead title={me.merchantName} sub="Ponto de venda" />
      {!products ? <Skeleton rows={4} /> : view === 'sell' ? (
        <div className="pos-grid">
          <div className="card"><h2 style={{ marginBottom: 10 }}>Produtos</h2>
            {products.length === 0 ? <Empty icon="box">Sem produtos. Peça ao organizador para os configurar.</Empty> : (
              <div className="products">{products.map((p) => (
                <button key={p.id} className="product" onClick={() => add(p.id, 1)}><span className="mark">{p.name.trim()[0]?.toUpperCase()}</span><b>{p.name}</b><span className="p">{mt(p.price_minor)}</span>{cart[p.id] && <i className="qty" style={{ fontStyle: 'normal' }}>{cart[p.id]}</i>}</button>))}</div>)}</div>
          <div className="card stack" style={{ position: 'sticky', top: 16 }}>
            <div className="between"><h2>Conta</h2>{count > 0 && <ConfirmButton label="Limpar" confirmLabel="Limpar tudo" className="ghost sm" onConfirm={() => { setCart({}); key.current = newKey(); }} />}</div>
            {lines.length === 0 ? <p className="muted">Toque nos produtos para adicionar.</p> : lines.map((p) => (
              <div className="cart-line" key={p.id}><span>{cart[p.id]} × {p.name}<br /><small className="muted">{mt(BigInt(p.price_minor) * BigInt(cart[p.id]))}</small></span>
                <span className="inline" style={{ gap: 4 }}><button className="ghost sm" aria-label={`Menos ${p.name}`} onClick={() => add(p.id, -1)}><Icon n="minus" /></button><button className="ghost sm" aria-label={`Mais ${p.name}`} onClick={() => add(p.id, 1)}><Icon n="plus" /></button></span></div>))}
            <div className="total-line"><span>Total</span><span>{mt(total)}</span></div>
            <button className="big wide" disabled={!count || busy} onClick={() => setPaying(true)}><Icon n="scan" />Cobrar</button>
          </div>
        </div>
      ) : (
        <div className="card">{sales.length === 0 ? <Empty icon="cart">Ainda sem vendas.</Empty> : (
          <table className="resp"><thead><tr><th>Venda</th><th>Itens</th><th className="num">Total</th><th /></tr></thead><tbody>{sales.map((s) => (
            <tr key={s.id}><td data-l="Hora">{dt(s.created_at)}</td><td data-l="Itens">{s.items.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}</td><td className="num" data-l="Total">{mt(s.total_minor)}</td>
              <td className="nolabel"><ConfirmButton label="Devolver" confirmLabel="Confirmar devolução" className="ghost sm" disabled={busy} onConfirm={() => run(async () => { await api('POST', '/pos/refund', { saleId: s.id }); await load(); }, 'Venda devolvida')} /></td></tr>))}</tbody></table>)}</div>
      )}

      {count > 0 && view === 'sell' && <div className="sticky-bar has-nav mobile-only"><div className="in"><div><b>{count} item{count > 1 ? 's' : ''}</b><div className="muted small">{mt(total)}</div></div><button className="big" onClick={() => setPaying(true)}><Icon n="scan" />Cobrar</button></div></div>}
      {paying && <Modal title={`Cobrar ${mt(total)}`} onClose={() => setPaying(false)}><ScanInput onScan={pay} autoStart placeholder="Ou escreva / use um leitor" /></Modal>}
      {result && <FullResult kind={result.kind} title={result.title} detail={result.detail} onClose={() => setResult(null)} autoCloseMs={result.kind === 'OK' ? 3500 : undefined} />}
      {toast.node}
    </Layout>
  );
}
