import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dt, upload } from '../api';
import { Empty, Field, Icon, Pill, Skeleton, useAction } from '../ui';
import { BrandEditor } from './Brand';

type Toast = (m: string, e?: boolean) => void;

/** Aviso do estado da aprovação da empresa. */
export function ApprovalBanner({ status, reason }: { status: string; reason?: string | null }) {
  if (status === 'ACTIVE') return null;
  const t: Record<string, [string, string]> = {
    PENDING: ['A aguardar aprovação', 'A equipa Bilhete+ está a validar os dados da sua empresa. Pode completar o perfil, anexar documentos e escolher a marca; só depois da aprovação poderá criar eventos.'],
    REJECTED: ['Registo rejeitado', reason ? `Motivo: ${reason}. Corrija os dados ou anexe os documentos em falta e volte a submeter.` : 'Corrija os dados e volte a submeter.'],
    SUSPENDED: ['Empresa suspensa', reason ? `Motivo: ${reason}.` : 'Contacte o suporte Bilhete+.'],
    DISABLED: ['Empresa desactivada', 'Contacte o suporte Bilhete+.'],
  };
  const [title, text] = t[status] ?? ['Estado', status];
  return <div className="card" style={{ borderColor: status === 'PENDING' ? 'var(--warn)' : 'var(--bad)', background: status === 'PENDING' ? 'var(--warn-soft)' : 'var(--bad-soft)' }}>
    <div className="between"><b>{title}</b><Pill s={status} /></div><p style={{ marginTop: 6 }}>{text}</p></div>;
}

/** Perfil da empresa, documentos e marca (valores por omissão dos eventos). Disponível mesmo antes da aprovação. */
export function Company({ toast, onStatus }: { toast: Toast; onStatus?: () => void }) {
  const [p, setP] = useState<any>(null);
  const [brand, setBrand] = useState<any>(null);
  const { busy, run } = useAction(toast);
  const file = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const load = useCallback(async () => { setP(await api('GET', '/org/profile')); setBrand(await api('GET', '/org/brand')); }, []);
  useEffect(() => { load(); }, [load]);
  if (!p || !brand) return <Skeleton rows={5} />;
  const set = (k: string) => (e: any) => setP({ ...p, [k]: e.target.value });
  const locked = p.status === 'SUSPENDED' || p.status === 'DISABLED';

  const attach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    await run(async () => { await upload('POST', '/org/documents', f, { 'x-doc-label': label || 'Documento', 'x-filename': f.name }); setLabel(''); await load(); }, 'Documento anexado');
  };
  return (
    <div className="stack">
      <ApprovalBanner status={p.status} reason={p.status_reason} />
      {p.status === 'REJECTED' && <button onClick={() => run(async () => { await api('POST', '/org/resubmit', {}); await load(); onStatus?.(); }, 'Registo submetido novamente')}>Submeter novamente para aprovação</button>}
      <div className="card flat"><b>Área de entrada da equipa</b><p className="mono" style={{ marginTop: 4 }}>{location.origin}/company/{p.slug}</p></div>
      <div className="card stack">
        <h2>Dados da empresa</h2>
        <p className="muted small">{p.legal_name} · NUIT {p.nuit}</p>
        <div className="field-row">
          <Field label="Nome comercial"><input value={p.trade_name ?? ''} onChange={set('trade_name')} /></Field>
          <Field label="Responsável"><input value={p.contact_name ?? ''} onChange={set('contact_name')} /></Field>
          <Field label="Telefone"><input value={p.phone ?? ''} onChange={set('phone')} /></Field>
          <Field label="E-mail de facturação"><input value={p.billing_email ?? ''} onChange={set('billing_email')} /></Field>
        </div>
        <Field label="Endereço"><input value={p.address ?? ''} onChange={set('address')} /></Field>
        <Field label="Website"><input value={p.website ?? ''} onChange={set('website')} /></Field>
        <button disabled={busy || locked} onClick={() => run(async () => { setP(await api('PUT', '/org/profile', { tradeName: p.trade_name, contactName: p.contact_name, phone: p.phone, billingEmail: p.billing_email, address: p.address, website: p.website })); }, 'Dados guardados')}>Guardar</button>
      </div>
      <div className="card stack">
        <h2>Documentos</h2>
        <p className="muted small">Ex.: certidão de NUIT, alvará, documento do responsável. PDF, PNG ou JPEG até 3 MB.</p>
        {p.documents.length === 0 ? <Empty icon="box">Ainda sem documentos.</Empty> : p.documents.map((d: any) => (
          <div className="between" key={d.id}><span><b>{d.label}</b><br /><small className="muted">{d.filename} · {dt(d.created_at)}</small></span>
            <button className="danger ghost sm" disabled={busy || locked} aria-label={`Remover ${d.label}`} onClick={() => run(async () => { await api('DELETE', `/org/documents/${d.id}`); await load(); })}><Icon n="x" /></button></div>
        ))}
        <div className="field-row"><Field label="Descrição do documento"><input value={label} placeholder="Certidão de NUIT" onChange={(e) => setLabel(e.target.value)} /></Field>
          <div><input ref={file} type="file" hidden accept="application/pdf,image/png,image/jpeg" onChange={attach} /><button className="ghost wide" disabled={busy || locked} onClick={() => file.current?.click()}><Icon n="plus" />Anexar ficheiro</button></div></div>
      </div>
      <div className="stack">
        <div><h2>Marca da empresa</h2><p className="muted small">Valores por omissão de todos os eventos da empresa. Cada evento pode depois ter as suas próprias cores e imagens.</p></div>
        <BrandEditor base="/org" theme={brand.theme} assets={brand.assets} onChange={load} toast={toast} />
      </div>
    </div>
  );
}
