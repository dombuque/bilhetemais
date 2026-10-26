import type { CSSProperties } from 'react';

export interface Theme { primary?: string; accent?: string; heroStyle?: 'gradient' | 'solid' | 'image'; font?: 'system' | 'serif' | 'rounded' | 'mono'; tagline?: string; ctaLabel?: string }
export interface Assets { logo: number | null; cover: number | null }

export const DEFAULT_PRIMARY = '#5b2eff';
export const DEFAULT_ACCENT = '#ffb020';
export const PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: 'Violeta', primary: '#5b2eff', accent: '#ffb020' }, { name: 'Esmeralda', primary: '#0a7d3b', accent: '#ffcc00' },
  { name: 'Carmim', primary: '#c2185b', accent: '#ffd54f' }, { name: 'Oceano', primary: '#0b6bcb', accent: '#2ee6c5' },
  { name: 'Laranja', primary: '#e65100', accent: '#263238' }, { name: 'Grafite', primary: '#263238', accent: '#ff7043' },
];
export const FONTS: Record<string, string> = {
  system: "'Segoe UI', Inter, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "'Trebuchet MS', 'Segoe UI Rounded', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const mix = (hex: string, withHex: string, t: number) => { const a = rgb(hex), b = rgb(withHex); return toHex(a.map((v, i) => v * (1 - t) + b[i] * t)); };

/** Texto sobre a cor de marca: branco ou escuro, o que tiver melhor contraste. */
export const inkFor = (hex: string) => (contrast(hex, '#ffffff') >= contrast(hex, '#17163a') ? '#ffffff' : '#17163a');
/** Aproxima a cor do fundo até atingir contraste legível (para ligações e botões secundários). */
const readableOn = (hex: string, bg: string, toward: string) => { let c = hex; for (let i = 0; i < 20 && contrast(c, bg) < 4.5; i++) c = mix(c, toward, 0.12); return c; };

/** Variáveis CSS do tema (aplicadas num contentor; tudo o resto herda). */
export function themeStyle(t: Theme | undefined): CSSProperties {
  const primary = t?.primary ?? DEFAULT_PRIMARY, accent = t?.accent ?? DEFAULT_ACCENT;
  return {
    '--brand': primary,
    '--brand-ink': inkFor(primary),
    // variáveis derivadas têm de ser recalculadas aqui: um var() declarado na raiz não vê a cor do evento
    '--brand-2': `color-mix(in srgb, ${primary} 72%, #000)`,
    '--brand-soft': `color-mix(in srgb, ${primary} 12%, var(--surface))`,
    '--accent': accent,
    '--brand-text-l': readableOn(primary, '#ffffff', '#000000'),
    '--brand-text-d': readableOn(primary, '#1a1938', '#ffffff'),
    fontFamily: FONTS[t?.font ?? 'system'],
  } as CSSProperties;
}

export const assetUrl = (slug: string, kind: 'logo' | 'cover', v: number | null) => (v ? `/public/events/${slug}/assets/${kind}?v=${v}` : null);
