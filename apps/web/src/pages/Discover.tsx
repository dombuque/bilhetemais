import { AppTabs } from '../AppTabs';
import { locale } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, eventUrl, goTo, mt } from '../api';
import { fmtDist, googleDirections, km, loadMapLibre, MAP_STYLE, MAPUTO, userDot, wazeDirections, webglOk, type MLMap } from '../map/mapkit';
import { Icon } from '../ui';

interface Item { name: string; slug: string; startsAt: string; endsAt: string; location: string | null; category: string | null; organization: string; lat: number | null; lng: number | null; primary: string | null; minPriceMinor: string | null; cover: number | null }
interface Place { name: string; lat: number; lng: number }

const CATS: Record<string, string> = { MUSICA: 'Música', FESTIVAL: 'Festival', CONFERENCIA: 'Conferência', FEIRA: 'Feira', DESPORTO: 'Desporto', TEATRO: 'Teatro', GASTRONOMIA: 'Gastronomia', EMPRESARIAL: 'Empresarial', OUTRO: 'Outro' };
const WHEN: [string, string][] = [['today', 'Hoje'], ['week', 'Esta semana'], ['month', 'Este mês']];
const price = (i: Item) => (i.minPriceMinor === null ? '' : BigInt(i.minPriceMinor) === 0n ? 'Grátis' : `${(Number(i.minPriceMinor) / 100).toLocaleString(locale(), { maximumFractionDigits: 0 })} MT`);
const dayLabel = (d: string) => new Date(d).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
const useDebounced = <T,>(v: T, ms: number) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };

