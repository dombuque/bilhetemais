// Validação de entradas sem rede: o dispositivo guarda só os HASHES dos bilhetes (não consegue forjar códigos),
// valida localmente, regista as leituras numa fila e sincroniza quando a rede voltar.
export interface Manifest { generatedAt: string; endsAt: string; reentryAllowed: boolean; tickets: { h: string; s: 'ISSUED' | 'USED' | 'REVOKED' }[] }
export interface QueuedScan { clientId: string; token: string; at: string; gateId?: string; localResult: string }

export const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const get = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const loadManifest = (eventId: string) => get<Manifest>('bp_manifest_' + eventId);
export const saveManifest = (eventId: string, m: Manifest) => put('bp_manifest_' + eventId, m);
export const loadQueue = (eventId: string) => get<QueuedScan[]>('bp_queue_' + eventId) ?? [];
export const saveQueue = (eventId: string, q: QueuedScan[]) => put('bp_queue_' + eventId, q);

/** Decide a leitura com a lista local e actualiza-a (um bilhete usado não volta a entrar neste dispositivo). */
export async function validateLocal(m: Manifest, token: string, now = new Date()): Promise<{ result: string; manifest: Manifest }> {
  const h = await sha256Hex(token);
  const t = m.tickets.find((x) => x.h === h);
  if (!t) return { result: 'UNAUTHORIZED', manifest: m };
  if (t.s === 'REVOKED') return { result: 'REVOKED', manifest: m };
  if (new Date(m.endsAt) < now) return { result: 'EXPIRED', manifest: m };
  if (t.s === 'USED') return { result: m.reentryAllowed ? 'VALID' : 'ALREADY_USED', manifest: m };
  return { result: 'VALID', manifest: { ...m, tickets: m.tickets.map((x) => (x.h === h ? { ...x, s: 'USED' as const } : x)) } };
}

export const newClientId = () => crypto.randomUUID();
