// Cria uma empresa de TESTE com eventos, imagens, programa, comerciante e utilizadores (balcão, comerciante, portaria).
// Idempotente: não duplica o que já existe.
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... CRED_FILE=/root/bilheteplus-test-org.txt node scripts/seed-test-events.mjs [URL]
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const API = process.argv[2] ?? 'http://127.0.0.1:4100';
const { ADMIN_EMAIL, ADMIN_PASSWORD, CRED_FILE } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('defina ADMIN_EMAIL e ADMIN_PASSWORD');
const require = createRequire(import.meta.url);
let sharp = null;
for (const p of ['sharp', '../../web/node_modules/sharp']) { try { sharp = require(p); break; } catch { /* tenta o seguinte */ } }
if (!sharp) console.warn('(sharp não encontrado: os eventos ficam sem imagens de capa)');

const j = async (m, u, b, t) => {
  const r = await fetch(API + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${m} ${u} → ${r.status} ${d.error ?? ''}`);
  return d;
};
const MT = 100, H = 36e5, D = 24 * H;

// ---- empresa de teste ----
const root = (await j('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).token;
const SLUG_NAME = 'Eventos Teste';
let org = (await j('GET', '/orgs', null, root)).find((o) => o.trade_name === SLUG_NAME);
const pw = randomBytes(9).toString('base64url');
let creds = null;
if (!org) {
  const made = await j('POST', '/orgs', { legalName: 'Eventos Teste Lda', tradeName: SLUG_NAME, nuit: '400000999', adminName: 'Organizador Teste', adminEmail: 'organizador@teste.bilhete', adminPassword: pw }, root);
  org = { id: made.id };
  org.slug = (await j('GET', `/orgs/${made.id}`, null, root)).slug;
  creds = { pw };
  console.log('empresa criada:', org.slug);
} else console.log('empresa já existe:', org.slug);

if (!creds) { console.log('Nada a fazer para a empresa (credenciais já criadas antes).'); }
const login = async () => (await j('POST', '/auth/login', { email: 'organizador@teste.bilhete', password: creds?.pw ?? process.env.ORG_PASSWORD, org: org.slug })).token;
if (!creds && !process.env.ORG_PASSWORD) { console.log('Defina ORG_PASSWORD para acrescentar eventos a uma empresa já existente.'); process.exit(0); }
const t = await login();

// ---- imagens de capa geradas (gradiente + formas + título) ----
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const art = async (title, c1, c2, accent, w = 1200, h = 675) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.82}" cy="${h * 0.28}" r="${h * 0.34}" fill="${accent}" opacity=".9"/><circle cx="${w * 0.1}" cy="${h * 1.02}" r="${h * 0.3}" fill="#fff" opacity=".12"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${-200 + i * 110}" y="0" width="6" height="${h * 1.6}" fill="#fff" opacity=".07" transform="rotate(20 ${-200 + i * 110} 0)"/>`).join('')}
    <text x="56" y="${h - 90}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="${title.length > 22 ? 62 : 78}" fill="#fff">${esc(title)}</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
};
const putImage = async (path, buf, tk) => {
  const r = await fetch(API + path, { method: path.includes('/images') ? 'POST' : 'PUT', headers: { 'content-type': 'image/webp', authorization: 'Bearer ' + tk, 'x-caption': '' }, body: buf });
  if (!r.ok) console.warn('imagem não enviada', path, r.status);
};

