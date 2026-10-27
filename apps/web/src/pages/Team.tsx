import { useCallback, useEffect, useState } from 'react';
import { api, dt } from '../api';
import { ConfirmButton, Empty, Field, Icon, Modal, PageHead, Pill, Skeleton, useAction } from '../ui';

type Toast = (m: string, e?: boolean) => void;
const ROLE: Record<string, string> = { ORG_ADMIN: 'Administrador', CASHIER: 'Balcão / caixa', MERCHANT_OPERATOR: 'Operador de comerciante', GATE_OPERATOR: 'Controlo de acessos' };

/** Equipa da empresa: só vê e gere os seus próprios utilizadores. */
export function Team({ me, toast }: { me: any; toast: Toast }) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [add, setAdd] = useState(false);
  const [reset, setReset] = useState<any>(null);
  const { busy, run } = useAction(toast);
  const load = useCallback(async () => { const [u, m] = await Promise.all([api('GET', '/users'), api('GET', '/merchants')]); setUsers(u); setMerchants(m); }, []);
  useEffect(() => { load(); }, [load]);
  const link = `${location.origin}/company/${me.orgSlug}`;

  return (
    <>
      <PageHead title="Equipa" sub="Utilizadores da sua empresa. Só vê e gere os seus." actions={<button onClick={() => setAdd(true)}><Icon n="plus" />Novo utilizador</button>} />
      <div className="card flat between" style={{ marginBottom: 18 }}>
        <div><b>Área de entrada da equipa</b><p className="muted small">Partilhe este endereço com a sua equipa. Só quem pertence à empresa consegue entrar por ele.</p><p className="mono" style={{ marginTop: 6 }}>{link}</p></div>
        <span className="inline"><button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(link); toast('Ligação copiada'); }}><Icon n="copy" />Copiar</button><a className="btn ghost sm" href={link} target="_blank" rel="noreferrer">Abrir</a></span>
      </div>
      <div className="card">
        {!users ? <Skeleton rows={4} /> : users.length === 0 ? <Empty icon="users">Ainda sem utilizadores.</Empty> : (
          <table className="resp"><thead><tr><th>Nome</th><th>Função</th><th>Estado</th><th>Criado</th><th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}><td data-l="Nome"><b>{u.name}</b><br /><small className="muted">{u.email}</small></td>
                <td data-l="Função">{ROLE[u.role] ?? u.role}{u.merchant_name && <><br /><small className="muted">{u.merchant_name}</small></>}</td>
                <td data-l="Estado"><Pill s={u.status} /></td><td data-l="Criado">{dt(u.created_at)}</td>
                <td className="nolabel"><span className="inline" style={{ justifyContent: 'flex-end' }}>
                  <button className="ghost sm" onClick={() => setReset(u)}>Nova palavra-passe</button>
                  {u.id !== me.id && (u.status === 'ACTIVE'
                    ? <ConfirmButton label="Desactivar" confirmLabel="Confirmar" className="danger ghost sm" disabled={busy} onConfirm={() => run(async () => { await api('PATCH', `/users/${u.id}`, { status: 'DISABLED' }); await load(); }, 'Utilizador desactivado')} />
                    : <button className="ghost sm" disabled={busy} onClick={() => run(async () => { await api('PATCH', `/users/${u.id}`, { status: 'ACTIVE' }); await load(); }, 'Utilizador activado')}>Activar</button>)}
                </span></td></tr>))}</tbody></table>)}
      </div>
      {add && <NewUser merchants={merchants} toast={toast} onClose={() => setAdd(false)} onDone={() => { setAdd(false); load(); }} />}
      {reset && <ResetPassword user={reset} toast={toast} onClose={() => setReset(null)} />}
    </>
  );
}

function NewUser({ merchants, toast, onClose, onDone }: { merchants: any[]; toast: Toast; onClose: () => void; onDone: () => void }) {
  const [u, setU] = useState({ name: '', email: '', password: '', role: 'CASHIER', merchantId: '' });
  const { busy, run } = useAction(toast);
  const needsMerchant = u.role === 'MERCHANT_OPERATOR';
  return (
    <Modal title="Novo utilizador" onClose={onClose}>
      <Field label="Função"><select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      {needsMerchant && <Field label="Comerciante"><select value={u.merchantId} onChange={(e) => setU({ ...u, merchantId: e.target.value })}><option value="">Escolha…</option>{merchants.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.event_name}</option>)}</select></Field>}
      <Field label="Nome"><input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
      <Field label="E-mail"><input type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></Field>
      <Field label="Palavra-passe inicial" hint="Mínimo 8 caracteres. A pessoa pode alterá-la depois."><input type="password" autoComplete="new-password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></Field>
      <button className="big wide" disabled={busy || !u.name || !u.email || u.password.length < 8 || (needsMerchant && !u.merchantId)} onClick={() => run(async () => { await api('POST', '/users', needsMerchant ? u : { ...u, merchantId: undefined }); onDone(); }, 'Utilizador criado')}>Criar utilizador</button>
    </Modal>
  );
}

function ResetPassword({ user, toast, onClose }: { user: any; toast: Toast; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const { busy, run } = useAction(toast);
  return (
    <Modal title={`Nova palavra-passe · ${user.name}`} onClose={onClose}>
      <p className="muted">As sessões abertas desta pessoa terminam de imediato.</p>
      <Field label="Nova palavra-passe" hint="Mínimo 8 caracteres."><input type="password" autoComplete="new-password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} /></Field>
      <button className="big wide" disabled={busy || pw.length < 8} onClick={() => run(async () => { await api('POST', `/users/${user.id}/password`, { password: pw }); onClose(); }, 'Palavra-passe actualizada')}>Guardar</button>
    </Modal>
  );
}
