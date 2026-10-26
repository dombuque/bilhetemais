// Acrescenta eventos de demonstração com coordenadas (Maputo) à API local. Uso: node scripts/seed-map-demo.mjs [URL]
const API = process.argv[2] ?? 'http://localhost:4100';
const j = async (u, m = 'GET', b, t) => (await fetch(API + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const t = (await j('/auth/login', 'POST', { email: 'organizador@bilheteplus.test', password: process.env.DEMO_PASSWORD ?? '', org: 'eventos-demo' })).token;
const fest = (await j('/events', 'GET', null, t)).find((e) => e.subdomain === 'festival-de-maputo');
await j(`/events/${fest.id}/details`, 'PUT', { location: 'Estádio da Machava, Maputo', mapUrl: 'https://maps.google.com/?q=Machava', category: 'FESTIVAL', latitude: -25.9319, longitude: 32.4975 }, t);
console.log('Festival de Maputo: coordenadas definidas');
const d = Date.now(), H = 36e5, D = 24 * H;
const mk = async (name, description, location, category, latitude, longitude, days, priceMinor, quantity) => {
  const e = await j('/events', 'POST', { name, description, location, category, latitude, longitude, startsAt: new Date(d + days * D).toISOString(), endsAt: new Date(d + days * D + 6 * H).toISOString() }, t);
  await j(`/events/${e.id}/ticket-types`, 'POST', { name: 'Entrada', priceMinor, quantity }, t);
  await j(`/events/${e.id}/publish`, 'POST', {}, t);
  console.log('criado:', name, '→', e.subdomain);
};
await mk('Concerto no Jardim Tunduru', 'Música ao vivo ao pôr do sol no coração da cidade.', 'Jardim Tunduru, Maputo', 'MUSICA', -25.9654, 32.5836, 3, 30000, 200);
await mk('Feira de Gastronomia de Maputo', 'Sabores de todo o país, entrada livre.', 'Baixa de Maputo', 'GASTRONOMIA', -25.9692, 32.5732, 6, 0, 500);
await mk('Conferência Tech Moçambique', 'Dois dias de talks sobre tecnologia e negócios.', 'Centro de Conferências Joaquim Chissano', 'CONFERENCIA', -25.9585, 32.5744, 12, 120000, 300);
