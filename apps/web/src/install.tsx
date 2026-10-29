import { useEffect, useState } from 'react';
import { Icon } from './ui';

/** O navegador avisa que a app pode ser instalada (Chrome, Edge, Android…). Guarda-se o aviso para o botão «Instalar» o usar. */
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const FLAG = 'bp_app_installed';
const flagged = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
const setFlag = () => { try { localStorage.setItem(FLAG, '1'); } catch { /* sem armazenamento */ } };
let related = false; // o navegador diz que a app já está instalada neste aparelho (Chrome/Edge no Android)
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { deferred = null; setFlag(); listeners.forEach((l) => l()); });
  if (isStandalone()) setFlag(); // aberta como app: fica registado para o navegador também o saber
  (navigator as any).getInstalledRelatedApps?.().then((apps: unknown[]) => { if (apps?.length) { related = true; setFlag(); listeners.forEach((l) => l()); } }).catch(() => {});
}

/** A correr como app instalada (sem barra do navegador)? */
export function isStandalone() {
  return !!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { installed: isStandalone() || related || flagged(), canPrompt: !!deferred, ios: isIOS(), prompt: async () => { if (!deferred) return false; await deferred.prompt(); const r = await deferred.userChoice; deferred = null; listeners.forEach((l) => l()); return r.outcome === 'accepted'; } };
}

/** Botão «Instalar app»: um toque e o próprio navegador instala (só pede a permissão). Só aparece onde isso é possível e a app ainda não está instalada. */
export function InstallButton({ label = 'Baixar app', className = 'lp-btn ghost sm' }: { label?: string; className?: string; staff?: boolean }) {
  const inst = useInstall();
  if (inst.installed || !inst.canPrompt) return null;
  return <button type="button" className={className} onClick={() => { void inst.prompt(); }}><Icon n="arrowdown" />{label}</button>;
}

const DISMISS = 'bp_install_dismissed';
/** Barra fixa em baixo, só no telemóvel e só se o aparelho ainda NÃO tem a app e o navegador a pode instalar: um toque em «Instalar». Fecha-se e não volta durante 14 dias. */
export function InstallBanner() {
  const inst = useInstall();
  const [hidden, setHidden] = useState(() => { try { return Date.now() - Number(localStorage.getItem(DISMISS) ?? 0) < 14 * 864e5; } catch { return false; } });
  // iPhone/iPad: o Safari não avisa nem deixa instalar sozinho; o toque abre a folha de partilhar, onde «Adicionar ao ecrã principal» fica a um toque
  const ios = inst.ios && typeof navigator.share === 'function';
  if (inst.installed || hidden || !(inst.canPrompt || ios)) return null;
  const close = () => { try { localStorage.setItem(DISMISS, String(Date.now())); } catch { /* sem armazenamento */ } setHidden(true); };
  return (
    <div className="install-banner" role="region" aria-label="Instalar a app">
      <img src="/icon-192.png" alt="" width="44" height="44" />
      <div><b>Bilhete+ no seu telemóvel</b><small>{inst.canPrompt ? 'Eventos e bilhetes sempre à mão, em ecrã inteiro.' : 'Toque em Instalar e depois em «Adicionar ao ecrã principal».'}</small></div>
      <button type="button" className="ib-go" onClick={async () => { if (inst.canPrompt) { await inst.prompt(); close(); } else { try { await navigator.share({ title: 'Bilhete+', url: location.origin }); } catch { /* cancelado */ } } }}>Instalar</button>
      <button type="button" className="ib-x" aria-label="Fechar" onClick={close}><Icon n="x" /></button>
    </div>
  );
}
