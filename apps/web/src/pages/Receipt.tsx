import { dt, mt } from '../api';
import { Icon, Modal } from '../ui';

const TITLE: Record<string, string> = { TOPUP: 'Comprovativo de carregamento', PAYMENT: 'Comprovativo de pagamento', REFUND: 'Comprovativo de devolução', CASHOUT: 'Comprovativo de levantamento', ADJUSTMENT: 'Comprovativo de ajuste' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Comprovativo imprimível de um movimento da carteira (só mostra o que pertence ao participante). */
export function ReceiptModal({ r, onClose }: { r: any; onClose: () => void }) {
  const items: any[] = r.items ?? [];
  const print = () => {
    // janela própria: imprime só o comprovativo, sem o resto da página
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Comprovativo ${esc(r.number)}</title><style>body{font:14px system-ui;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:4px 0;border-bottom:1px dashed #bbb}.r{text-align:right}.big{font-size:22px;font-weight:700}small{color:#555}</style>
      <h1>${esc(TITLE[r.type] ?? 'Comprovativo')}</h1><small>${esc(r.organization)}${r.nuit ? ' · NUIT ' + esc(r.nuit) : ''}</small><p>${esc(r.event)}<br><small>Nº ${esc(r.number)} · ${esc(dt(r.created_at))}</small></p>
      ${r.merchant ? `<p>${esc(r.merchant)}</p>` : ''}<table>${items.map((i) => `<tr><td>${esc(i.qty)} × ${esc(i.name)}</td><td class="r">${esc(mt(BigInt(i.priceMinor) * BigInt(i.qty)))}</td></tr>`).join('')}</table>
      <p class="big">${esc(mt(r.amount_minor))}</p><small>Documento informativo. Não substitui factura.</small><script>onload=()=>print()<\/script>`);
    w.document.close();
  };
  return (
    <Modal title={TITLE[r.type] ?? 'Comprovativo'} onClose={onClose}>
      <div className="stack-sm">
        <p className="muted small">{r.organization}{r.nuit ? ` · NUIT ${r.nuit}` : ''}</p>
        <p><b>{r.event}</b><br /><span className="muted small">Nº {r.number} · {dt(r.created_at)}</span></p>
        {r.merchant && <p>{r.merchant}</p>}
        {items.length > 0 && <table><tbody>{items.map((i, k) => <tr key={k}><td>{i.qty} × {i.name}</td><td className="num">{mt(BigInt(i.priceMinor) * BigInt(i.qty))}</td></tr>)}</tbody></table>}
        <div className="between"><span className="muted">Total</span><b className="price" style={{ fontSize: '1.6rem' }}>{mt(r.amount_minor)}</b></div>
      </div>
      <button onClick={print}><Icon n="print" />Imprimir</button>
    </Modal>
  );
}
