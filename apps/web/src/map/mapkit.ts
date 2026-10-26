import type { Map as MLMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

/** Mosaicos vectoriais gratuitos (OpenFreeMap), sem chave de API. */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
export const MAPUTO: [number, number] = [32.5732, -25.9692]; // [lng, lat]

/** O mapa vectorial precisa de WebGL; sem ele mostra-se só a lista. */
export const webglOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };

/** O MapLibre é pesado: só se carrega quando um mapa aparece. */
export async function loadMapLibre() {
  const [m] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
  const ml = (m as any).default ?? m;
  ml.setWorkerUrl(workerUrl); // worker servido pelo próprio site (a política de segurança não precisa de «blob:» para scripts)
  return ml;
}
export type MapLib = Awaited<ReturnType<typeof loadMapLibre>>;
export type { MLMap };

export const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = (d: number) => (d * Math.PI) / 180, dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
export const fmtDist = (d: number) => (d < 1 ? `${Math.round(d * 10) * 100} m` : d < 10 ? `${d.toFixed(1).replace('.', ',')} km` : `${Math.round(d)} km`);

export { googleDirections, wazeDirections, appleDirections, isApple } from './links';

/** Ponto azul da posição do utilizador. */
export function userDot(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'user-dot';
  el.innerHTML = '<i></i>';
  return el;
}