/** Descoberta de eventos: mapa a ecrã inteiro, pesquisa, filtros, pins com preço e lista numa folha. */
export default function Discover() {
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [cat, setCat] = useState(params.get('category') ?? '');
  const [when, setWhen] = useState(params.get('when') ?? '');
  const [free, setFree] = useState(params.get('free') === '1');
  const [data, setData] = useState<{ items: Item[]; total: number; facets: { category: string; n: number }[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [focus, setFocus] = useState(false);
  const [sheet, setSheet] = useState<'peek' | 'half' | 'full'>('half');
  const [mapErr, setMapErr] = useState('');
  const [bounds, setBounds] = useState<{ w: number; s: number; e: number; n: number } | null>(null); // área visível (sem a parte tapada pelo painel)
  const [hover, setHover] = useState<string | null>(null); // cartão sob o rato: o pin destaca-se
  const [areaOnly, setAreaOnly] = useState(false); // lista limitada à área do mapa
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<any>(null);
  const markers = useRef<Map<string, any>>(new Map());
  const meMarker = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const dq = useDebounced(q, 300);

  // ---- dados ----
  useEffect(() => {
    const sp = new URLSearchParams();
    if (dq.trim()) sp.set('q', dq.trim());
    if (cat) sp.set('category', cat);
    if (when) sp.set('when', when);
    if (free) sp.set('free', '1');
    history.replaceState(null, '', '/events' + (sp.toString() ? '?' + sp : ''));
    api('GET', '/public/events?' + sp + (sp.toString() ? '&' : '') + 'limit=24').then(setData).catch(() => setData({ items: [], total: 0, facets: [] }));
  }, [dq, cat, when, free]);

  // ---- mapa ----
  useEffect(() => {
    let cancelled = false;
    if (new URLSearchParams(location.search).has('nomap') || !webglOk()) { setMapErr('O mapa não está disponível neste navegador. A lista continua a funcionar.'); return; }
    (async () => {
      try {
        const ml = await loadMapLibre();
        if (cancelled || !box.current) return;
        lib.current = ml;
        const m: MLMap = new ml.Map({ container: box.current, style: MAP_STYLE, center: MAPUTO, zoom: 10.6, attributionControl: { compact: true }, pitchWithRotate: false });
        m.on('error', (e: any) => { if (e?.error && /tiles|style|Failed to fetch/i.test(String(e.error.message ?? e.error))) setMapErr('Não foi possível carregar o mapa. Verifique a ligação.'); });
        m.on('load', () => { if (!cancelled) { setReady(true); setMapErr(''); } });
        m.on('click', () => setSelected(null));
        const sync = () => {
          const el = box.current; if (!el) return;
          const desktop = window.innerWidth >= 960, W = el.clientWidth, Hh = el.clientHeight;
          const sw = m.unproject([desktop ? 440 : 0, Hh - (desktop ? 0 : Math.round(window.innerHeight * 0.46))]), ne = m.unproject([W, 130]);
          setBounds({ w: sw.lng, s: sw.lat, e: ne.lng, n: ne.lat });
        };
        m.on('moveend', sync); m.on('load', sync);
        map.current = m;
      } catch { setMapErr('Não foi possível carregar o mapa.'); }
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; markers.current.clear(); };
  }, []);

  const withPins = useMemo(() => (data?.items ?? []).filter((i) => i.lat !== null && i.lng !== null), [data]);
  const sorted = useMemo(() => {
    const list = [...(data?.items ?? [])];
    if (me) list.sort((a, b) => (a.lat === null ? 1e9 : km(me.lat, me.lng, a.lat, a.lng!)) - (b.lat === null ? 1e9 : km(me.lat, me.lng, b.lat, b.lng!)));
    return list;
  }, [data, me]);
  const listed = useMemo(() => {
    const inArea = (i: Item) => !!bounds && i.lat !== null && i.lng! >= bounds.w && i.lng! <= bounds.e && i.lat >= bounds.s && i.lat <= bounds.n;
    const l = areaOnly && bounds ? sorted.filter(inArea) : sorted;
    return selected ? [...l.filter((i) => i.slug === selected), ...l.filter((i) => i.slug !== selected)] : l;
  }, [sorted, areaOnly, bounds, selected]);
  const dist = (i: Item) => (me && i.lat !== null ? fmtDist(km(me.lat, me.lng, i.lat, i.lng!)) : null);

  const fitAll = () => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !withPins.length) return;
    const b = new ml.LngLatBounds();
    withPins.forEach((i) => b.extend([i.lng!, i.lat!]));
    m.fitBounds(b, { padding: { top: 150, bottom: window.innerWidth < 960 ? Math.round(window.innerHeight * 0.45) : 80, left: window.innerWidth >= 960 ? 460 : 40, right: 40 }, maxZoom: 14, duration: 600 });
  };

  // pins (HTML) com o preço, como no Yango; o seleccionado destaca-se
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready) return;
    markers.current.forEach((mk) => mk.remove()); markers.current.clear();
    for (const i of withPins) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'pin' + (i.slug === selected ? ' on' : ''); el.setAttribute('aria-label', i.name);
      el.style.setProperty('--pin', i.primary ?? '#5b2eff');
      el.innerHTML = `<span>${price(i) || '●'}</span>`;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); setSelected(i.slug); setAreaOnly(true); });
      markers.current.set(i.slug, new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([i.lng!, i.lat!]).addTo(m));
    }
    if (!selected && withPins.length) fitAll();
  }, [withPins, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Esbate os pins fora da área e marca os da área seleccionada. */
  useEffect(() => {
    const inList = new Set(listed.map((i) => i.slug));
    markers.current.forEach((mk, slug) => mk.getElement().classList.toggle('dim', areaOnly && !inList.has(slug)));
  }, [listed, areaOnly, ready, withPins]);
  useEffect(() => { markers.current.forEach((mk, slug) => mk.getElement().classList.toggle('on', slug === selected)); }, [selected]);
  useEffect(() => { markers.current.forEach((mk, slug) => mk.getElement().classList.toggle('hover', slug === hover)); }, [hover]);
  /** Tocar no cartão abre o evento (Ctrl/Cmd+clique abre noutro separador). */
  const open = (slug: string, e: { metaKey?: boolean; ctrlKey?: boolean }) => (e.metaKey || e.ctrlKey ? window.open(eventUrl(slug), '_blank') : goTo(eventUrl(slug)));

  const sel = sorted.find((i) => i.slug === selected) ?? null;
  const flyTo = useCallback((lat: number, lng: number, zoom = 14.5) => map.current?.flyTo({ center: [lng, lat], zoom, duration: 700, padding: { bottom: window.innerWidth < 960 ? 220 : 0, left: window.innerWidth >= 960 ? 420 : 0, top: 0, right: 0 } }), []);
  useEffect(() => { if (sel && sel.lat !== null) flyTo(sel.lat, sel.lng!); document.querySelector('.sheet-list')?.scrollTo({ top: 0, behavior: 'smooth' }); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a minha posição ----
  const locate = () => {
    if (!navigator.geolocation) return setMapErr('Este navegador não dá a sua localização.');
    navigator.geolocation.getCurrentPosition((p) => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      setMe(pos); setMapErr('');
      meMarker.current?.remove();
      if (lib.current && map.current) meMarker.current = new lib.current.Marker({ element: userDot() }).setLngLat([pos.lng, pos.lat]).addTo(map.current);
      flyTo(pos.lat, pos.lng, 13);
    }, () => setMapErr('Não foi possível obter a sua localização. Permita o acesso no navegador.'), { enableHighAccuracy: true, timeout: 10000 });
  };

  // ---- sugestões de locais (pesquisa de moradas) ----
  useEffect(() => {
    if (dq.trim().length < 3 || !focus) { setPlaces([]); return; }
    let live = true;
    api('GET', '/public/geocode?q=' + encodeURIComponent(dq.trim())).then((r) => live && setPlaces(r.slice(0, 4))).catch(() => live && setPlaces([]));
    return () => { live = false; };
  }, [dq, focus]);

  // ---- folha arrastável (telemóvel) ----
  const drag = useRef<{ y: number; start: string } | null>(null);
  const order: ('peek' | 'half' | 'full')[] = ['peek', 'half', 'full'];
  const onDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, start: sheet }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y, i = order.indexOf(drag.current.start as any);
    if (Math.abs(dy) < 8) setSheet(order[(i + 1) % 3]); else setSheet(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
    drag.current = null;
  };
  const clearAll = () => { setQ(''); setCat(''); setWhen(''); setFree(false); };
  const anyFilter = q || cat || when || free;

  return (
    <>
    <div className="map-page with-tabs">
      <div ref={box} className="map-canvas" aria-label="Mapa de eventos" />
      {mapErr && <div className="map-note" role="alert">{mapErr}</div>}

      <header className="map-top">
        <div className="map-search">
          <a href="/" className="map-home" aria-label="Início"><img src="/icon.svg" alt="" /></a>
          <Icon n="scan" className="icon s" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder="Procurar eventos, locais, organizadores" aria-label="Procurar eventos" />
          {q && <button className="ghost sm clr" onClick={() => setQ('')} aria-label="Limpar"><Icon n="x" /></button>}
          {focus && places.length > 0 && (
            <ul className="map-suggest" role="listbox">
              {places.map((p) => <li key={p.name + p.lat}><button onMouseDown={() => { flyTo(p.lat, p.lng, 13.5); setPlaces([]); setFocus(false); }}><Icon n="pin" /><span>{p.name}</span></button></li>)}
            </ul>
          )}
        </div>
        <div className="map-chips" role="group" aria-label="Filtros">
          {WHEN.map(([k, l]) => <button key={k} className={'chipf' + (when === k ? ' on' : '')} aria-pressed={when === k} onClick={() => setWhen(when === k ? '' : k)}>{l}</button>)}
          <button className={'chipf' + (free ? ' on' : '')} aria-pressed={free} onClick={() => setFree(!free)}>Grátis</button>
          {(data?.facets ?? []).map((f) => <button key={f.category} className={'chipf' + (cat === f.category ? ' on' : '')} aria-pressed={cat === f.category} onClick={() => setCat(cat === f.category ? '' : f.category)}>{CATS[f.category] ?? f.category}</button>)}
        </div>
      </header>

      <section className={'map-sheet ' + sheet} aria-label="Lista de eventos">
        <button className="map-fab" onClick={locate} aria-label="A minha posição"><Icon n="pin" /></button>
        <div className="grab" onPointerDown={onDown} onPointerUp={onUp} role="button" tabIndex={0} aria-label="Arrastar a lista" onKeyDown={(e) => e.key === 'Enter' && setSheet(sheet === 'full' ? 'half' : 'full')}><i /></div>
        <div className="sheet-head"><b>{!data ? 'A procurar…' : areaOnly ? `${listed.length} nesta área` : `${data.total} evento${data.total === 1 ? '' : 's'}`}</b>{areaOnly && data && <button className="ghost sm" onClick={() => { setAreaOnly(false); setSelected(null); fitAll(); }}>Ver todos ({data.items.length})</button>}{!areaOnly && me && <span className="muted small">Mais perto de si primeiro</span>}{anyFilter && <button className="ghost sm" onClick={clearAll}>Limpar filtros</button>}</div>
        <div className="sheet-list">
          {data && data.items.length === 0 && <div className="empty"><Icon n="pin" className="" /><p>Nenhum evento encontrado. Tente outra pesquisa ou limpe os filtros.</p></div>}
          {data && data.items.length > 0 && listed.length === 0 && <div className="empty"><Icon n="pin" className="" /><p>Nenhum evento nesta área do mapa.</p><button className="ghost sm" onClick={() => { setAreaOnly(false); fitAll(); }}>Ver todos</button></div>}
          {listed.map((i) => (
            <article key={i.slug} className={'ev-card' + (i.slug === selected ? ' on' : '')} role="link" tabIndex={0} aria-label={`Abrir ${i.name}`} onClick={(e) => open(i.slug, e)} onKeyDown={(e) => e.key === 'Enter' && open(i.slug, e)} onMouseEnter={() => setHover(i.slug)} onMouseLeave={() => setHover(null)}>
              <div className="ev-img" style={{ background: i.cover ? `center / cover url(/public/events/${i.slug}/assets/cover?v=${i.cover})` : `linear-gradient(140deg, ${i.primary ?? '#5b2eff'}, color-mix(in srgb, ${i.primary ?? '#5b2eff'} 60%, #000))` }}>
                <span className="ev-date">{dayLabel(i.startsAt)}</span>
              </div>
              <div className="ev-body">
                <h3>{i.name}</h3>
                <p className="muted small">{i.location ?? i.organization}{dist(i) && <> · <b>{dist(i)}</b></>}</p>
                <div className="between"><span className="price">{price(i) || 'Em breve'}</span>
                  {i.slug === selected && i.lat !== null
                    ? <a className="btn ghost sm" href={googleDirections(i.lat, i.lng!)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon n="pin" />Como chegar</a>
                    : <span className="go" aria-hidden="true"><Icon n="arrowright" /></span>}</div>
              </div>
            </article>
          ))}
          {sel && sel.lat !== null && <p className="small muted center" style={{ padding: 8 }}>Direcções: <a href={googleDirections(sel.lat, sel.lng!)} target="_blank" rel="noopener noreferrer">Google Maps</a> · <a href={wazeDirections(sel.lat, sel.lng!)} target="_blank" rel="noopener noreferrer">Waze</a></p>}
        </div>
      </section>
    </div>
      <AppTabs current="events" />
    </>
  );
}
