import { useCallback, useEffect, useState } from 'react';
import { api, dt } from '../api';
import { Empty, Field, Modal, Pill, Skeleton, useAction } from '../ui';

type Toast = (m: string, e?: boolean) => void;
const STATUS: Record<string, string> = { ISSUED: 'Válido', USED: 'Já entrou', BLOCKED: 'Bloqueado', REVOKED: 'Cancelado' };
const FILTERS: [string, string][] = [['', 'Todos'], ['ISSUED', 'Válidos'], ['USED', 'Já entraram'], ['BLOCKED', 'Bloqueados'], ['REVOKED', 'Cancelados']];

/** Gestão de bilhetes emitidos: pesquisar, bloquear (reversível) e cancelar (definitivo), sempre com justificação. */
export function TicketControl({ id, toast }: { id: string; toast: Toast }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [ask, setAsk] = useState<{ t: any; kind: 'block' | 'cancel' } | null>(null);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction(toast);
  const load = useCallback(() => {
    const qs = new URLSearchParams(); if (q.trim()) qs.set('q', q.trim()); if (status) qs.set('status', status);
    api('GET', `/events/${id}/tickets?${qs}`).then(setRows).catch(() => setRows([]));
  }, [id, q, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]); // pesquisa com pequena pausa
  const close = () => { setAsk(null); setReason(''); };

  return (
    <section className="card stack">
      <div><h3>Gerir bilhetes emitidos</h3><p className="muted small">Pesquise por nome, contacto ou código do bilhete. Bloquear é reversível; cancelar é definitivo. O motivo fica registado.</p></div>
      <div className="inline" style={{ flexWrap: 'wrap' }}>
        <input style={{ flex: '1 1 220px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, contacto ou código" aria-label="Pesquisar bilhetes" />
        <div className="seg scroll" role="tablist">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      </div>
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <Empty icon="ticket">Nenhum bilhete encontrado.</Empty> : (
        <table className="resp"><thead><tr><th>Titular</th><th>Bilhete</th><th>Estado</th><th></th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id}>
              <td data-l="Titular"><b>{t.holder}</b><br /><small className="muted">{t.contact || '—'}</small></td>
              <td data-l="Bilhete">{t.type}<br /><small className="muted mono">{t.id.slice(0, 8).toUpperCase()}</small></td>
              <td data-l="Estado"><Pill s={t.status === 'USED' ? 'USED' : t.status} />{' '}<small className="muted">{STATUS[t.status]}</small>
                {t.reason && <><br /><small className="muted">«{t.reason}»{t.changed_by ? ` · ${t.changed_by}` : ''}{t.changed_at ? ` · ${dt(t.changed_at)}` : ''}</small></>}</td>
              <td data-l="Ações" className="right">
                <span className="inline" style={{ justifyContent: 'flex-end' }}>
                  {(t.status === 'ISSUED' || t.status === 'USED') && <button className="ghost sm" onClick={() => setAsk({ t, kind: 'block' })}>Bloquear</button>}
                  {t.status === 'BLOCKED' && <button className="ghost sm" disabled={busy} onClick={() => run(async () => { await api('POST', `/tickets/${t.id}/unblock`, {}); load(); }, 'Bilhete desbloqueado')}>Desbloquear</button>}
                  {t.status !== 'REVOKED' && <button className="danger ghost sm" onClick={() => setAsk({ t, kind: 'cancel' })}>Cancelar</button>}
                </span>
              </td>
            </tr>))}</tbody></table>)}
      {ask && (
        <Modal title={ask.kind === 'block' ? 'Bloquear bilhete' : 'Cancelar bilhete'} onClose={close}>
          <p><b>{ask.t.holder}</b> · {ask.t.type}</p>
          <p className="muted small">{ask.kind === 'block'
            ? 'O bilhete deixa de entrar e a carteira deixa de pagar. Pode desbloquear mais tarde.'
            : 'O bilhete deixa de entrar e a carteira fica bloqueada. Esta ação é definitiva; o saldo devolve-se pelos reembolsos.'}</p>
          <Field label="Motivo (obrigatório)" hint="Fica registado e é mostrado à portaria."><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus /></Field>
          <div className="inline">
            <button className="ghost" onClick={close}>Voltar</button>
            <button className={ask.kind === 'cancel' ? 'danger' : ''} disabled={busy || reason.trim().length < 3} onClick={() => run(async () => { await api('POST', `/tickets/${ask.t.id}/${ask.kind}`, { reason: reason.trim() }); close(); load(); }, ask.kind === 'block' ? 'Bilhete bloqueado' : 'Bilhete cancelado')}>{ask.kind === 'block' ? 'Bloquear' : 'Cancelar bilhete'}</button>
          </div>
        </Modal>)}
    </section>
  );
}
