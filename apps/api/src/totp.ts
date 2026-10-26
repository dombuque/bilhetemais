import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32 = (buf: Buffer) => {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
const fromBase32 = (s: string) => {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '')) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};

export const newSecret = () => base32(randomBytes(20));
export const otpauthUrl = (secret: string, account: string, issuer = 'Bilhete+') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** RFC 6238 (SHA-1, 6 dígitos, 30 s). */
const hotp = (secret: string, counter: number) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', fromBase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
};
export const totpAt = (secret: string, t = Date.now()) => hotp(secret, Math.floor(t / 30_000));

/** Verifica o código com tolerância de ±1 passo; devolve o passo usado (para impedir reutilização) ou null. */
export function verifyTotp(secret: string, code: string, lastStep?: number | null, t = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(t / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    const a = Buffer.from(hotp(secret, s)), b = Buffer.from(code);
    if (timingSafeEqual(a, b) && (lastStep == null || s > lastStep)) return s;
  }
  return null;
}

/** O segredo TOTP guarda-se cifrado; a chave deriva do segredo da aplicação. */
const key = (appSecret: string) => Buffer.from(hkdfSync('sha256', appSecret, 'bilheteplus', 'mfa-secret', 32));
export const sealSecret = (secret: string, appSecret: string) => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(appSecret), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};
export const openSecret = (sealed: string, appSecret: string) => {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(appSecret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};

export const newRecoveryCodes = (n = 8) => Array.from({ length: n }, () => base32(randomBytes(6)).slice(0, 10).replace(/(.{5})/, '$1-'));
export const hashRecovery = (code: string) => createHash('sha256').update(code.replace(/[^A-Z2-7]/gi, '').toUpperCase()).digest('hex');
