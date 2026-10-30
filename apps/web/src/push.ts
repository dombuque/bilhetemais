import { accountApi } from './api';
import { isStandalone } from './install';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** O aparelho consegue receber notificações? (no iPhone só com a app instalada no ecrã principal) */
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (!isIOS() || isStandalone());
export const pushPermission = () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission);

const b64 = (s: string) => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

/** Posição aproximada do aparelho (sem pedir de novo se já foi recusada). `ask`: pode pedir a permissão. */
async function coarseLocation(ask: boolean): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!('geolocation' in navigator)) return null;
    const st = (await (navigator as any).permissions?.query({ name: 'geolocation' }).catch(() => null))?.state;
    if (st === 'denied' || (st !== 'granted' && !ask)) return null;
    return await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 3600_000 }));
  } catch { return null; }
}

/** Já há uma subscrição neste aparelho? */
export async function pushActive(): Promise<boolean> {
  try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); } catch { return false; }
}
/** Pede a permissão, subscreve e regista no servidor (ligada à conta, se houver sessão). */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const cfg = await fetch('/public/push/config').then((r) => r.json()).catch(() => ({ publicKey: null }));
  if (!cfg.publicKey) return false;
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await freshSubscription(reg, cfg.publicKey);
  const location = await coarseLocation(true); // os avisos de novos eventos são só da sua zona (150 km)
  await accountApi('POST', '/public/push/subscribe', { subscription: sub.toJSON(), topics: ['events', 'tickets'], ...(location ? { location } : {}) });
  return true;
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);
/** A subscrição tem de ser da chave actual do servidor; se a chave mudou, a antiga já não recebe nada e refaz-se. */
async function freshSubscription(reg: ServiceWorkerRegistration, publicKey: string) {
  const key = b64(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  return sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
}

/** Ao abrir a app: se as notificações já estão permitidas, confirma que a subscrição é válida e está ligada à conta. */
export async function syncPush(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    if (!(await reg.pushManager.getSubscription())) return; // só mantém o que a pessoa já ligou
    const cfg = await fetch('/public/push/config').then((r) => r.json()).catch(() => ({ publicKey: null }));
    if (!cfg.publicKey) return;
    const sub = await freshSubscription(reg, cfg.publicKey);
    const location = await coarseLocation(false); // só se a permissão já foi dada: nunca pede sozinha ao abrir
    await accountApi('POST', '/public/push/subscribe', { subscription: sub.toJSON(), topics: ['events', 'tickets'], ...(location ? { location } : {}) });
  } catch { /* sem rede ou sem suporte */ }
}
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await accountApi('POST', '/public/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
