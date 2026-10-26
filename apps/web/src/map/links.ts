// Ligações de navegação: abrem a app de mapas já com o destino (coordenadas) e pedem direcções.
const c = (n: number) => Number(n).toFixed(6);
export const googleDirections = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${c(lat)},${c(lng)}&travelmode=driving`;
export const wazeDirections = (lat: number, lng: number) => `https://waze.com/ul?ll=${c(lat)},${c(lng)}&navigate=yes&zoom=17`;
export const appleDirections = (lat: number, lng: number) => `https://maps.apple.com/?daddr=${c(lat)},${c(lng)}&dirflg=d`;
export const isApple = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
