import { useEffect, useState } from 'react';
import { api, dt } from '../api';
import { Empty, PageHead, Skeleton } from '../ui';

const LABEL: Record<string, string> = {
  'org.status': 'Estado da empresa', 'org.theme': 'Marca da empresa', 'org.resubmit': 'Novo pedido de aprovação', 'event.create': 'Evento criado', 'event.theme': 'Aparência do evento', 'event.settings': 'Parâmetros do evento',
  'event.parent': 'Herança do evento', 'user.create': 'Utilizador criado', 'user.status': 'Utilizador activado/desactivado', 'user.password_reset': 'Palavra-passe reposta', 'ticket.revoke': 'Bilhete revogado',
  'credential.replace': 'Credencial substituída', 'credential.add': 'Credencial associada', 'credential.block': 'Credencial bloqueada', 'cash.close': 'Caixa fechada', 'pos.refund': 'Devolução no POS',
  'refund.decide': 'Reembolso decidido', 'merchant.commission': 'Comissão do comerciante', 'merchant.payout': 'Pagamento a comerciante', 'mfa.enable': 'MFA activada', 'mfa.disable': 'MFA desligada',
};

/** Registo de actividade da empresa (só a sua), para auditoria. */
export function Activity() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api('GET', '/audit?limit=200').then(setRows); }, []);
  return (
    <>
      <PageHead title="Actividade" sub="Operações sensíveis feitas pela sua equipa." />
      <div className="card">
        {!rows ? <Skeleton rows={5} /> : rows.length === 0 ? <Empty icon="chart">Sem actividade registada.</Empty> : (
          <table className="resp"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td data-l="Quando">{dt(r.created_at)}</td><td data-l="Quem">{r.user_name}</td><td data-l="O quê"><b>{LABEL[r.action] ?? r.action}</b></td>
                <td data-l="Detalhe" className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : ''}</td></tr>))}</tbody></table>)}
      </div>
    </>
  );
}
