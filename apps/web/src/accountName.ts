import { useEffect, useState } from 'react';
import { accountApi, accountToken } from './api';

const KEY = 'bp_acct_name';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

/** «Erasmo Buque» → «Erasmo»; nomes muito longos são cortados. */
export const shortName = (full: string) => {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first.length > 14 ? first.slice(0, 13) + '…' : first;
};

/** Primeiro nome de quem tem sessão iniciada (ou null). Usa o último valor conhecido enquanto confirma com o servidor. */
export function useAccountName(): string | null {
  const [name, setName] = useState<string | null>(() => (accountToken() ? read() : null));
  useEffect(() => {
    if (!accountToken()) { write(null); setName(null); return; }
    accountApi('GET', '/account/me').then((r) => { const n = shortName(r.account.name); write(n); setName(n); }).catch(() => { setName(null); });
  }, []);
  return name;
}
