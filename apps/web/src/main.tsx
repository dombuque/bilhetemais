import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/sora';
import '@fontsource-variable/inter';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { BackToTop } from './ui';
import { Home } from './pages/Landing';
// cada página carrega à parte: quem abre a página inicial (ou o bilhete) não descarrega o código da equipa
const PublicEvent = lazy(() => import('./pages/Public').then((m) => ({ default: m.PublicEvent })));
const Order = lazy(() => import('./pages/Public').then((m) => ({ default: m.Order })));
const Wallet = lazy(() => import('./pages/Public').then((m) => ({ default: m.Wallet })));
const Register = lazy(() => import('./pages/Public').then((m) => ({ default: m.Register })));
const RegistrationClosed = lazy(() => import('./pages/Public').then((m) => ({ default: m.RegistrationClosed })));
const Staff = lazy(() => import('./pages/Staff').then((m) => ({ default: m.Staff })));

const Discover = lazy(() => import('./pages/Discover'));
const LogoOptions = lazy(() => import('./pages/LogoOptions'));
export type Config = { baseDomain: string | null; simulator: boolean; selfRegistration: boolean; mpesa?: boolean };

/** Em `<evento>.<dominio-base>` a raiz mostra a página pública do evento. */
function subdomainOf(host: string, base: string | null) {
  if (!base || !host.endsWith('.' + base)) return null;
  const sub = host.slice(0, -(base.length + 1));
  return sub && !sub.includes('.') ? sub : null;
}

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  useEffect(() => { fetch('/public/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ baseDomain: null, simulator: false, selfRegistration: false })); }, []);
  if (!cfg) return null;

  const path = location.pathname;
  const sub = subdomainOf(location.hostname, cfg.baseDomain);
  let m: RegExpExecArray | null;
  if ((m = /^\/e\/([a-z0-9-]+)$/.exec(path))) return <PublicEvent slug={m[1]} cfg={cfg} />;
  if ((m = /^\/o\/([0-9a-f-]{36})$/.exec(path))) return <Order id={m[1]} cfg={cfg} />;
  if ((m = /^\/t\/([\w-]+)$/.exec(path))) return <Wallet token={m[1]} cfg={cfg} />;
  if (path === '/logo-opcoes') return <Suspense fallback={null}><LogoOptions /></Suspense>;
  if (path === '/eventos') return <Suspense fallback={null}><Discover /></Suspense>;
  if (path === '/registo') return cfg.selfRegistration ? <Register /> : <RegistrationClosed />;
  if ((m = /^\/empresa\/([a-z0-9-]+)\/?$/.exec(path))) return <Staff orgSlug={m[1]} cfg={cfg} />;
  if (path.startsWith('/staff')) return <Staff cfg={cfg} />;
  if (sub && path === '/') return <PublicEvent slug={sub} cfg={cfg} />;
  return <Home canRegister={cfg.selfRegistration} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={null}><App /></Suspense>{location.pathname !== '/eventos' && <BackToTop />}</StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
