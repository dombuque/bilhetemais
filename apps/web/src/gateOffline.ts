// Validação de entradas sem rede: o dispositivo guarda só os HASHES dos bilhetes (não consegue forjar códigos),
// valida localmente, regista as leituras numa fila e sincroniza quando a rede voltar.
export interface Manifest { generatedAt: string; endsAt: string; reentryAllowed: boolean; tickets: { h: string; k?: string; s: 'ISSUED' | 'USED' | 'REVOKED' | 'BLOCKED'; i?: boolean }[] }
export type Direction = 'IN' | 'OUT';
export interface QueuedScan { clientId: string; token: string; at: string; gateId?: string; localResult: string; direction?: Direction }

export const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Armazenamento em IndexedDB (muito mais espaço e mais fiável que localStorage, que o Safari apaga após 7 dias sem uso).
// Se o IndexedDB não existir, recorre ao localStorage. Dados antigos em localStorage são migrados na primeira leitura.
const DB = 'bp_gate', STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;
const openDb = () => dbp ??= new Promise<IDBDatabase>((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('sem IndexedDB'));
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => { dbp = null; rej(r.error); };
});
const idbGet = async <T,>(k: string): Promise<T | undefined> => { const db = await openDb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result as T | undefined); q.onerror = () => rej(q.error); }); };
const idbPut = async (k: string, v: unknown): Promise<void> => { const db = await openDb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
const lsGet = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const lsPut = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

async function get<T>(k: string): Promise<T | null> {
  try {
    const v = await idbGet<T>(k);
    if (v !== undefined) return v;
    const old = lsGet<T>(k); // migração de dados antigos
    if (old !== null) { try { await idbPut(k, old); localStorage.removeItem(k); } catch { /* fica onde está */ } }
    return old;
  } catch { return lsGet<T>(k); }
}
async function put(k: string, v: unknown): Promise<boolean> {
  try { await idbPut(k, v); return true; } catch { return lsPut(k, v); }
}

/** Pede ao navegador que não apague estes dados por falta de uso ou de espaço. */
export const requestPersistentStorage = async (): Promise<boolean> => { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } };

export const loadManifest = (eventId: string) => get<Manifest>('bp_manifest_' + eventId);
export const saveManifest = (eventId: string, m: Manifest) => put('bp_manifest_' + eventId, m);
export const loadQueue = async (eventId: string) => (await get<QueuedScan[]>('bp_queue_' + eventId)) ?? [];
export const saveQueue = (eventId: string, q: QueuedScan[]) => put('bp_queue_' + eventId, q);
/** Acrescenta uma leitura à fila (serializado, para duas leituras seguidas nunca se perderem). */
let chain: Promise<unknown> = Promise.resolve();
export const enqueueScan = (eventId: string, s: QueuedScan) => (chain = chain.then(async () => put('bp_queue_' + eventId, [...(await loadQueue(eventId)), s])).catch(() => false)) as Promise<boolean>;
/** Remove da fila só as leituras já enviadas (as feitas entretanto ficam). */
export const dequeueScans = (eventId: string, sentIds: Set<string>) => (chain = chain.then(async () => put('bp_queue_' + eventId, (await loadQueue(eventId)).filter((x) => !sentIds.has(x.clientId)))).catch(() => false)) as Promise<boolean>;

/** Decide a leitura com a lista local e actualiza-a (um bilhete usado não volta a entrar neste dispositivo). */
export async function validateLocal(m: Manifest, token: string, direction: Direction = 'IN', now = new Date()): Promise<{ result: string; manifest: Manifest }> {
  // o código curto («ABCD-EFGH») também é aceite: compara-se o seu hash com o campo k
  const short = token.toUpperCase().replace(/[\s-]/g, '');
  const h = /^[A-Z2-9]{8}$/.test(short) ? await sha256Hex(short) : await sha256Hex(token);
  const t = m.tickets.find((x) => x.h === h || x.k === h);
  if (!t) return { result: 'UNAUTHORIZED', manifest: m };
  const set = (patch: Partial<Manifest['tickets'][number]>): Manifest => ({ ...m, tickets: m.tickets.map((x) => (x.h === t.h ? { ...x, ...patch } : x)) });
  if (direction === 'OUT') return t.i ? { result: 'EXIT_OK', manifest: set({ i: false }) } : { result: 'NOT_INSIDE', manifest: m }; // só sai quem entrou
  if (t.s === 'REVOKED') return { result: 'REVOKED', manifest: m };
  if (t.s === 'BLOCKED') return { result: 'BLOCKED', manifest: m };
  if (new Date(m.endsAt) < now) return { result: 'EXPIRED', manifest: m };
  if (t.s === 'USED' && !m.reentryAllowed) return { result: 'ALREADY_USED', manifest: m };
  if (t.i) return { result: 'ALREADY_INSIDE', manifest: m };
  return { result: 'VALID', manifest: set({ s: 'USED', i: true }) };
}

export const newClientId = () => crypto.randomUUID();
