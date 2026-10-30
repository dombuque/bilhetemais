import { InstallButton } from './install';
import { getLang, inApp, setLang } from './i18n';
import QRCode from 'qrcode';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { setToken, onPlatformHost } from './api';

import { Icon } from './icons';
export { Icon };

/* ---------- feedback ---------- */
export function useToast() {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, err = false) => { setT({ msg, err }); clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 3600); }, []);
  const node = t ? <div className={'toast' + (t.err ? ' err' : '')} role={t.err ? 'alert' : 'status'}>{t.msg}</div> : null;
  return { show, node };
}

/** Acção assíncrona com estado de carregamento e erros em toast. */
export function useAction(toast: (m: string, e?: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e: any) { toast(e.message ?? 'Erro', true); }
    finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

/* ---------- formulários ---------- */
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <div><label className="lbl">{label}</label>{children}{hint && <p className="muted small" style={{ marginTop: 6 }}>{hint}</p>}</div>
);

export function MoneyInput({ value, onChange, placeholder = '0,00', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return <div className="money"><input inputMode="decimal" value={value} placeholder={placeholder} autoFocus={autoFocus} aria-label="Valor em meticais" onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} /><span>MT</span></div>;
}

export function Stepper({ value, onChange, max = 20, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="ghost" aria-label="Menos" disabled={value <= 0} onClick={() => onChange(value - 1)}><Icon n="minus" /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Mais" disabled={value >= max} onClick={() => onChange(value + 1)}><Icon n="plus" /></button>
    </div>
  );
}

/** Botão destrutivo com confirmação em duas etapas (sem diálogos nativos). */
export function ConfirmButton({ label, confirmLabel = 'Confirmar', onConfirm, disabled, className = 'danger ghost' }: { label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const [arm, setArm] = useState(false);
  useEffect(() => { if (arm) { const t = setTimeout(() => setArm(false), 4000); return () => clearTimeout(t); } }, [arm]);
  return arm
    ? <button className="danger" disabled={disabled} onClick={() => { setArm(false); onConfirm(); }}>{confirmLabel}</button>
    : <button className={className} disabled={disabled} onClick={() => setArm(true)}>{label}</button>;
}

/** «Janela» sem janela: abre no próprio ecrã, como um painel, e leva a vista até ele. Fecha com o botão ou com Esc. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <section ref={ref} className="inline-panel card stack" role="region" aria-label={title}>
      <div className="between"><h2>{title}</h2><button className="ghost sm" aria-label="Fechar" onClick={onClose}><Icon n="x" />Fechar</button></div>
      {children}
    </section>
  );
}

export const Empty = ({ icon = 'box', children }: { icon?: string; children: ReactNode }) => <div className="empty"><Icon n={icon} className="" />{<p>{children}</p>}</div>;
export const Skeleton = ({ rows = 3 }: { rows?: number }) => <div className="stack" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;

const TONE: Record<string, [string, string]> = {
  ACTIVE: ['ok', 'Activa'], PUBLISHED: ['ok', 'Publicado'], PAID: ['ok', 'Pago'], ISSUED: ['ok', 'Válido'], APPROVED: ['ok', 'Aprovado'], CONFIRMED: ['ok', 'Confirmado'],
  PENDING: ['warn', 'Pendente'], PENDING_PAYMENT: ['warn', 'A aguardar pagamento'], DRAFT: ['warn', 'Rascunho'], USED: ['warn', 'Utilizado'],
  SUSPENDED: ['bad', 'Suspensa'], DISABLED: ['bad', 'Desactivada'], REVOKED: ['bad', 'Cancelado'], BLOCKED: ['warn', 'Bloqueado'], REJECTED: ['bad', 'Rejeitado'], CLOSED: ['bad', 'Encerrado'], CANCELLED: ['bad', 'Cancelado'],
};
export const Pill = ({ s }: { s: string }) => <span className={'pill ' + (TONE[s]?.[0] ?? '')}>{TONE[s]?.[1] ?? s}</span>;

export const BarRow = ({ label, value, max, text }: { label: string; value: number; max: number; text: string }) => (
  <div className="bar-row"><span>{label}</span><div className="track" role="img" aria-label={`${label}: ${text}`}><div className="fill" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div><b className="nowrap">{text}</b></div>
);

/* ---------- estrutura da área da equipa ---------- */
export interface NavItem { id: string; label: string; icon: string }
const Account = lazy(() => import('./pages/Account'));
/** Escolha de língua (PT | EN). */
/** Botão PT | EN. Na app instalada não aparece nos cabeçalhos: a língua escolhe-se no primeiro arranque e muda-se em Perfil → Idioma (`always`). */
export function LangSwitch({ className = '', always = false }: { className?: string; always?: boolean }) {
  const cur = getLang();
  if (inApp() && !always) return null;
  return (
    <span className={'langsw ' + className} data-no-translate role="group" aria-label="Language">
      {(['pt', 'en'] as const).map((l) => <button key={l} type="button" className={'ghost sm' + (cur === l ? ' on' : '')} aria-pressed={cur === l} onClick={() => cur !== l && setLang(l)}>{l.toUpperCase()}</button>)}
    </span>
  );
}

export function Layout({ me, nav, view, onView, children }: { me: any; nav: NavItem[]; view: string; onView: (v: string) => void; children: ReactNode }) {
  const roleName: Record<string, string> = { PLATFORM_ADMIN: 'Administração', ORG_ADMIN: 'Organizador', CASHIER: 'Balcão', MERCHANT_OPERATOR: 'Comerciante', GATE_OPERATOR: 'Acessos' };
  const [account, setAccount] = useState(false);
  const logout = () => { setToken(null); location.assign(me.orgSlug ? `/company/${me.orgSlug}` : onPlatformHost() ? '/' : '/platform'); };
  return (
    <div className="shell">
      <header className="topbar"><img src="/logo-dark.svg" alt="Bilhete+" /><LangSwitch /><button className="ghost sm" onClick={() => setAccount(true)} aria-label="A minha conta" style={{ marginLeft: 'auto', marginRight: 8 }}>{me.name.split(' ')[0]}</button></header>
      <nav className="side" aria-label="Navegação">
        <div className="brand"><img src="/logo-dark.svg" alt="Bilhete+" />
          {me.role === 'PLATFORM_ADMIN' ? <span className="area-tag plat">Bilhete+ · Plataforma</span> : <span className="area-tag org">Empresa · {me.orgName ?? me.merchantName ?? ''}</span>}</div>
        {nav.map((n) => <button key={n.id} className={'navbtn' + (n.id === view ? ' on' : '')} aria-current={n.id === view ? 'page' : undefined} onClick={() => onView(n.id)}><Icon n={n.icon} />{n.label}</button>)}
        <button className="navbtn" onClick={logout} style={{ display: 'none' }}><Icon n="logout" />Sair</button>
        <div className="who">
          <b>{me.merchantName ?? me.orgName ?? 'Plataforma'}</b>
          <div className="muted small">{me.name} · {roleName[me.role]}</div>
          <LangSwitch className="side-lang" />
          <span className="side-install"><InstallButton label="Instalar app da equipa" className="ghost sm" staff /></span>
          <button className="ghost sm" style={{ marginTop: 10 }} onClick={() => setAccount(true)}><Icon n="users" />A minha conta</button>
          <button className="ghost sm" style={{ marginTop: 8 }} onClick={logout}><Icon n="logout" />Sair</button>
        </div>
      </nav>
      <main className="main">{children}</main>
      {account && <Suspense fallback={null}><Account me={me} onClose={() => setAccount(false)} /></Suspense>}
    </div>
  );
}

export const PageHead = ({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p className="muted" style={{ marginTop: 4 }}>{sub}</p>}</div>{actions && <div className="inline">{actions}</div>}</div>
);

/** Resultado de ecrã inteiro (portaria / pagamento), com vibração e som curto. */
export function FullResult({ kind, title, detail, onClose, autoCloseMs }: { kind: string; title: string; detail?: ReactNode; onClose: () => void; autoCloseMs?: number }) {
  useEffect(() => {
    const good = kind === 'VALID' || kind === 'OK' || kind === 'EXIT_OK';
    try { navigator.vibrate?.(good ? 60 : [120, 60, 120]); } catch { /* sem vibração */ }
    try {
      const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = good ? 880 : 220; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.08; o.start(); o.stop(ctx.currentTime + (good ? 0.12 : 0.35));
    } catch { /* sem áudio */ }
    if (autoCloseMs) { const t = setTimeout(onClose, autoCloseMs); return () => clearTimeout(t); }
  }, [kind, autoCloseMs, onClose]);
  const good = kind === 'VALID' || kind === 'OK' || kind === 'EXIT_OK';
  return (
    <div className={'fullresult ' + kind} role="alert" onClick={onClose}>
      <Icon n={good ? 'check' : kind === 'ALREADY_USED' || kind === 'ALREADY_INSIDE' || kind === 'NOT_INSIDE' || kind === 'EXPIRED' ? 'alert' : 'x'} className="" />
      <h1>{title}</h1>{detail && <p>{detail}</p>}
      <button onClick={onClose}>Continuar</button>
    </div>
  );
}

export function Qr({ value, label }: { value: string; label?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: 420, errorCorrectionLevel: 'M' }).then(setSrc); }, [value]);
  return src ? <img className="qr" src={src} alt={label ?? 'Código QR'} /> : <div className="skeleton" style={{ width: 280, height: 280, margin: '0 auto' }} />;
}

