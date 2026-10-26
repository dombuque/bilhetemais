import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../ui';
import { appleDirections, googleDirections, isApple, loadMapLibre, MAP_STYLE, MAPUTO, wazeDirections, type MLMap } from './mapkit';

const pinEl = () => { const el = document.createElement('div'); el.className = 'pin-dot'; el.innerHTML = '<span></span>'; return el; };

/** Mapa pequeno e fixo da página do evento, com «Como chegar». */
export function MiniMap({ lat, lng, name, address }: { lat: number; lng: number; name: string; address?: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let map: MLMap | null = null, dead = false;
    loadMapLibre().then((ml) => {
      if (dead || !box.current) return;
      const m: MLMap = new ml.Map({ container: box.current, style: MAP_STYLE, center: [lng, lat], zoom: 14.5, interactive: false, attributionControl: { compact: true } });
      map = m;
      m.on('error', () => setErr(true));
      new ml.Marker({ element: pinEl(), anchor: 'bottom' }).setLngLat([lng, lat]).addTo(m);
    }).catch(() => setErr(true));
    return () => { dead = true; map?.remove(); };
  }, [lat, lng]);
  return (
    <section className="card stack-sm">
      <h2>Como chegar</h2>
      {address && <p className="muted">{address}</p>}
      {err ? <p className="scan-note">Não foi possível carregar o mapa.</p> : <div ref={box} className="minimap" role="img" aria-label={`Mapa: ${name}`} />}
      <div className="inline">
        <a className="btn sm" href={googleDirections(lat, lng)} target="_blank" rel="noopener noreferrer"><Icon n="pin" />Google Maps</a>
        <a className="btn ghost sm" href={wazeDirections(lat, lng)} target="_blank" rel="noopener noreferrer">Waze</a>
        {isApple() && <a className="btn ghost sm" href={appleDirections(lat, lng)} target="_blank" rel="noopener noreferrer">Apple Maps</a>}
        <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(`${lat}, ${lng}`); setCopied(true); setTimeout(() => setCopied(false), 1800); }}><Icon n="copy" />{copied ? 'Copiado' : 'Copiar coordenadas'}</button>
      </div>
    </section>
  );
}

/** Selector de local para o organizador: pesquisa de moradas, toque no mapa, pin arrastável e «usar a minha posição». */
export function LocationPicker({ lat, lng, onChange, onPlaceName }: { lat: number | null; lng: number | null; onChange: (lat: number | null, lng: number | null) => void; onPlaceName?: (name: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const marker = useRef<any>(null);
  const lib = useRef<any>(null);
  const cb = useRef(onChange); cb.current = onChange;
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    loadMapLibre().then((ml) => {
      if (dead || !box.current) return;
      lib.current = ml;
      const m: MLMap = new ml.Map({ container: box.current, style: MAP_STYLE, center: lat !== null ? [lng!, lat] : MAPUTO, zoom: lat !== null ? 14.5 : 10.5, attributionControl: { compact: true } });
      m.on('load', () => setReady(true));
      m.on('click', (e: any) => cb.current(Math.round(e.lngLat.lat * 1e6) / 1e6, Math.round(e.lngLat.lng * 1e6) / 1e6));
      map.current = m;
    }).catch(() => setNote('Não foi possível carregar o mapa.'));
    return () => { dead = true; map.current?.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // o pin segue o valor
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready) return;
    if (lat === null || lng === null) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) {
      marker.current = new ml.Marker({ element: pinEl(), anchor: 'bottom', draggable: true }).setLngLat([lng, lat]).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current.getLngLat(); cb.current(Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6); });
    } else marker.current.setLngLat([lng, lat]);
  }, [lat, lng, ready]);

  useEffect(() => {
    if (q.trim().length < 3) { setPlaces([]); return; }
    let live = true;
    const t = setTimeout(() => api('GET', '/public/geocode?q=' + encodeURIComponent(q.trim())).then((r) => live && setPlaces(r.slice(0, 5))).catch(() => live && setPlaces([])), 500);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const choose = (p: { name: string; lat: number; lng: number }) => {
    onChange(Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6);
    map.current?.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 600 });
    onPlaceName?.(p.name.split(',').slice(0, 2).join(',').trim());
    setPlaces([]); setQ('');
  };
  const here = () => navigator.geolocation?.getCurrentPosition((p) => { onChange(Math.round(p.coords.latitude * 1e6) / 1e6, Math.round(p.coords.longitude * 1e6) / 1e6); map.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }); setNote(''); },
    () => setNote('Não foi possível obter a sua localização.'), { enableHighAccuracy: true, timeout: 10000 });

  return (
    <div className="stack-sm">
      <div className="picker-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar o local (ex.: Estádio da Machava)" aria-label="Procurar local" />
        {places.length > 0 && <ul className="map-suggest" role="listbox">{places.map((p) => <li key={p.name + p.lat}><button type="button" onClick={() => choose(p)}><Icon n="pin" /><span>{p.name}</span></button></li>)}</ul>}
      </div>
      <div ref={box} className="minimap tall" role="application" aria-label="Escolher o local no mapa" />
      <div className="inline">
        <span className="muted small" style={{ flex: 1 }}>{lat !== null ? `Local: ${lat}, ${lng}. Arraste o pin ou toque noutro ponto.` : 'Toque no mapa para marcar o local do evento.'}</span>
        <button type="button" className="ghost sm" onClick={here}>Usar a minha posição</button>
        {lat !== null && <button type="button" className="danger ghost sm" onClick={() => onChange(null, null)}>Remover</button>}
      </div>
      {note && <p className="scan-note">{note}</p>}
    </div>
  );
}
