import { useState } from 'react';
import { api } from '../api';
import { Icon, LangSwitch, useAction, useToast } from '../ui';
import './participant.css';

const STEPS = ['Empresa', 'Responsável', 'Confirmar'];

/** Estrutura comum das páginas de empresa (registo): barra escura, faixa violeta e conteúdo — sem conta de participante. */
function Shell({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="pp">
      <header className="pp-top"><a href="/" aria-label="Início"><img src="/logo-dark.svg" alt="Bilhete+" /></a><span className="pp-top-r"><LangSwitch className="on-dark" /><a href="/events">Ver eventos</a></span></header>
      <section className="pp-hero"><span className="pp-label">{label}</span><h1>{title}</h1></section>
      <main className="pp-main">{children}</main>
    </div>
  );
}

/** Registo de empresa: fica a aguardar a aprovação da equipa Bilhete+ e só depois pode operar. */
export function Register() {
  const [f, setF] = useState({ legalName: '', tradeName: '', nuit: '', address: '', phone: '', contactName: '', email: '', password: '', acceptTerms: false });
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState<string | null>(null); // endereço da área da empresa (só mostrado a quem se registou)
  const toast = useToast();
  const { busy, run } = useAction(toast.show);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ok0 = !!f.legalName.trim() && !!f.tradeName.trim() && /^\d{9}$/.test(f.nuit);
  const ok1 = !!f.contactName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 8;
  const ready = ok0 && ok1 && f.acceptTerms;

  if (done !== null) return (
    <Shell label="[BP/ Registo recebido]" title="Falta pouco.">
      <section className="pp-card">
        <p className="pp-sub">A sua empresa está <b>a aguardar aprovação</b>. Só depois de aprovada poderá usar a área da empresa e criar eventos: até lá, ao entrar, verá «Empresa não aprovada».</p>
        <p className="pp-sub">Este é o endereço da área da sua empresa. <b>Guarde-o</b>: não é divulgado em lado nenhum. Enviámos também por e-mail.</p>
        <p className="mono" style={{ overflowWrap: 'anywhere' }} data-no-translate>{location.origin}/company/{done}</p>
        <a className="pp-btn" href={`/company/${done}`}>Ir para a minha empresa</a>
      </section>
    </Shell>
  );
  return (
    <Shell label="[BP/ Nova empresa]" title="Registar a minha empresa">
      <section className="pp-card pp-wide">
        <p className="pp-sub">A equipa Bilhete+ valida os dados antes de activar a criação de eventos.</p>
        <ol className="pp-steps" aria-label="Passos">{STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Icon n="check" /> : String(i + 1).padStart(2, '0')}</span>{s}</li>))}
        </ol>

        {step === 0 && <div className="pp-form">
          <div className="pp-row">
            <label className="pp-field"><span>Denominação legal</span><input value={f.legalName} onChange={set('legalName')} autoComplete="organization" autoFocus /></label>
            <label className="pp-field"><span>Nome comercial</span><input value={f.tradeName} onChange={set('tradeName')} /></label>
          </div>
          <div className="pp-row">
            <label className="pp-field"><span>NUIT</span><input inputMode="numeric" maxLength={9} value={f.nuit} onChange={set('nuit')} /><small>9 dígitos.</small></label>
            <label className="pp-field"><span>Telefone</span><input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /><small>Opcional.</small></label>
          </div>
          <label className="pp-field"><span>Endereço</span><input value={f.address} onChange={set('address')} autoComplete="street-address" /><small>Opcional.</small></label>
          <button className="pp-btn" disabled={!ok0} onClick={() => setStep(1)}>Continuar<Icon n="arrowright" /></button>
        </div>}

        {step === 1 && <div className="pp-form">
          <label className="pp-field"><span>Nome do responsável</span><input value={f.contactName} onChange={set('contactName')} autoComplete="name" autoFocus /></label>
          <label className="pp-field"><span>E-mail</span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /><small>Será o seu utilizador de acesso.</small></label>
          <label className="pp-field"><span>Palavra-passe</span>
            <span className="pp-pw"><input type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} autoComplete="new-password" />
              <button type="button" className="pp-link" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button></span>
            <small>Pelo menos 8 caracteres.</small></label>
          <div className="pp-actions"><button className="pp-btn alt" onClick={() => setStep(0)}>Voltar</button><button className="pp-btn" disabled={!ok1} onClick={() => setStep(2)}>Continuar<Icon n="arrowright" /></button></div>
        </div>}

        {step === 2 && <div className="pp-form">
          <dl className="pp-review">
            {([['Empresa', f.tradeName], ['Denominação', f.legalName], ['NUIT', f.nuit], ['Responsável', f.contactName], ['E-mail', f.email]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <label className="pp-check"><input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} /><span>Declaro que os dados são verdadeiros e aceito os termos de utilização da plataforma.</span></label>
          <div className="pp-actions"><button className="pp-btn alt" onClick={() => setStep(1)}>Voltar</button>
            <button className="pp-btn" disabled={busy || !ready} onClick={() => run(async () => { const r = await api('POST', '/public/register', f); setDone(r.slug || ''); })}>{busy ? 'A enviar…' : 'Registar empresa'}</button></div>
        </div>}
      </section>
      {toast.node}
    </Shell>
  );
}
