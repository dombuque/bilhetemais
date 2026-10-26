import type { ReactNode } from 'react';

const V = '#5b2eff', V2 = '#3a1fc2', A = '#ffb020', INK = '#15102f';

/** Seis direcções de logótipo para escolher. Cada símbolo cabe em 64×64. */
const SYMBOLS: { id: string; name: string; idea: string; svg: (dark: boolean) => ReactNode }[] = [
  {
    id: 'A', name: 'Pulso', idea: 'Um bilhete com a batida do evento: energia, música, ao vivo.',
    svg: () => (<>
      <rect x="2" y="8" width="60" height="48" rx="12" fill={V} />
      <circle cx="2" cy="32" r="6" fill="var(--hole)" /><circle cx="62" cy="32" r="6" fill="var(--hole)" />
      <path d="M12 34h9l4-14 7 26 6-20 3 8h11" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="53" cy="34" r="3.4" fill={A} />
    </>),
  },
  {
    id: 'B', name: 'Pin-bilhete', idea: 'O pin do mapa com recortes de bilhete: «encontre e vá».',
    svg: () => (<>
      <path d="M32 3C19 3 10 13 10 25c0 15 22 36 22 36s22-21 22-36C54 13 45 3 32 3Z" fill={V} />
      <rect x="19" y="14" width="26" height="18" rx="4" fill="#fff" />
      <circle cx="19" cy="23" r="3.6" fill={V} /><circle cx="45" cy="23" r="3.6" fill={V} />
      <path d="M32 16.5v13" stroke={V} strokeWidth="2" strokeDasharray="2.5 2.5" />
      <path d="M32 38l1.8 4.2 4.2 1.8-4.2 1.8L32 50l-1.8-4.2L26 44l4.2-1.8Z" fill={A} transform="translate(0 -3)" />
    </>),
  },
  {
    id: 'C', name: 'B em pixéis', idea: 'Um B feito de quadrados, como um QR: tecnologia e pagamentos digitais.',
    svg: () => {
      const rows = ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'];
      return (<>
        {rows.flatMap((r, y) => [...r].map((c, x) => c === '1' ? <rect key={`${x}${y}`} x={7 + x * 10.6} y={4 + y * 8} width="8.6" height="6.6" rx="1.6" fill={V} /> : null))}
        <rect x="50" y="52" width="9" height="7" rx="1.6" fill={A} />
      </>);
    },
  },
  {
    id: 'D', name: 'Só o nome', idea: 'Sem símbolo: o nome em letra pesada e o «+» como etiqueta recortada. Forte e simples.',
    svg: () => (<>
      <path d="M3 18h40v7a5 5 0 0 0 0 10v7H3z" fill={V} /><path d="M3 18h6v24H3z" fill={V2} />
      <path d="M26 24h2.6v5.4H34v2.6h-5.4v5.4H26V32h-5.4v-2.6H26Z" fill="#fff" transform="translate(0 0)" />
      <rect x="47" y="14" width="14" height="14" rx="3.5" fill={A} />
    </>),
  },
  {
    id: 'E', name: 'Entrada', idea: 'Um bilhete que aponta para a frente: entrar, avançar, «acesso concedido».',
    svg: () => (<>
      <path d="M4 12h38c3 0 5 1.2 6.600 3.400L61 32 48.600 48.600C47 50.800 45 52 42 52H4Z" fill={V} />
      <circle cx="4" cy="32" r="7" fill="var(--hole)" />
      <path d="M36 17v30" stroke="#fff" strokeOpacity=".7" strokeWidth="2.4" strokeDasharray="3.5 4" />
      <path d="M15 32h14m-6-7 7 7-7 7" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="53" cy="32" r="3.4" fill={A} />
    </>),
  },
  {
    id: 'F', name: 'Pulseira', idea: 'A pulseira NFC: o toque que paga e abre a porta. O diferencial do produto.',
    svg: () => (<>
      <path d="M44 15a24 24 0 1 0 6 8" fill="none" stroke={V} strokeWidth="11" strokeLinecap="round" />
      <path d="M26 24a12 12 0 0 1 0 16M32 19a20 20 0 0 1 0 26" fill="none" stroke={A} strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="22" cy="32" r="3.6" fill={A} />
    </>),
  },
];

const Card = ({ o, dark, size }: { o: (typeof SYMBOLS)[number]; dark: boolean; size: number }) => (
  <div style={{ ['--hole' as any]: dark ? '#0f0a2e' : '#fff', background: dark ? '#0f0a2e' : '#fff', color: dark ? '#fff' : INK, borderRadius: 18, padding: size > 40 ? '22px 24px' : '10px 12px', display: 'flex', alignItems: 'center', gap: size > 40 ? 16 : 8, border: '1px solid var(--line)' }}>
    {o.id === 'D'
      ? <><span style={{ fontFamily: "'Archivo Variable', var(--font-display)", fontStretch: '125%', fontWeight: 900, fontSize: size * 0.8, letterSpacing: '-.04em', lineHeight: 1 }}>bilhete</span>
          <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 64 64" style={{ marginLeft: -4, alignSelf: 'flex-start' }}><rect x="6" y="6" width="52" height="52" rx="12" fill={A} /><path d="M32 18v28M18 32h28" stroke={INK} strokeWidth="9" strokeLinecap="round" /></svg></>
      : <><svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={o.name}>{o.svg(dark)}</svg>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.56, letterSpacing: '-.03em', lineHeight: 1 }}>Bilhete<span style={{ color: A, fontSize: '.6em', verticalAlign: '.55em', marginLeft: 2 }}>+</span></span></>}
  </div>
);

/** Página de escolha do logótipo (temporária). */
export default function LogoOptions() {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>Escolha o logótipo</h1>
        <p className="muted" style={{ margin: '8px 0 24px' }}>Seis direcções diferentes, em fundo claro, escuro e em tamanho de ícone de separador. Diga-me a letra (ou combine, por exemplo «A com o nome do D»).</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          {SYMBOLS.map((o) => (
            <section key={o.id} className="card stack-sm">
              <div className="between"><h2>{o.id} · {o.name}</h2></div>
              <p className="muted small">{o.idea}</p>
              <Card o={o} dark={false} size={56} />
              <Card o={o} dark size={56} />
              <div className="inline">
                <Card o={o} dark={false} size={26} />
                <Card o={o} dark size={26} />
                {o.id !== 'D' && <span style={{ ['--hole' as any]: '#fff' }}><svg width="32" height="32" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill={V} /><g transform="translate(8 8) scale(.75)" style={{ ['--hole' as any]: V }}>{o.svg(true)}</g></svg></span>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
