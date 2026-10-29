import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/sora';
import '@fontsource-variable/inter';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { BackToTop } from './ui';
import { installTranslator } from './i18n';
import { setRuntime } from './api';
import { captureInstallPrompt, InstallBanner } from './install';
import { Home } from './pages/Landing';
// cada página carrega à parte: quem abre a página inicial (ou o bilhete) não descarrega o código da equipa
const Unsubscribe = lazy(() => import('./pages/Newsletter').then((m) => ({ default: m.Unsubscribe })));
const AccountDone = lazy(() => import('./pages/Participant').then((m) => ({ default: m.AccountDone })));
const AccountPage = lazy(() => import('./pages/Participant').then((m) => ({ default: m.AccountPage })));
const PublicEvent = lazy(() => import('./pages/Public').then((m) => ({ default: m.PublicEvent })));
const Order = lazy(() => import('./pages/Public').then((m) => ({ default: m.Order })));
const Wallet = lazy(() => import('./pages/Public').then((m) => ({ default: m.Wallet })));
const Register = lazy(() => import('./pages/Public').then((m) => ({ default: m.Register })));
const RegistrationClosed = lazy(() => import('./pages/Public').then((m) => ({ default: m.RegistrationClosed })));
const Staff = lazy(() => import('./pages/Staff').then((m) => ({ default: m.Staff })));

const Discover = lazy(() => import('./pages/Discover'));
const LogoOptions = lazy(() => import('./pages/LogoOptions'));
export type Config = { baseDomain: string | null; publicUrl?: string | null; simulator: boolean; selfRegistration: boolean; mpesa?: boolean; google?: boolean };

/** Em `<evento>.<dominio-base>` a raiz mostra a página pública do evento. */
function subdomainOf(host: string, base: string | null) {
  if (!base || !host.endsWith('.' + base)) return null;
  const sub = host.slice(0, -(base.length + 1));
  return sub && !sub.includes('.') ? sub : null;
}

const SPA_PATHS = /^(\/|\/events|\/e\/[^/]+|\/o\/[0-9a-f-]{36}|\/t\/[\w-]+|\/account|\/account\/profile|\/register|\/newsletter\/unsubscribe)\/?$/;
const cachedCfg = (): Config | null => { try { return JSON.parse(localStorage.getItem('bp_cfg') ?? 'null'); } catch { return null; } };

/** Navegação sem recarregar a página (como numa app): os separadores e as ligações internas mudam o ecrã de imediato. */
function App() {
  const [cfg, setCfg] = useState<Config | null>(() => { const c = cachedCfg(); if (c) setRuntime(c); return c; }); // configuração em cache: arranque sem espera
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    fetch('/public/config').then((r) => r.json()).then((c) => { setRuntime(c); try { localStorage.setItem('bp_cfg', JSON.stringify(c)); } catch { /* sem armazenamento */ } setCfg(c); })
      .catch(() => setCfg((cur) => cur ?? { baseDomain: null, simulator: false, selfRegistration: false }));
  }, []);
  useEffect(() => {
    const sync = () => { setPath(location.pathname); window.scrollTo(0, 0); };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let u: URL; try { u = new URL(a.href, location.href); } catch { return; }
      if (u.origin !== location.origin || !SPA_PATHS.test(u.pathname)) return;
      e.preventDefault();
      if (u.pathname + u.search !== location.pathname + location.search) history.pushState(null, '', u.pathname + u.search + u.hash);
      sync();
    };
    window.addEventListener('popstate', sync);
    document.addEventListener('click', click);
    return () => { window.removeEventListener('popstate', sync); document.removeEventListener('click', click); };
  }, []);
  if (!cfg) return <div className="splash"><img src="/icon-192.png" alt="" width="84" height="84" /></div>;
  return <>
    <Routes key={path} cfg={cfg} path={path} />
    {path !== '/events' && <BackToTop />}
    {!/^\/(platform|company|staff)(\/|$)/.test(path) && <InstallBanner />}
  </>;
}

function Routes({ cfg, path }: { cfg: Config; path: string }) {
  // endereços antigos (em português) continuam a funcionar e passam para os novos, em inglês
  const legacy = [[/^\/conta\/?$/, '/account'], [/^\/eventos\/?$/, '/events'], [/^\/registo\/?$/, '/register'], [/^\/logo-opcoes\/?$/, '/logo-options'], [/^\/empresa\/([a-z0-9-]+)\/?$/, '/company/$1']] as const;
  for (const [re, to] of legacy) if (re.test(path)) { location.replace(path.replace(re, to) + location.search); return null; }
  const sub = subdomainOf(location.hostname, cfg.baseDomain);
  // backoffice da Bilhete+: vive em platform.<domínio>; em qualquer outro endereço /platform leva para lá
  const platformHost = !!cfg.baseDomain && location.hostname === `platform.${cfg.baseDomain}`;
  if (platformHost) {
    if (/^\/company(\/|$)/.test(path) && cfg.publicUrl) { location.replace(cfg.publicUrl + path); return null; }
    return <Staff area="platform" cfg={cfg} />;
  }
  if (cfg.baseDomain && /^\/platform(\/|$)/.test(path)) { location.replace(`https://platform.${cfg.baseDomain}`); return null; }
  // as áreas de empresa ficam só no endereço principal: num subdomínio de evento voltam para lá
  if (sub && /^\/company(\/|$)/.test(path) && cfg.publicUrl) { location.replace(cfg.publicUrl + path); return null; }
  let m: RegExpExecArray | null;
  if ((m = /^\/e\/([a-z0-9-]+)$/.exec(path))) return <PublicEvent slug={m[1]} cfg={cfg} />;
  if ((m = /^\/o\/([0-9a-f-]{36})$/.exec(path))) return <Order id={m[1]} cfg={cfg} />;
  if ((m = /^\/t\/([\w-]+)$/.exec(path))) return <Wallet token={m[1]} cfg={cfg} />;
  if (path === '/account/done') return <Suspense fallback={null}><AccountDone /></Suspense>;
  if (path === '/newsletter/unsubscribe') return <Suspense fallback={null}><Unsubscribe /></Suspense>;
  if (path === '/account' || path === '/account/') return <Suspense fallback={null}><AccountPage view="tickets" /></Suspense>;
  if (path === '/account/profile' || path === '/account/profile/') return <Suspense fallback={null}><AccountPage view="profile" /></Suspense>;
  if (path === '/app' || path === '/app/') { location.replace('/events'); return null; } // início da app instalada
  if (path === '/logo-options') return <Suspense fallback={null}><LogoOptions /></Suspense>;
  if (path === '/events') return <Suspense fallback={null}><Discover /></Suspense>;
  if (path === '/register') return cfg.selfRegistration ? <Register /> : <RegistrationClosed />;
  if ((m = /^\/company\/([a-z0-9-]+)\/?$/.exec(path))) return <Staff orgSlug={m[1]} cfg={cfg} />;
  if (path === '/platform' || path === '/platform/') return <Staff area="platform" cfg={cfg} />;
  if (path.startsWith('/staff')) { location.replace('/'); return null; } // endereço antigo: já não é divulgado
  if (sub && path === '/') return <PublicEvent slug={sub} cfg={cfg} />;
  return <Home canRegister={cfg.selfRegistration} />;
}

captureInstallPrompt();
installTranslator();
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={null}><App /></Suspense></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
