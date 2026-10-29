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

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  useEffect(() => { fetch('/public/config').then((r) => r.json()).then((c) => { setRuntime(c); setCfg(c); }).catch(() => setCfg({ baseDomain: null, simulator: false, selfRegistration: false })); }, []);
  if (!cfg) return null;

  // endereços antigos (em português) continuam a funcionar e passam para os novos, em inglês
  const legacy = [[/^\/conta\/?$/, '/account'], [/^\/eventos\/?$/, '/events'], [/^\/registo\/?$/, '/register'], [/^\/logo-opcoes\/?$/, '/logo-options'], [/^\/empresa\/([a-z0-9-]+)\/?$/, '/company/$1']] as const;
  for (const [re, to] of legacy) if (re.test(location.pathname)) { location.replace(location.pathname.replace(re, to) + location.search); return null; }
  const path = location.pathname;
  const sub = subdomainOf(location.hostname, cfg.baseDomain);
  // as áreas privadas ficam só no endereço principal: num subdomínio de evento voltam para lá
  if (sub && /^\/(platform|company)(\/|$)/.test(path) && cfg.publicUrl) { location.replace(cfg.publicUrl + path); return null; }
  let m: RegExpExecArray | null;
  if ((m = /^\/e\/([a-z0-9-]+)$/.exec(path))) return <PublicEvent slug={m[1]} cfg={cfg} />;
  if ((m = /^\/o\/([0-9a-f-]{36})$/.exec(path))) return <Order id={m[1]} cfg={cfg} />;
  if ((m = /^\/t\/([\w-]+)$/.exec(path))) return <Wallet token={m[1]} cfg={cfg} />;
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
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={null}><App /></Suspense>{location.pathname !== '/events' && <BackToTop />}{!/^\/(platform|company|staff)(\/|$)/.test(location.pathname) && <InstallBanner />}</StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
