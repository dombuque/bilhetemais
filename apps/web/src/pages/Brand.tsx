import { useEffect, useRef, useState } from 'react';
import { api, shrinkImage, upload } from '../api';
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, FONTS, PRESETS, contrast, inkFor, themeStyle, type Theme } from '../theme';
import { Field, Icon, useAction } from '../ui';

const FONT_LABEL: Record<string, string> = { system: 'Moderna (padrão)', serif: 'Clássica (serifada)', rounded: 'Arredondada', mono: 'Técnica' };

/**
 * Editor de identidade visual. Serve a empresa (valores por omissão) e o evento (substitui os da empresa).
 * `base` é o prefixo da API: `/org` ou `/events/<id>`.
 */
export function BrandEditor({ base, theme, assets, inherited, onChange, toast }: {
  base: string; theme: Theme; assets: string[]; inherited?: Theme; onChange: () => void; toast: (m: string, e?: boolean) => void;
}) {
  const [t, setT] = useState<Theme>(theme);
  const { busy, run } = useAction(toast);
  useEffect(() => setT(theme), [theme]);
  const eff = { ...inherited, ...t };
  const primary = eff.primary ?? DEFAULT_PRIMARY;
  const set = (k: keyof Theme, v: string) => setT((x) => ({ ...x, [k]: v || undefined }));
  const ratio = contrast(primary, inkFor(primary));

  const save = () => run(async () => { await api('PUT', `${base}/theme`, t); onChange(); }, 'Aparência guardada');
  const send = (kind: 'logo' | 'cover') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) await run(async () => { await upload('PUT', `${base}/assets/${kind}`, await shrinkImage(f, kind === 'cover' ? 1600 : 600)); onChange(); }, kind === 'logo' ? 'Logótipo actualizado' : 'Capa actualizada');
  };
  const remove = (kind: 'logo' | 'cover') => run(async () => { await api('DELETE', `${base}/assets/${kind}`); onChange(); }, 'Imagem removida');
  const logoRef = useRef<HTMLInputElement>(null), coverRef = useRef<HTMLInputElement>(null);

  return (
    <div className="grid two">
      <div className="stack">
        <div className="card stack">
          <h3>Cores</h3>
          <div className="chips">{PRESETS.map((p) => (
            <button key={p.name} className={'swatch' + (primary === p.primary ? ' on' : '')} title={p.name} aria-label={p.name} style={{ background: `linear-gradient(135deg, ${p.primary} 60%, ${p.accent} 60%)` }} onClick={() => setT((x) => ({ ...x, primary: p.primary, accent: p.accent }))} />
          ))}</div>
          <div className="field-row">
            <Field label="Cor principal"><input type="color" value={eff.primary ?? DEFAULT_PRIMARY} onChange={(e) => set('primary', e.target.value)} /></Field>
            <Field label="Cor de destaque"><input type="color" value={eff.accent ?? DEFAULT_ACCENT} onChange={(e) => set('accent', e.target.value)} /></Field>
          </div>
          {ratio < 4.5 && <p className="small" style={{ color: 'var(--warn)' }}>Esta cor tem pouco contraste com o texto; o texto sobre ela pode ficar difícil de ler.</p>}
        </div>
        <div className="card stack">
          <h3>Imagens</h3>
          {(['logo', 'cover'] as const).map((k) => (
            <div key={k} className="between">
              <span>{k === 'logo' ? 'Logótipo' : 'Imagem de capa'} {assets.includes(k) ? <span className="pill ok">definido</span> : <span className="pill">{k === 'logo' ? 'usa o da empresa, se houver' : 'não definido'}</span>}</span>
              <span className="inline">
                <input ref={k === 'logo' ? logoRef : coverRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={send(k)} />
                <button className="ghost sm" disabled={busy} onClick={() => (k === 'logo' ? logoRef : coverRef).current?.click()}>Escolher</button>
                {assets.includes(k) && <button className="danger ghost sm" disabled={busy} onClick={() => remove(k)} aria-label={`Remover ${k}`}><Icon n="x" /></button>}
              </span>
            </div>
          ))}
          <p className="muted small">PNG, JPEG ou WebP. As imagens são reduzidas automaticamente.</p>
        </div>
        <div className="card stack">
          <h3>Texto e estilo</h3>
          <Field label="Frase de apresentação"><input maxLength={120} value={t.tagline ?? ''} placeholder={inherited?.tagline ?? 'Ex.: Dois dias de música e cultura'} onChange={(e) => set('tagline', e.target.value)} /></Field>
          <div className="field-row">
            <Field label="Texto do botão de compra"><input maxLength={24} value={t.ctaLabel ?? ''} placeholder="Comprar" onChange={(e) => set('ctaLabel', e.target.value)} /></Field>
            <Field label="Tipo de letra"><select value={t.font ?? ''} onChange={(e) => set('font', e.target.value)}><option value="">{inherited?.font ? 'Da empresa' : 'Moderna (padrão)'}</option>{Object.keys(FONTS).map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}</select></Field>
          </div>
          <Field label="Cabeçalho da página"><select value={t.heroStyle ?? ''} onChange={(e) => set('heroStyle', e.target.value)}><option value="">Gradiente (padrão)</option><option value="solid">Cor lisa</option><option value="image">Imagem de capa</option></select></Field>
          <button disabled={busy} onClick={save}>Guardar aparência</button>
        </div>
      </div>
      <div className="stack">
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <h3 style={{ marginBottom: 10 }}>Pré-visualização</h3>
          <div className="preview themed" style={{ ...themeStyle(eff), background: 'var(--bg)' }}>
            <section className="hero" style={eff.heroStyle === 'solid' ? { background: 'var(--brand)' } : undefined}>
              <h2>Nome do evento</h2>{eff.tagline && <p>{eff.tagline}</p>}<p style={{ opacity: .85, fontSize: '.85rem', marginTop: 6 }}>Sáb, 12 Out · Maputo</p>
            </section>
            <div className="card" style={{ marginTop: 10 }}>
              <div className="ticket-row"><div><b>Geral</b><div className="muted small">500,00 MT</div></div><span className="stepper"><button type="button" tabIndex={-1}><Icon n="plus" /></button></span></div>
              <button className="wide" tabIndex={-1}>{eff.ctaLabel || 'Comprar'}</button>
              <p style={{ marginTop: 10 }}><a href="#preview" onClick={(e) => e.preventDefault()}>Ligação de exemplo</a></p>
            </div>
          </div>
          {eff.heroStyle === 'image' && !assets.includes('cover') && <p className="muted small" style={{ marginTop: 8 }}>Escolha uma imagem de capa para este estilo.</p>}
        </div>
      </div>
    </div>
  );
}