// ---- eventos ----
const existing = new Set((await j('GET', '/events', null, t)).map((e) => e.name));
const E = [
  { name: 'Festival de Marrabenta', cat: 'FESTIVAL', loc: 'Estádio da Machava, Maputo', lat: -25.9319, lng: 32.4975, days: 9, c: ['#c2185b', '#4a0d2c', '#ffd54f'], tag: 'Três noites de marrabenta', desc: 'Evento de teste. Os maiores nomes da marrabenta num só palco, com zona gastronómica e área VIP.', types: [['Geral', 500, 'GENERAL', 800], ['VIP', 1500, 'VIP', 100]], sessions: [['Abertura de portas', 0, 'Entrada'], ['Banda de abertura', 2, 'Palco principal'], ['Concerto principal', 4, 'Palco principal']], full: true },
  { name: 'Concerto no Jardim Tunduru', cat: 'MUSICA', loc: 'Jardim Tunduru, Maputo', lat: -25.9654, lng: 32.5836, days: 3, c: ['#0b6bcb', '#062f63', '#2ee6c5'], tag: 'Música ao vivo ao pôr do sol', desc: 'Evento de teste. Um fim de tarde de música ao vivo no coração da cidade.', types: [['Entrada', 300, 'GENERAL', 300]], single: true },
  { name: 'Feira de Gastronomia de Maputo', cat: 'GASTRONOMIA', loc: 'Baixa de Maputo', lat: -25.9692, lng: 32.5732, days: 6, c: ['#e65100', '#7a2a00', '#ffcc00'], tag: 'Sabores de todo o país', desc: 'Evento de teste com entrada livre. Bancas de todas as províncias, workshops e música.', types: [['Entrada', 0, 'FREE', 2000]], single: true },
  { name: 'Conferência Tech Moçambique', cat: 'CONFERENCIA', loc: 'Centro de Conferências Joaquim Chissano, Maputo', lat: -25.9585, lng: 32.5744, days: 14, c: ['#263238', '#0b1215', '#ff7043'], tag: 'Tecnologia, negócios e talento', desc: 'Evento de teste. Dois dias de palestras e workshops sobre tecnologia, startups e inovação.', types: [['Normal', 1200, 'GENERAL', 400], ['Estudante', 600, 'GENERAL', 150]], sessions: [['Registo', 0, 'Foyer'], ['Keynote de abertura', 1, 'Sala A'], ['Painel: startups em Moçambique', 3, 'Sala A']] },
  { name: 'Maratona da Beira', cat: 'DESPORTO', loc: 'Marginal da Beira', lat: -19.8437, lng: 34.8389, days: 25, c: ['#0a7d3b', '#04361a', '#ffcc00'], tag: 'Corra pela cidade', desc: 'Evento de teste. Meia-maratona e 10 km à beira-mar, com kit de atleta.', types: [['Inscrição', 400, 'GENERAL', 1000]], single: true },
  { name: 'Mapiko Sessions', cat: 'TEATRO', loc: 'Teatro Municipal, Nampula', lat: -15.1165, lng: 39.2666, days: 20, c: ['#6a1b9a', '#2a0a3d', '#ff80ab'], tag: 'Dança e teatro do norte', desc: 'Evento de teste. Uma noite de teatro e danças tradicionais do norte de Moçambique.', types: [['Geral', 250, 'GENERAL', 250], ['Camarote', 800, 'VIP', 30]] },
  { name: 'Festival do Mar de Pemba', cat: 'FESTIVAL', loc: 'Praia do Wimbe, Pemba', lat: -12.974, lng: 40.5178, days: 40, c: ['#00838f', '#003c43', '#fff176'], tag: 'Música, mar e sol', desc: 'Evento de teste. Um fim de semana de música, desportos de praia e gastronomia.', types: [['Geral', 350, 'GENERAL', 600], ['VIP', 1200, 'VIP', 80]], full: true },
  { name: 'Expo Negócios Matola', cat: 'EMPRESARIAL', loc: 'Recinto Feiral, Matola', lat: -25.9623, lng: 32.4589, days: 30, c: ['#37474f', '#10181c', '#4dd0e1'], tag: 'Ligue-se a quem faz negócio', desc: 'Evento de teste. Feira de negócios com expositores, networking e rondas de investimento.', types: [['Visitante', 100, 'GENERAL', 1500]], single: true },
];
const now = Date.now();
let made = 0, firstId = null;
for (const e of E) {
  if (existing.has(e.name)) { console.log('já existe:', e.name); continue; }
  const starts = new Date(now + e.days * D + 18 * H - (now % D)).toISOString();
  const ev = await j('POST', '/events', { name: e.name, description: e.desc, location: e.loc, category: e.cat, latitude: e.lat, longitude: e.lng, startsAt: starts, endsAt: new Date(+new Date(starts) + 6 * H).toISOString(), balanceRefundAllowed: !!e.full }, t);
  firstId ??= ev.id;
  for (const [name, price, kind, qty] of e.types) await j('POST', `/events/${ev.id}/ticket-types`, { name, priceMinor: price * MT, kind, quantity: qty }, t);
  if (e.single) await j('PUT', `/events/${ev.id}/settings`, { ticketCategories: 'single' }, t);
  for (const [title, h, stage] of e.sessions ?? []) await j('POST', `/events/${ev.id}/sessions`, { title, stage, startsAt: new Date(+new Date(starts) + h * H).toISOString() }, t);
  await j('PUT', `/events/${ev.id}/theme`, { primary: e.c[0], accent: e.c[2], tagline: e.tag, heroStyle: sharp ? 'image' : 'gradient', font: e.cat === 'CONFERENCIA' ? 'system' : 'rounded' }, t);
  if (sharp) {
    await putImage(`/events/${ev.id}/assets/cover`, await art(e.name, e.c[0], e.c[1], e.c[2]), t);
    for (const g of [['Ambiente', 0.9], ['Palco', 0.6]]) await putImage(`/events/${ev.id}/images`, await art(`${e.name} · ${g[0]}`, e.c[1], e.c[0], e.c[2], 900, 675), t);
  }
  await j('POST', `/events/${ev.id}/publish`, {}, t);
  made++; console.log('criado e publicado:', e.name);
}

// ---- comerciante, produtos e equipa no primeiro evento (balcão, comerciante, portaria) ----
if (creds && firstId) {
  await j('POST', `/events/${firstId}/gates`, { name: 'Porta Principal' }, t);
  const bar = await j('POST', `/events/${firstId}/merchants`, { name: 'Bar Central' }, t);
  for (const [n, p] of [['Cerveja', 125], ['Água', 50], ['Refrigerante', 75], ['Prato do dia', 350]]) await j('POST', `/merchants/${bar.id}/products`, { name: n, priceMinor: p * MT }, t);
  for (const [email, role, extra] of [['balcao@teste.bilhete', 'CASHIER', {}], ['porta@teste.bilhete', 'GATE_OPERATOR', {}], ['bar@teste.bilhete', 'MERCHANT_OPERATOR', { merchantId: bar.id }]])
    await j('POST', '/users', { email, name: email.split('@')[0], password: creds.pw, role, ...extra }, t);
  if (CRED_FILE) {
    writeFileSync(CRED_FILE, `Empresa de teste: ${SLUG_NAME}\nEntrada da equipa: /empresa/${org.slug}\nUtilizadores (mesma palavra-passe): organizador@teste.bilhete, balcao@teste.bilhete, porta@teste.bilhete, bar@teste.bilhete\nPalavra-passe: ${creds.pw}\n`, { mode: 0o600 });
    console.log('credenciais guardadas em', CRED_FILE);
  }
}
console.log(`Concluído: ${made} eventos criados.`);
