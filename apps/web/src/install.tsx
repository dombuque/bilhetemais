import { useEffect, useState } from 'react';
import { Icon, Modal } from './ui';

/** O navegador avisa que a app pode ser instalada (Chrome, Edge, Android…). Guarda-se o aviso para o botão «Instalar» o usar. */
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()); });
}

/** A correr como app instalada (sem barra do navegador)? */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { installed: isStandalone(), canPrompt: !!deferred, ios: isIOS(), prompt: async () => { if (!deferred) return false; await deferred.prompt(); const r = await deferred.userChoice; deferred = null; listeners.forEach((l) => l()); return r.outcome === 'accepted'; } };
}

/** Botão «Instalar app»: instala com um toque onde o navegador deixa; no iPhone/iPad e noutros mostra os passos. Some quando já está instalada. */
export function InstallButton({ label = 'Baixar app', className = 'lp-btn ghost sm', staff = false }: { label?: string; className?: string; staff?: boolean }) {
  const inst = useInstall();
  const [help, setHelp] = useState(false);
  if (inst.installed) return null;
  const go = async () => { if (inst.canPrompt) await inst.prompt(); else setHelp(true); };
  return (
    <>
      <button type="button" className={className} onClick={go}><Icon n="arrowdown" />{label}</button>
      {help && (
        <Modal title={staff ? 'Instalar a app da equipa' : 'Instalar a app Bilhete+'} onClose={() => setHelp(false)}>
          <p className="muted small">A app abre em ecrã inteiro, com o ícone no telemóvel, como qualquer outra.</p>
          {inst.ios
            ? <ol className="install-steps"><li>Abra esta página no <b>Safari</b>.</li><li>Toque em <b>Partilhar</b> <span aria-hidden="true">⬆️</span> (em baixo ou no topo).</li><li>Escolha <b>«Adicionar ao ecrã principal»</b> e confirme.</li></ol>
            : <ol className="install-steps"><li>Abra o <b>menu do navegador</b> (⋮ no Chrome, ⋯ no Edge).</li><li>Toque em <b>«Instalar app»</b> ou <b>«Adicionar ao ecrã principal»</b>.</li><li>Confirme. O ícone do Bilhete+ aparece no telemóvel.</li></ol>}
        </Modal>)}
    </>
  );
}
