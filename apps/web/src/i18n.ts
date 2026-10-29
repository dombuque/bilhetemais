import { EN as EN_PUBLIC, EN_PATTERNS as P_PUBLIC } from './locales/en';
import { EN_ADMIN, EN_ADMIN_PATTERNS } from './locales/en-admin';

const EN: Record<string, string> = { ...EN_ADMIN, ...EN_PUBLIC }; // o dicionário público tem prioridade
const EN_PATTERNS = [...P_PUBLIC, ...EN_ADMIN_PATTERNS];

export type Lang = 'pt' | 'en';
const KEY = 'bp_lang';

/** Língua escolhida pela pessoa; se nunca escolheu, a do navegador (português ou inglês). */
export function getLang(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'pt' || v === 'en') return v; } catch { /* sem armazenamento */ }
  return (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}
/** Guarda a escolha e recarrega: a página volta já na nova língua. */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* sem armazenamento */ }
  location.reload();
}
/** Código de língua para datas e números (`toLocaleString`). */
export const locale = () => (getLang() === 'en' ? 'en-GB' : 'pt-MZ');

/** Traduz um texto (mantém os espaços à volta). Devolve o próprio texto se não houver tradução. */
export function translate(text: string): string {
  const core = text.trim();
  if (!core) return text;
  let out = EN[core];
  if (out === undefined) {
    for (const [re, to] of EN_PATTERNS) { if (re.test(core)) { out = core.replace(re, to); break; } }
  }
  if (out === undefined) return text;
  const lead = text.slice(0, text.length - text.trimStart().length), tail = text.slice(text.trimEnd().length);
  return lead + out + tail;
}
/** Para texto montado no código (mensagens, títulos). */
export const t = (pt: string) => (getLang() === 'en' ? translate(pt) : pt);

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'label'];
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    const n = root as Text, v = translate(n.nodeValue ?? '');
    if (v !== n.nodeValue) n.nodeValue = v;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest('[data-no-translate]') || /^(SCRIPT|STYLE|CODE)$/.test(el.tagName)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const tv = translate(v); if (tv !== v) el.setAttribute(a, tv); } }
  el.childNodes.forEach(walk);
}

/** Em inglês, traduz a página e tudo o que o React for desenhando depois (texto e atributos). */
export function installTranslator() {
  document.documentElement.lang = getLang();
  if (getLang() !== 'en') return;
  let busy = false;
  const run = (fn: () => void) => { busy = true; try { fn(); } finally { busy = false; } };
  run(() => { walk(document.body); document.title = translate(document.title); });
  new MutationObserver((muts) => {
    if (busy) return;
    run(() => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes' && m.target instanceof Element) walk(m.target);
      }
      document.title = translate(document.title);
    });
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
