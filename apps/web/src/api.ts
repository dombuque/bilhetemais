import { locale } from './i18n';
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

const KEY = 'bp_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

const MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Saldo insuficiente.',
  CREDENTIAL_INVALID: 'Credencial inválida, bloqueada ou de outro evento.',
  WALLET_BLOCKED: 'Carteira bloqueada.',
  INVALID_AMOUNT: 'Valor inválido.',
  NOT_FOUND: 'Não encontrado.',
  MFA_REQUIRED: 'Introduza o código de verificação.',
};

/** Configuração pública (domínio base dos eventos e endereço principal), guardada ao arrancar. */
let runtime: { baseDomain: string | null; publicUrl: string | null } = { baseDomain: null, publicUrl: null };
export const setRuntime = (c: { baseDomain?: string | null; publicUrl?: string | null }) => { runtime = { baseDomain: c.baseDomain ?? null, publicUrl: c.publicUrl ?? null }; };
/** Endereço de um evento: o seu subdomínio (`feira.bilhetemais.live`) quando há domínio base; senão `/e/<evento>`. */
export const eventUrl = (slug: string) => (runtime.baseDomain ? `https://${slug}.${runtime.baseDomain}` : `${location.origin}/e/${slug}`);
/** Endereço principal da plataforma (onde ficam o login com Google, a conta e as áreas privadas). */
export const mainUrl = () => runtime.publicUrl ?? location.origin;
/** Estamos num subdomínio de evento (e não no endereço principal)? */
export const onEventHost = () => !!runtime.baseDomain && location.hostname.endsWith('.' + runtime.baseDomain);

const AKEY = 'bp_account';
export const accountToken = () => { try { return localStorage.getItem(AKEY); } catch { return null; } };
export const setAccountToken = (t: string | null) => { try { t ? localStorage.setItem(AKEY, t) : localStorage.removeItem(AKEY); } catch { /* sem armazenamento */ } };

/** Pedidos da conta de participante (sessão própria, separada da equipa). */
export async function accountApi<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = accountToken();
  const r = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token && data.error === 'LOGIN_REQUIRED') setAccountToken(null); // sessão expirada
    throw new ApiError(r.status, data.error === 'LOGIN_REQUIRED' ? 'Inicie sessão para continuar.' : MESSAGES[data.error] ?? data.error ?? 'Erro de rede', data.error);
  }
  return data as T;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const r = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) { setToken(null); location.reload(); /* volta à entrada da mesma área (plataforma ou empresa) */ }
    throw new ApiError(r.status, MESSAGES[data.error] ?? data.error ?? 'Erro de rede', data.error);
  }
  return data as T;
}

/** Valores em centavos (strings do servidor) → "1 000,00 MT". */
export const mt = (minor: string | number | bigint | null | undefined) => {
  const n = BigInt(minor ?? 0);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${int},${(abs % 100n).toString().padStart(2, '0')} MT`;
};
/** "125,50" ou "125" → centavos. */
export const toMinor = (v: string) => {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  return String(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0));
};
export const dt = (s: string) => new Date(s).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
export const newKey = () => crypto.randomUUID();

/** Envia um ficheiro em bruto (imagens da marca, documentos). */
export async function upload(method: 'PUT' | 'POST', path: string, file: Blob, headers: Record<string, string> = {}) {
  const token = getToken();
  const r = await fetch(path, { method, body: file, headers: { 'content-type': file.type, ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? 'Falha no envio');
  return data;
}

/** Reduz imagens grandes antes do envio (máx. 1600 px, WebP/JPEG) para ficarem abaixo de 1 MB. */
export async function shrinkImage(file: File, maxDim = 1600): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new ApiError(400, 'Use uma imagem PNG, JPEG ou WebP');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.86));
  if (!blob || blob.size > 1_000_000) throw new ApiError(400, 'Imagem demasiado grande, escolha uma mais pequena');
  return blob;
}

/** Descarrega um ficheiro protegido (CSV…) com a sessão actual. */
export async function download(path: string, filename: string) {
  const r = await fetch(path, { headers: { authorization: 'Bearer ' + getToken() } });
  if (!r.ok) throw new ApiError(r.status, 'Não foi possível exportar');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
