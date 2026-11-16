import { useEffect } from 'react';

/** Mantém o ecrã ligado enquanto o componente estiver visível (portaria e POS não podem apagar a meio de uma fila).
 *  O navegador liberta o bloqueio ao esconder a página, por isso volta a pedi-lo quando ela reaparece. */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen'); if (stopped) lock.release().catch(() => {}); } catch { /* sem permissão ou bateria fraca: segue sem */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}); };
  }, [active]);
}
