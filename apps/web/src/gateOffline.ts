// Validação de entradas sem rede: o dispositivo guarda só os HASHES dos bilhetes (não consegue forjar códigos),
// valida localmente, regista as leituras numa fila e sincroniza quando a rede voltar.
export interface Manifest { generatedAt: string; endsAt: string; reentryAllowed: boolean; tickets: { h: string; k?: string; s: 'ISSUED' | 'USED' | 'REVOKED' | 'BLOCKED'; i?: boolean }[] }
export type Direction = 'IN' | 'OUT';
export interface QueuedScan { clientId: string; token: string; at: string; gateId?: string; localResult: string; direction?: Direction }

export const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const get = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const loadManifest = (eventId: string) => get<Manifest>('bp_manifest_' + eventId);
export const saveManifest = (eventId: string, m: Manifest) => put('bp_manifest_' + eventId, m);
export const loadQueue = (eventId: string) => get<QueuedScan[]>('bp_queue_' + eventId) ?? [];
export const saveQueue = (eventId: string, q: QueuedScan[]) => put('bp_queue_' + eventId, q);

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
