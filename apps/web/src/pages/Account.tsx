import { useState } from 'react';
import { api, setToken } from '../api';
import { Field, Modal, Pill, Qr, useAction, useToast } from '../ui';

/** «A minha conta»: alterar palavra-passe e verificação em dois passos (TOTP). */
export default function Account({ me, onClose }: { me: any; onClose: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [mfa, setMfa] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [enabled, setEnabled] = useState<boolean>(!!me.mfaEnabled);
  const [off, setOff] = useState({ password: '', code: '' });

  return (
    <Modal title="A minha conta" onClose={onClose}>
      <div><b>{me.name}</b><p className="muted small">{me.orgName ?? 'Plataforma'}</p></div>

      <section className="stack-sm">
        <h3>Alterar palavra-passe</h3>
        <Field label="Palavra-passe actual"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="Nova palavra-passe" hint="Mínimo 8 caracteres."><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <button disabled={busy || !pw.current || pw.next.length < 8} onClick={() => run(async () => { await api('POST', '/me/password', { current: pw.current, password: pw.next }); setPw({ current: '', next: '' }); }, 'Palavra-passe alterada')}>Guardar palavra-passe</button>
      </section>

      <section className="stack-sm">
        <div className="between"><h3>Verificação em dois passos</h3>{enabled ? <Pill s="ACTIVE" /> : <span className="pill">Desligada</span>}</div>
        <p className="muted small">Pede um código da app de autenticação (Google Authenticator, Microsoft Authenticator, Authy…) ao entrar. Recomendado para administradores.</p>

        {recovery ? (
          <div className="card flat stack-sm">
            <b>Guarde os códigos de recuperação</b>
            <p className="muted small">Cada código só funciona uma vez e substitui a app se perder o telemóvel. Não voltam a ser mostrados.</p>
            <div className="mono" style={{ columnCount: 2 }}>{recovery.map((c) => <div key={c}>{c}</div>)}</div>
            <button className="ghost sm" onClick={() => navigator.clipboard?.writeText(recovery.join('\n'))}>Copiar códigos</button>
            <button onClick={() => setRecovery(null)}>Já guardei</button>
          </div>
        ) : enabled ? (
          <div className="stack-sm">
            <Field label="Palavra-passe"><input type="password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} /></Field>
            <Field label="Código da app"><input inputMode="numeric" maxLength={6} value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} /></Field>
            <button className="danger ghost" disabled={busy || !off.password || off.code.length !== 6} onClick={() => run(async () => { await api('POST', '/me/mfa/disable', off); setEnabled(false); setOff({ password: '', code: '' }); }, 'Verificação desligada')}>Desligar</button>
          </div>
        ) : mfa ? (
          <div className="stack-sm center">
            <p className="small">1. Leia este QR na app de autenticação.</p>
            <Qr value={mfa.url} label="QR para a app de autenticação" />
            <p className="muted small">Ou introduza a chave: <span className="mono">{mfa.secret}</span></p>
            <p className="small">2. Escreva o código de 6 dígitos que a app mostra.</p>
            <input inputMode="numeric" maxLength={6} value={code} placeholder="000000" onChange={(e) => setCode(e.target.value)} style={{ textAlign: 'center', letterSpacing: '.4em', fontSize: '1.3rem' }} />
            <button className="big" disabled={busy || code.length !== 6} onClick={() => run(async () => { const r = await api('POST', '/me/mfa/enable', { code }); setRecovery(r.recoveryCodes); setEnabled(true); setMfa(null); setCode(''); })}>Activar</button>
          </div>
        ) : (
          <button className="ghost" disabled={busy} onClick={() => run(async () => { const r = await api('POST', '/me/mfa/setup', {}); setMfa({ secret: r.secret, url: r.otpauthUrl }); })}>Activar verificação em dois passos</button>
        )}
      </section>
      <button className="ghost" onClick={() => { setToken(null); location.assign(me.orgSlug ? `/empresa/${me.orgSlug}` : '/staff'); }}>Terminar sessão</button>
      {toast.node}
    </Modal>
  );
}
