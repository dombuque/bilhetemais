import { useCallback, useEffect, useState } from 'react';
import { api, dt } from '../api';
import { Empty, Field, Icon, LangSwitch, PageHead, Skeleton, useAction } from '../ui';
import './participant.css';

/** Página aberta pela ligação «deixar de receber» de cada newsletter. */
export function Unsubscribe() {
  const q = new URLSearchParams(location.search);
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  useEffect(() => {
    api('POST', '/public/newsletter/unsubscribe', { a: q.get('a'), t: q.get('t') }).then(() => setState('done')).catch(() => setState('error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pp">
      <header className="pp-top"><a href="/" aria-label="Início"><img src="/logo-dark.svg" alt="Bilhete+" /></a><span className="pp-top-r"><LangSwitch className="on-dark" /></span></header>
      <section className="pp-hero"><span className="pp-label">[BP/ Newsletter]</span><h1>{state === 'done' ? 'Até breve.' : state === 'error' ? 'Ligação inválida' : 'A processar…'}</h1></section>
      <main className="pp-main"><section className="pp-card pp-wide">
        {state === 'done' && <p className="pp-sub">Deixou de receber novidades do Bilhete+ por e-mail. Os e-mails sobre as suas compras continuam a chegar. Pode voltar a subscrever em «A minha conta».</p>}
        {state === 'error' && <p className="pp-sub">Esta ligação não é válida ou está incompleta. Entre em «A minha conta» para gerir a newsletter.</p>}
        <a className="pp-btn" href="/account">A minha conta</a>
      </section></main>
    </div>
  );
}

/** Backoffice da plataforma: escrever e enviar a newsletter às contas subscritas. */
export function NewsletterAdmin({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [info, setInfo] = useState<{ subscribers: number; campaigns: any[] } | null>(null);
  const [f, setF] = useState({ subject: '', body: '', testTo: '' });
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction(toast);
  const load = useCallback(() => api('GET', '/platform/newsletter').then(setInfo), []);
  useEffect(() => { load(); }, [load]);
  const ok = f.subject.trim().length >= 3 && f.body.trim().length >= 10;

  return (
    <>
      <PageHead title="Newsletter" sub={`${info?.subscribers ?? 0} subscritor${info?.subscribers === 1 ? '' : 'es'}`} />
      <section className="card stack">
        <p className="muted small">Enviada às contas de participantes subscritas. Cada e-mail leva a ligação para deixar de receber.</p>
        <Field label="Assunto"><input value={f.subject} maxLength={150} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Mensagem"><textarea rows={8} value={f.body} maxLength={5000} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="field-row">
          <Field label="Enviar teste para" hint="Um e-mail seu, para ver como fica."><input type="email" value={f.testTo} onChange={(e) => setF({ ...f, testTo: e.target.value })} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="ghost" disabled={busy || !ok || !/\S+@\S+\.\S+/.test(f.testTo)} onClick={() => run(async () => { await api('POST', '/platform/newsletter', { subject: f.subject, body: f.body, testTo: f.testTo }); }, 'Teste enviado')}>Enviar teste</button></div>
        </div>
        {!confirm ? <button disabled={!ok || !info?.subscribers} onClick={() => setConfirm(true)}><Icon n="arrowright" />Enviar a {info?.subscribers ?? 0} subscritor{info?.subscribers === 1 ? '' : 'es'}</button> : (
          <div className="inline">
            <button className="ghost" onClick={() => setConfirm(false)}>Voltar</button>
            <button disabled={busy} onClick={() => run(async () => { const r = await api('POST', '/platform/newsletter', { subject: f.subject, body: f.body }); setConfirm(false); setF({ subject: '', body: '', testTo: '' }); await load(); toast(`Newsletter enviada a ${r.recipients}.`); })}>Confirmar envio</button>
          </div>)}
      </section>
      <section className="card stack" style={{ marginTop: 16 }}><h3>Enviadas</h3>
        {!info ? <Skeleton rows={2} /> : info.campaigns.length === 0 ? <Empty icon="ticket">Ainda não enviou nenhuma newsletter.</Empty> : info.campaigns.map((c) => (
          <div className="between small" key={c.id}><span><b>{c.subject}</b><br /><span className="muted">{dt(c.created_at)}</span></span><span className="muted">{c.recipients} destinatários</span></div>))}
      </section>
    </>
  );
}
