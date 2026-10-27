/** Entrada com Google (OAuth 2.0, código + PKCE). Só fica activa com GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET. */
export interface GoogleProfile { sub: string; email: string; emailVerified: boolean; name: string }
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Troca o código pelos dados da conta Google. Substituível nos testes. */
  exchange?: (code: string, verifier: string, redirectUri: string) => Promise<GoogleProfile>;
}

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function googleFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : null;
}

export function authorizeUrl(cfg: GoogleConfig, p: { redirectUri: string; state: string; challenge: string }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: p.redirectUri, response_type: 'code', scope: 'openid email profile',
    state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<GoogleProfile> {
  if (cfg.exchange) return cfg.exchange(code, verifier, redirectUri);
  const tr = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const tok: any = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) throw new Error('google: troca do código recusada');
  const ur = await fetchImpl(USERINFO_URL, { headers: { authorization: 'Bearer ' + tok.access_token }, signal: AbortSignal.timeout(15_000) });
  const u: any = await ur.json().catch(() => ({}));
  if (!ur.ok || !u.sub || !u.email) throw new Error('google: dados da conta indisponíveis');
  return { sub: String(u.sub), email: String(u.email).toLowerCase(), emailVerified: u.email_verified === true || u.email_verified === 'true', name: String(u.name ?? u.email) };
}