/** Código escrito por baixo do QR: o mesmo valor, em grupos de 4, para a portaria o poder digitar. */
export function TokenCode({ value, shortCode }: { value: string; shortCode?: string | null }) {
  const [copied, setCopied] = useState(false);
  const short = shortCode ? shortCode.slice(0, 4) + '-' + shortCode.slice(4) : null;
  return (
    <div className="token-code">
      <span className="muted small">Código do bilhete (se o QR não ler)</span>
      {short && <code className="short" aria-label={'Código ' + short}>{short}</code>}
      {short ? <details className="small"><summary>Código completo</summary><code aria-label={'Código completo ' + value}>{value.match(/.{1,4}/g)!.join(' ')}</code></details>
        : <code aria-label={'Código ' + value}>{value.match(/.{1,4}/g)!.join(' ')}</code>}
      <button type="button" className="ghost sm" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }}><Icon n="copy" />{copied ? 'Copiado' : 'Copiar código'}</button>
    </div>
  );
}

export { ScanInput, nfcSupported, writeNfcTag } from './scanner';

/** Código de barras Code 128 (para bilhetes impressos lidos por scanner). */
export function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  // a biblioteca só se descarrega quando há um código de barras para desenhar (balcão)
  useEffect(() => { import('jsbarcode').then((m) => { if (ref.current) (m.default as any)(ref.current, value, { format: 'CODE128', displayValue: false, height: 58, margin: 0, width: 1.6 }); }); }, [value]);
  return <svg ref={ref} className="barcode" role="img" aria-label="Código de barras do bilhete" />;
}

/** Botão flutuante «voltar ao topo»: aparece depois de descer a página. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <button className={'to-top' + (show ? ' show' : '')} aria-label="Voltar ao topo" tabIndex={show ? 0 : -1} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <Icon n="arrowup" />
    </button>
  );
}
